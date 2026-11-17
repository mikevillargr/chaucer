//! Optional activity reporting (off by default). When the owner enters an endpoint and token in
//! Settings, each AI feature call sends one small event: feature, provider kind, model, duration
//! and ok/failed, plus a hashed thread id to group calls. Never email content, subjects,
//! addresses, prompts or outputs. Delivery is fire-and-forget: it never blocks or fails a feature.

use crate::secrets;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::Notify;

pub const ENDPOINT_PREF: &str = "activityEndpoint";
const FLUSH_EVERY: Duration = Duration::from_secs(2);
const FLUSH_AT: usize = 20;
const MAX_BATCH: usize = 50;
/// Events held anywhere: waiting, being sent, or waiting to retry.
const MAX_QUEUE: usize = 500;
const RETRY_WAITS: [u64; 3] = [2, 8, 30];

/// Local, metadata-only counters (never logged with an endpoint or token).
#[derive(Default)]
pub struct Counters {
    pub send_errors: AtomicU64,
    pub evicted: AtomicU64,
    pub retries_exhausted: AtomicU64,
    pub rejected: AtomicU64,
}
pub static COUNTERS: Counters = Counters {
    send_errors: AtomicU64::new(0),
    evicted: AtomicU64::new(0),
    retries_exhausted: AtomicU64::new(0),
    rejected: AtomicU64::new(0),
};

/// Everything shared between the AI call path and the single worker. Guarded by one mutex.
struct State {
    /// (endpoint, token): reporting is on only when both are set.
    config: Option<(String, String)>,
    next_seq: u64,
    /// Every unsent event, oldest first, including the batch currently on the wire.
    queue: VecDeque<(u64, Value)>,
}

static STATE: Mutex<State> = Mutex::new(State { config: None, next_seq: 0, queue: VecDeque::new() });
static WAKE: Notify = Notify::const_new();

impl State {
    fn set_config(&mut self, config: Option<(String, String)>) {
        if self.config != config {
            self.queue.clear(); // never send queued events to a stale or disabled endpoint
        }
        self.config = config;
    }

    /// Adds an event, evicting the oldest beyond the cap. Returns the new length.
    fn push(&mut self, event: Value) -> usize {
        self.queue.push_back((self.next_seq, event));
        self.next_seq += 1;
        while self.queue.len() > MAX_QUEUE {
            self.queue.pop_front();
            COUNTERS.evicted.fetch_add(1, Ordering::Relaxed);
        }
        self.queue.len()
    }

    /// The oldest events (up to one POST) and the last one's sequence number.
    fn front_batch(&self) -> Option<(Vec<Value>, u64)> {
        let last = self.queue.iter().take(MAX_BATCH).last()?.0;
        Some((self.queue.iter().take(MAX_BATCH).map(|(_, e)| e.clone()).collect(), last))
    }

    fn remove_through(&mut self, seq: u64) {
        while self.queue.front().is_some_and(|(s, _)| *s <= seq) {
            self.queue.pop_front();
        }
    }
}

/// Normalises an endpoint without a trailing slash; None unless it is https (http only for localhost / 127.0.0.1).
pub fn clean_endpoint(raw: &str) -> Option<String> {
    let u = url::Url::parse(raw.trim()).ok()?;
    let local = matches!(u.host_str(), Some("localhost" | "127.0.0.1"));
    if !(u.scheme() == "https" || (u.scheme() == "http" && local)) {
        return None;
    }
    Some(u.as_str().trim_end_matches('/').to_string())
}

fn group_key(thread_id: &str) -> String {
    let digest = Sha256::digest(thread_id.as_bytes());
    digest.iter().take(8).map(|b| format!("{b:02x}")).collect()
}

/// A random uuid-shaped id (v4 layout); only used for idempotency, so no extra crate is needed.
fn event_id() -> String {
    let mut b: [u8; 16] = rand::random();
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}

/// The event for one AI call. Contains only the keys below.
pub fn build_event(feature: &str, provider_kind: &str, model: &str, thread_id: &str, duration_ms: u64, ok: bool) -> Value {
    let group = group_key(thread_id);
    let provider = match provider_kind {
        "anthropic" | "openai" | "moonshot" => provider_kind,
        _ => "other",
    };
    let model: String = model.trim().chars().take(64).collect();
    let model = if model.is_empty() { "unknown".to_string() } else { model };
    json!({
        "v": 1, "id": event_id(), "ts": chrono::Utc::now().to_rfc3339(),
        "source": "chaucer", "kind": "call", "groupKey": group,
        "taskKind": if feature == "write" { "write" } else { "thread" },
        "instance": { "id": format!("{group}:{model}"), "model": model, "provider": provider, "actorType": "model", "role": "lead" },
        "stage": feature, "humans": [{ "role": "requested", "personId": "owner" }], "projectKey": "chaucer",
        "durationMs": duration_ms, "ok": ok,
    })
}

