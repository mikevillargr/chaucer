//! Optional activity reporting (off by default). When the owner enters an endpoint and token in
//! Settings, each AI feature call sends one small event: feature, provider kind, model, duration
//! and ok/failed, plus a hashed thread id to group calls. Never email content, subjects,
//! addresses, prompts or outputs. Delivery is fire-and-forget: it never blocks or fails a feature.

use crate::secrets;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

pub const ENDPOINT_PREF: &str = "activityEndpoint";
const FLUSH_EVERY: Duration = Duration::from_secs(2);
const FLUSH_AT: usize = 20;
const MAX_BATCH: usize = 50;
const MAX_QUEUE: usize = 500;
const RETRY_WAITS: [u64; 3] = [2, 8, 30];

static QUEUE: Mutex<Vec<Value>> = Mutex::new(Vec::new());
/// True while a flush task exists (sleeping or sending), so a backlog never starts concurrent senders.
static SENDER_ACTIVE: AtomicBool = AtomicBool::new(false);

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

/// Queues one event if reporting is configured. Cheap and infallible; `thread_id` is hashed here.
pub fn report(app: &crate::App, feature: &str, provider_kind: &str, model: &str, thread_id: Option<&str>, duration_ms: u64, ok: bool) {
    let Some(endpoint) = app.cfg.pref(ENDPOINT_PREF).and_then(|v| v.as_str().and_then(clean_endpoint)) else { return };
    let fresh;
    let thread = match thread_id {
        Some(t) => t,
        None => {
            fresh = event_id();
            &fresh
        }
    };
    enqueue(app.http.clone(), endpoint, build_event(feature, provider_kind, model, thread, duration_ms, ok));
}

/// Pushes onto the bounded queue (oldest dropped beyond the cap); returns the new length.
fn push_capped(q: &mut Vec<Value>, event: Value) -> usize {
    q.push(event);
    if q.len() > MAX_QUEUE {
        let excess = q.len() - MAX_QUEUE;
        q.drain(..excess);
    }
    q.len()
}

fn enqueue(http: reqwest::Client, endpoint: String, event: Value) {
    let Ok(mut q) = QUEUE.lock() else { return };
    let len = push_capped(&mut q, event);
    drop(q);
    if SENDER_ACTIVE.swap(true, Ordering::SeqCst) {
        return; // the running sender will pick this up
    }
    tauri::async_runtime::spawn(async move {
        if len < FLUSH_AT {
            tokio::time::sleep(FLUSH_EVERY).await;
        }
        flush(&http, &endpoint).await;
        SENDER_ACTIVE.store(false, Ordering::SeqCst);
    });
}

async fn flush(client: &reqwest::Client, endpoint: &str) {
    let Some(token) = secrets::get(secrets::ACTIVITY_TOKEN_KEY).ok().flatten().filter(|t| !t.is_empty()) else {
        if let Ok(mut q) = QUEUE.lock() {
            q.clear();
        }
        return;
    };
    loop {
        let batch: Vec<Value> = match QUEUE.lock() {
            Ok(mut q) => {
                let n = q.len().min(MAX_BATCH);
                q.drain(..n).collect()
            }
            Err(_) => return,
        };
        if batch.is_empty() {
            return;
        }
        post_with_retry(client, endpoint, &token, &json!({ "events": batch })).await;
    }
}

/// Retries network errors, 429 and 5xx after 2 s, 8 s and 30 s, then drops the batch. 4xx other than 429 drops at once.
async fn post_with_retry(client: &reqwest::Client, endpoint: &str, token: &str, body: &Value) {
    let url = format!("{endpoint}/v1/ingest");
    for attempt in 0..=RETRY_WAITS.len() {
        match client.post(&url).timeout(Duration::from_secs(5)).bearer_auth(token).json(body).send().await {
            Ok(r) if r.status().is_success() || (r.status().is_client_error() && r.status().as_u16() != 429) => return,
            _ => {}
        }
        match RETRY_WAITS.get(attempt) {
            Some(w) => tokio::time::sleep(Duration::from_secs(*w)).await,
            None => return,
        }
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

    #[test]
    fn push_capped_drops_oldest() {
        let mut q = Vec::new();
        for i in 0..(MAX_QUEUE + 50) {
            push_capped(&mut q, json!({ "n": i }));
        }
        assert_eq!(q.len(), MAX_QUEUE);
        assert_eq!(q[0]["n"], 50);
    }
}
