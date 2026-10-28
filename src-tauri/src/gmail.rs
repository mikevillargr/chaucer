//! Thin client for the Gmail API v1 and the People API.

use crate::error::{Error, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::Method;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::time::Duration;

const GMAIL: &str = "https://gmail.googleapis.com/gmail/v1/users/me";
const PEOPLE: &str = "https://people.googleapis.com/v1";
pub const METADATA_HEADERS: &[&str] = &["From", "To", "Cc", "Subject", "Date"];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GThread {
    pub id: String,
    pub history_id: Option<String>,
    pub snippet: Option<String>,
    #[serde(default)]
    pub messages: Vec<GMessage>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GMessage {
    pub id: String,
    pub thread_id: String,
    #[serde(default)]
    pub label_ids: Vec<String>,
    pub snippet: Option<String>,
    pub internal_date: Option<String>,
    pub payload: Option<GPart>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GPart {
    pub part_id: Option<String>,
    #[serde(default)]
    pub mime_type: String,
    #[serde(default)]
    pub filename: String,
    #[serde(default)]
    pub headers: Vec<GHeader>,
    pub body: Option<GBody>,
    #[serde(default)]
    pub parts: Vec<GPart>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GBody {
    pub attachment_id: Option<String>,
    #[serde(default)]
    pub size: i64,
    pub data: Option<String>,
}

impl GPart {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|h| h.name.eq_ignore_ascii_case(name)).map(|h| h.value.as_str())
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GLabel {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub color: Option<GLabelColor>,
    pub threads_unread: Option<i64>,
    pub threads_total: Option<i64>,
    pub label_list_visibility: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GLabelColor {
    pub background_color: Option<String>,
    pub text_color: Option<String>,
}

/// What changed since a history id: threads to refetch and newly arrived inbox mail.
#[derive(Debug, Default)]
pub struct HistoryDelta {
    pub history_id: String,
    pub threads: BTreeSet<String>,
    pub new_inbox: Vec<(String, String)>, // (message id, thread id)
}

pub struct Gmail {
    http: reqwest::Client,
    token: String,
}

impl Gmail {
    pub fn new(http: reqwest::Client, token: String) -> Self {
        Gmail { http, token }
    }

    async fn call(&self, method: Method, url: &str, query: &[(&str, String)], body: Option<Value>) -> Result<Value> {
        let mut attempt = 0;
        loop {
            let mut req = self.http.request(method.clone(), url).bearer_auth(&self.token).query(query);
            if let Some(b) = &body {
                req = req.json(b);
            }
            let resp = req.send().await?;
            let status = resp.status().as_u16();
            if (status == 429 || status >= 500) && attempt < 3 {
                attempt += 1;
                tokio::time::sleep(Duration::from_millis(500 * 2u64.pow(attempt))).await;
                continue;
            }
            let text = resp.text().await?;
            if !(200..300).contains(&status) {
                let message = serde_json::from_str::<Value>(&text)
                    .ok()
                    .and_then(|v| v["error"]["message"].as_str().map(String::from))
                    .unwrap_or(text);
                return Err(Error::Api { status, message });
            }
            return Ok(if text.is_empty() { Value::Null } else { serde_json::from_str(&text)? });
        }
    }

    async fn get(&self, path: &str, query: &[(&str, String)]) -> Result<Value> {
        self.call(Method::GET, &format!("{GMAIL}{path}"), query, None).await
    }

    async fn post(&self, path: &str, body: Value) -> Result<Value> {
        self.call(Method::POST, &format!("{GMAIL}{path}"), &[], Some(body)).await
    }

    // ---- profile, labels -------------------------------------------------------------

    pub async fn profile(&self) -> Result<(String, String)> {
        let v = self.get("/profile", &[]).await?;
        Ok((
            v["emailAddress"].as_str().unwrap_or_default().to_string(),
            v["historyId"].as_str().unwrap_or_default().to_string(),
        ))
    }

    pub async fn labels(&self) -> Result<Vec<GLabel>> {
        let v = self.get("/labels", &[]).await?;
        Ok(serde_json::from_value(v["labels"].clone()).unwrap_or_default())
    }

    pub async fn label(&self, id: &str) -> Result<GLabel> {
        Ok(serde_json::from_value(self.get(&format!("/labels/{id}"), &[]).await?)?)
    }

    pub async fn create_label(&self, body: Value) -> Result<Value> {
        self.post("/labels", body).await
    }

    pub async fn update_label(&self, id: &str, body: Value) -> Result<Value> {
        self.call(Method::PATCH, &format!("{GMAIL}/labels/{id}"), &[], Some(body)).await
    }

    pub async fn delete_label(&self, id: &str) -> Result<()> {
        self.call(Method::DELETE, &format!("{GMAIL}/labels/{id}"), &[], None).await.map(|_| ())
    }

    // ---- threads ---------------------------------------------------------------------

    /// One page of thread ids with their history ids.
    pub async fn list_threads(
        &self,
        label_ids: &[String],
        q: Option<&str>,
        page_token: Option<&str>,
        max: u32,
    ) -> Result<(Vec<(String, String)>, Option<String>)> {
        let mut query: Vec<(&str, String)> = vec![("maxResults", max.to_string())];
        for l in label_ids {
            query.push(("labelIds", l.clone()));
        }
        if let Some(q) = q.filter(|q| !q.is_empty()) {
            query.push(("q", q.to_string()));
        }
        if let Some(t) = page_token {
            query.push(("pageToken", t.to_string()));
        }
        let v = self.get("/threads", &query).await?;
        let ids = v["threads"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|t| {
                        (
                            t["id"].as_str().unwrap_or_default().to_string(),
                            t["historyId"].as_str().unwrap_or_default().to_string(),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok((ids, v["nextPageToken"].as_str().map(String::from)))
    }

    pub async fn thread_metadata(&self, id: &str) -> Result<GThread> {
        let mut query = vec![("format", "metadata".to_string())];
        query.extend(METADATA_HEADERS.iter().map(|h| ("metadataHeaders", h.to_string())));
        Ok(serde_json::from_value(self.get(&format!("/threads/{id}"), &query).await?)?)
    }

    pub async fn thread_full(&self, id: &str) -> Result<GThread> {
        Ok(serde_json::from_value(self.get(&format!("/threads/{id}"), &[("format", "full".into())]).await?)?)
    }

    pub async fn modify_thread(&self, id: &str, add: &[String], remove: &[String]) -> Result<()> {
        self.post(&format!("/threads/{id}/modify"), json!({ "addLabelIds": add, "removeLabelIds": remove }))
            .await
            .map(|_| ())
    }

    pub async fn trash_thread(&self, id: &str) -> Result<()> {
        self.post(&format!("/threads/{id}/trash"), json!({})).await.map(|_| ())
    }

    pub async fn untrash_thread(&self, id: &str) -> Result<()> {
        self.post(&format!("/threads/{id}/untrash"), json!({})).await.map(|_| ())
    }

    pub async fn attachment(&self, message_id: &str, attachment_id: &str) -> Result<Vec<u8>> {
        let v = self.get(&format!("/messages/{message_id}/attachments/{attachment_id}"), &[]).await?;
        decode_b64url(v["data"].as_str().unwrap_or_default())
    }

    // ---- sending and drafts ----------------------------------------------------------

    fn message_body(raw: &[u8], thread_id: Option<&str>) -> Value {
        let mut m = json!({ "raw": URL_SAFE_NO_PAD.encode(raw) });
        if let Some(t) = thread_id {
            m["threadId"] = json!(t);
        }
        m
    }

    pub async fn send(&self, raw: &[u8], thread_id: Option<&str>) -> Result<Value> {
        self.post("/messages/send", Self::message_body(raw, thread_id)).await
    }

    pub async fn save_draft(&self, draft_id: Option<&str>, raw: &[u8], thread_id: Option<&str>) -> Result<Value> {
        let body = json!({ "message": Self::message_body(raw, thread_id) });
        match draft_id {
            Some(id) => self.call(Method::PUT, &format!("{GMAIL}/drafts/{id}"), &[], Some(body)).await,
            None => self.post("/drafts", body).await,
        }
    }

    pub async fn send_draft(&self, draft_id: &str, raw: &[u8], thread_id: Option<&str>) -> Result<Value> {
        self.post("/drafts/send", json!({ "id": draft_id, "message": Self::message_body(raw, thread_id) }))
            .await
    }

    pub async fn delete_draft(&self, draft_id: &str) -> Result<()> {
        self.call(Method::DELETE, &format!("{GMAIL}/drafts/{draft_id}"), &[], None).await.map(|_| ())
    }

    /// Finds the draft id that owns a message (drafts show up in threads as messages).
    pub async fn draft_for_message(&self, message_id: &str) -> Result<Option<String>> {
        let mut page: Option<String> = None;
        loop {
            let mut q = vec![("maxResults", "500".to_string())];
            if let Some(p) = &page {
                q.push(("pageToken", p.clone()));
            }
            let v = self.get("/drafts", &q).await?;
            for d in v["drafts"].as_array().into_iter().flatten() {
                if d["message"]["id"].as_str() == Some(message_id) {
                    return Ok(d["id"].as_str().map(String::from));
                }
            }
            match v["nextPageToken"].as_str() {
                Some(p) => page = Some(p.to_string()),
                None => return Ok(None),
            }
        }
    }

    // ---- history ---------------------------------------------------------------------

    /// Changes since `start`. A 404 means the id is too old and a full resync is needed.
    pub async fn history(&self, start: &str) -> Result<HistoryDelta> {
        let mut delta = HistoryDelta { history_id: start.to_string(), ..Default::default() };
        let mut page: Option<String> = None;
        loop {
            let mut q = vec![("startHistoryId", start.to_string()), ("maxResults", "500".to_string())];
            if let Some(p) = &page {
                q.push(("pageToken", p.clone()));
            }
            let v = self.get("/history", &q).await?;
            if let Some(h) = v["historyId"].as_str() {
                delta.history_id = h.to_string();
            }
            for record in v["history"].as_array().into_iter().flatten() {
                for key in ["messages", "messagesAdded", "messagesDeleted", "labelsAdded", "labelsRemoved"] {
                    for item in record[key].as_array().into_iter().flatten() {
                        let msg = if key == "messages" { item } else { &item["message"] };
                        if let Some(t) = msg["threadId"].as_str() {
                            delta.threads.insert(t.to_string());
                        }
                    }
                }
                for item in record["messagesAdded"].as_array().into_iter().flatten() {
                    let m = &item["message"];
                    let labels: Vec<&str> =
                        m["labelIds"].as_array().into_iter().flatten().filter_map(|l| l.as_str()).collect();
                    if labels.contains(&"INBOX") && labels.contains(&"UNREAD") && !labels.contains(&"SENT") {
                        delta.new_inbox.push((
                            m["id"].as_str().unwrap_or_default().to_string(),
                            m["threadId"].as_str().unwrap_or_default().to_string(),
                        ));
                    }
                }
            }
            match v["nextPageToken"].as_str() {
                Some(p) => page = Some(p.to_string()),
                None => return Ok(delta),
            }
        }
    }

    // ---- settings --------------------------------------------------------------------

    pub async fn send_as(&self) -> Result<Value> {
        Ok(self.get("/settings/sendAs", &[]).await?["sendAs"].clone())
    }

    pub async fn vacation(&self) -> Result<Value> {
        self.get("/settings/vacation", &[]).await
    }

    pub async fn set_vacation(&self, body: Value) -> Result<Value> {
        self.call(Method::PUT, &format!("{GMAIL}/settings/vacation"), &[], Some(body)).await
    }

    pub async fn filters(&self) -> Result<Value> {
        Ok(self.get("/settings/filters", &[]).await?["filter"].clone())
    }

    pub async fn create_filter(&self, body: Value) -> Result<Value> {
        self.post("/settings/filters", body).await
    }

    pub async fn delete_filter(&self, id: &str) -> Result<()> {
        self.call(Method::DELETE, &format!("{GMAIL}/settings/filters/{id}"), &[], None).await.map(|_| ())
    }

    // ---- People API ------------------------------------------------------------------

    /// All (name, email) pairs from "Other contacts" and saved contacts.
    pub async fn contacts(&self) -> Result<Vec<(String, String)>> {
        let mut out = Vec::new();
        let sources = [
            (format!("{PEOPLE}/otherContacts"), "readMask", "otherContacts"),
            (format!("{PEOPLE}/people/me/connections"), "personFields", "connections"),
        ];
        for (url, field_param, key) in sources {
            let mut page: Option<String> = None;
            loop {
                let mut q = vec![(field_param, "names,emailAddresses".to_string()), ("pageSize", "1000".to_string())];
                if let Some(p) = &page {
                    q.push(("pageToken", p.clone()));
                }
                let v = match self.call(Method::GET, &url, &q, None).await {
                    Ok(v) => v,
                    Err(e) if e.is_status(403) => break, // People API not enabled: skip quietly
                    Err(e) => return Err(e),
                };
                for p in v[key].as_array().into_iter().flatten() {
                    let name = p["names"][0]["displayName"].as_str().unwrap_or_default();
                    for e in p["emailAddresses"].as_array().into_iter().flatten() {
                        if let Some(addr) = e["value"].as_str() {
                            out.push((name.to_string(), addr.to_lowercase()));
                        }
                    }
                }
                match v["nextPageToken"].as_str() {
                    Some(p) => page = Some(p.to_string()),
                    None => break,
                }
            }
        }
        Ok(out)
    }
}

pub fn decode_b64url(data: &str) -> Result<Vec<u8>> {
    base64::engine::general_purpose::URL_SAFE_NO_PAD_INDIFFERENT
        .decode(data.trim())
        .map_err(|e| Error::other(format!("bad base64 from Gmail: {e}")))
}