/// Sets the live configuration from the saved endpoint and Keychain token. Call at startup and on save.
pub fn refresh_config(endpoint: &str) {
    let token = secrets::get(secrets::ACTIVITY_TOKEN_KEY).ok().flatten().filter(|t| !t.trim().is_empty());
    let config = match (clean_endpoint(endpoint), token) {
        (Some(e), Some(t)) => Some((e, t)),
        _ => None,
    };
    if let Ok(mut st) = STATE.lock() {
        st.set_config(config);
    }
}

/// Queues one event if reporting is fully configured. Cheap and infallible: no Keychain or disk access.
pub fn report(feature: &str, provider_kind: &str, model: &str, thread_id: Option<&str>, duration_ms: u64, ok: bool) {
    let Ok(mut st) = STATE.lock() else { return };
    if st.config.is_none() {
        return;
    }
    let fresh;
    let thread = match thread_id {
        Some(t) => t,
        None => {
            fresh = event_id();
            &fresh
        }
    };
    st.push(build_event(feature, provider_kind, model, thread, duration_ms, ok));
    drop(st);
    WAKE.notify_one();
}

/// Starts the one long-lived sender. Call once at startup, inside the async runtime's reach.
pub fn start(http: reqwest::Client) {
    tauri::async_runtime::spawn(async move {
        loop {
            WAKE.notified().await;
            // Batch window: send after 2 s, or at once when 20 events are waiting.
            let _ = tokio::time::timeout(FLUSH_EVERY, async {
                while queue_len() < FLUSH_AT {
                    WAKE.notified().await;
                }
            })
            .await;
            while send_front(&http).await {}
        }
    });
}

fn queue_len() -> usize {
    STATE.lock().map(|s| s.queue.len()).unwrap_or(0)
}

/// Sends the oldest batch with the retry policy. Returns false when there is nothing left to send.
async fn send_front(http: &reqwest::Client) -> bool {
    for attempt in 0..=RETRY_WAITS.len() {
        // Re-read both each attempt: a save may have changed or cleared them while we waited.
        let (config, batch) = match STATE.lock() {
            Ok(st) => (st.config.clone(), st.front_batch()),
            Err(_) => return false,
        };
        let (Some((endpoint, token)), Some((events, last_seq))) = (config, batch) else { return false };
        let outcome = post(http, &endpoint, &token, &events).await;
        if outcome != Outcome::Retry {
            if outcome == Outcome::Rejected {
                COUNTERS.rejected.fetch_add(1, Ordering::Relaxed);
            }
            if let Ok(mut st) = STATE.lock() {
                if st.config.as_ref().is_some_and(|(e, _)| *e == endpoint) {
                    st.remove_through(last_seq);
                }
            }
            return true;
        }
        COUNTERS.send_errors.fetch_add(1, Ordering::Relaxed);
        match RETRY_WAITS.get(attempt) {
            Some(w) => tokio::time::sleep(Duration::from_secs(*w)).await,
            None => {
                COUNTERS.retries_exhausted.fetch_add(1, Ordering::Relaxed);
                if let Ok(mut st) = STATE.lock() {
                    st.remove_through(last_seq);
                }
                return true;
            }
        }
    }
    true
}

#[derive(Debug, PartialEq, Eq)]
enum Outcome {
    Done,
    Retry,
    Rejected,
}

/// Retry network errors, 429 and 5xx; drop every other HTTP response.
fn classify(status: u16) -> Outcome {
    match status {
        200..=299 => Outcome::Done,
        429 | 500..=599 => Outcome::Retry,
        _ => Outcome::Rejected,
    }
}

async fn post(http: &reqwest::Client, endpoint: &str, token: &str, events: &[Value]) -> Outcome {
    let sent = http
        .post(format!("{endpoint}/v1/ingest"))
        .timeout(Duration::from_secs(5))
        .bearer_auth(token)
        .json(&json!({ "events": events }))
        .send()
        .await;
    match sent {
        Ok(r) => classify(r.status().as_u16()),
        Err(_) => Outcome::Retry,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_has_only_metadata() {
        let secret_thread = "thread-18f3a-SECRET-SUBJECT";
        let e = build_event("summary", "anthropic", "claude-sonnet-5-5", secret_thread, 840, true);
        let s = e.to_string();
        assert!(!s.contains("SECRET"), "raw thread id leaked: {s}");
        assert_eq!(e["groupKey"].as_str().unwrap().len(), 16);
        assert_eq!(e["stage"], "summary");
        assert_eq!(e["instance"]["model"], "claude-sonnet-5-5");
        assert_eq!(e["instance"]["provider"], "anthropic");
        assert_eq!(e["instance"]["id"], format!("{}:claude-sonnet-5-5", e["groupKey"].as_str().unwrap()));
        assert_eq!(e["durationMs"], 840);
        assert_eq!(e["ok"], true);
        let mut keys: Vec<_> = e.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(keys, ["durationMs", "groupKey", "humans", "id", "instance", "kind", "ok", "projectKey", "source", "stage", "taskKind", "ts", "v"]);
    }

    #[test]
    fn same_thread_groups_together_and_ids_differ() {
        let a = build_event("summary", "openai", "m", "t1", 1, true);
        let b = build_event("smartReply", "openai", "m", "t1", 1, false);
        assert_eq!(a["groupKey"], b["groupKey"]);
        assert_ne!(a["id"], b["id"]);
        assert_eq!(build_event("write", "openai", "m", "t1", 1, true)["taskKind"], "write");
    }

    #[test]
    fn off_when_endpoint_unset_or_invalid() {
        assert_eq!(clean_endpoint(""), None);
        assert_eq!(clean_endpoint("   "), None);
        assert_eq!(clean_endpoint("not a url"), None);
        assert_eq!(clean_endpoint("ftp://example.com"), None);
        assert_eq!(clean_endpoint("https://example.com/"), Some("https://example.com".into()));
        assert_eq!(clean_endpoint("http://example.com"), None);
        assert_eq!(clean_endpoint("http://localhost:8080/"), Some("http://localhost:8080".into()));
        assert_eq!(clean_endpoint("http://127.0.0.1:8080"), Some("http://127.0.0.1:8080".into()));
    }

    #[test]
    fn other_providers_and_odd_models_produce_a_valid_payload() {
        for kind in ["gemini", "openai_compatible", "whatever"] {
            let e = build_event("summary", kind, "llama3.3", "t", 5, true);
            assert_eq!(e["instance"]["provider"], "other");
        }
        for kind in ["anthropic", "openai", "moonshot"] {
            assert_eq!(build_event("write", kind, "m", "t", 5, true)["instance"]["provider"], kind);
        }
        assert_eq!(build_event("write", "gemini", "  ", "t", 5, true)["instance"]["model"], "unknown");
        let long = "x".repeat(200);
        assert_eq!(build_event("write", "gemini", &long, "t", 5, true)["instance"]["model"].as_str().unwrap().len(), 64);
    }

    fn on() -> State {
        State { config: Some(("https://example.com".into(), "t".into())), next_seq: 0, queue: VecDeque::new() }
    }

    #[test]
    fn cap_includes_events_on_the_wire_and_evicts_oldest() {
        let mut st = on();
        for i in 0..(MAX_QUEUE + 50) {
            st.push(json!({ "n": i }));
        }
        assert_eq!(st.queue.len(), MAX_QUEUE);
        // A batch "on the wire" is still part of the queue, so it counts toward the cap.
        let (batch, last) = st.front_batch().unwrap();
        assert_eq!(batch.len(), MAX_BATCH);
        assert_eq!(batch[0]["n"], 50);
        st.push(json!({ "n": "new" }));
        assert_eq!(st.queue.len(), MAX_QUEUE);
        st.remove_through(last); // eviction may have taken some already; removal stays correct
        assert!(st.queue.iter().all(|(s, _)| *s > last));
    }

    #[test]
    fn changing_or_disabling_config_clears_the_queue() {
        let mut st = on();
        st.push(json!({}));
        st.set_config(Some(("https://example.com".into(), "t".into())));
        assert_eq!(st.queue.len(), 1, "same config keeps events");
        st.set_config(Some(("https://other.example.com".into(), "t".into())));
        assert!(st.queue.is_empty(), "new endpoint must not receive old events");
        st.push(json!({}));
        st.set_config(None);
        assert!(st.queue.is_empty());
        assert!(st.config.is_none());
    }

    #[test]
    fn retries_only_network_429_and_5xx() {
        assert_eq!(classify(202), Outcome::Done);
        for s in [400, 401, 402, 403, 404, 405, 413, 422] {
            assert_eq!(classify(s), Outcome::Rejected, "{s}");
        }
        for s in [429, 500, 502, 503, 599] {
            assert_eq!(classify(s), Outcome::Retry, "{s}");
        }
    }

    #[test]
    fn report_is_a_no_op_without_complete_config() {
        // The global state is never configured by tests, so this must neither queue nor panic.
        report("summary", "anthropic", "m", Some("t"), 1, true);
        report("write", "x", "", None, u64::MAX, false);
        assert_eq!(queue_len(), 0);
    }
}
