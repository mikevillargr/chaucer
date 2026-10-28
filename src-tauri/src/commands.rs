//! Tauri commands: the webview's whole API. Keep in sync with `src/lib/ipc.ts`.

use crate::config::GoogleClient;
use crate::error::{Error, Result};
use crate::llm::{self, Provider};
use crate::mime::{self, OutAttachment, Outgoing};
use crate::model::*;
use crate::{auth, secrets, sync, App};
use base64::{engine::general_purpose::STANDARD, Engine};
use futures::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::sync::Arc;
use tauri::{AppHandle, State};

type S<'a> = State<'a, Arc<App>>;

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

// ---- setup and accounts ------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    has_client: bool,
    accounts: Vec<Account>,
}

#[tauri::command]
pub fn app_status(app: S<'_>) -> Result<Status> {
    Ok(Status { has_client: app.cfg.google_client().is_some(), accounts: app.db.accounts()? })
}

#[tauri::command]
pub fn set_google_client(app: S<'_>, client_id: String, client_secret: String) -> Result<()> {
    let client = GoogleClient { client_id: client_id.trim().into(), client_secret: client_secret.trim().into() };
    if !client.client_id.ends_with(".apps.googleusercontent.com") {
        return Err(Error::other("That doesn't look like a Google OAuth client ID"));
    }
    app.cfg.set_google_client(&client)
}

#[tauri::command]
pub async fn add_account(handle: AppHandle, app: S<'_>, login_hint: Option<String>) -> Result<Account> {
    let client = app.cfg.google_client().ok_or(Error::MissingClientConfig)?;
    let signed = auth::sign_in(&app.http, &client, login_hint.as_deref(), |url| {
        use tauri_plugin_opener::OpenerExt;
        handle.opener().open_url(url, None::<&str>).map_err(|e| Error::other(e.to_string()))
    })
    .await?;
    let probe = crate::gmail::Gmail::new(app.http.clone(), signed.access_token.clone(), Default::default());
    let (email, _) = probe.profile().await?;
    let gmail = crate::gmail::Gmail::new(app.http.clone(), signed.access_token.clone(), app.limiter(&email));
    let display_name = gmail
        .send_as()
        .await
        .ok()
        .and_then(|list| list.as_array()?.iter().find(|s| s["isPrimary"].as_bool() == Some(true))?["displayName"].as_str().map(String::from))
        .filter(|n| !n.is_empty());
    secrets::set(&secrets::refresh_token_key(&email), &signed.refresh_token)?;
    app.tokens.put(&email, signed.access_token, signed.expires_in).await;
    let account = Account { id: email.clone(), email: email.clone(), display_name, needs_reauth: false };
    app.db.upsert_account(&account)?;

    let (app2, handle2) = (app.inner().clone(), handle.clone());
    tauri::async_runtime::spawn(async move {
        if app2.db.history_id(&email).ok().flatten().is_none() {
            if let Err(e) = sync::full_sync(&app2, &email).await {
                log::warn!("initial sync failed: {e}");
            }
        }
        use tauri::Emitter;
        let _ = handle2.emit("mail-changed", vec![email]);
        sync::update_badge(&handle2, &app2);
    });
    Ok(account)
}

#[tauri::command]
pub async fn remove_account(handle: AppHandle, app: S<'_>, account_id: String) -> Result<()> {
    if let Some(token) = secrets::get(&secrets::refresh_token_key(&account_id))? {
        auth::revoke(&app.http, &token).await;
    }
    secrets::delete(&secrets::refresh_token_key(&account_id))?;
    app.tokens.forget(&account_id).await;
    app.db.remove_account(&account_id)?;
    sync::update_badge(&handle, &app);
    Ok(())
}

#[tauri::command]
pub fn sync_now(app: S<'_>) {
    app.wake.notify_one();
}

#[tauri::command]
pub fn get_prefs(app: S<'_>) -> Map<String, Value> {
    app.cfg.prefs()
}

#[tauri::command]
pub fn set_prefs(app: S<'_>, patch: Map<String, Value>) -> Result<Map<String, Value>> {
    app.cfg.update_prefs(patch)
}

// ---- mailbox -----------------------------------------------------------------------

#[tauri::command]
pub fn list_labels(app: S<'_>, account_id: Option<String>) -> Result<Vec<Label>> {
    app.db.labels(account_id.as_deref())
}

#[tauri::command]
pub fn cached_threads(app: S<'_>, account_id: Option<String>, labels: Vec<String>, before: Option<i64>, limit: Option<i64>) -> Result<Vec<ThreadSummary>> {
    app.db.threads(account_id.as_deref(), &labels, before, limit.unwrap_or(100))
}

fn target_accounts(app: &App, account_id: &Option<String>) -> Result<Vec<String>> {
    Ok(match account_id {
        Some(a) => vec![a.clone()],
        None => app.db.accounts()?.into_iter().filter(|a| !a.needs_reauth).map(|a| a.id).collect(),
    })
}

/// One page from Gmail for a label view or search, merged across accounts by date.
/// `page` holds per-account tokens from the previous `ThreadPage.next` (None = first page).
async fn fetch_page(app: &App, account_id: &Option<String>, labels: &[String], q: Option<&str>, page: Option<Vec<(String, String)>>) -> Result<ThreadPage> {
    let targets: Vec<(String, Option<String>)> = match page {
        Some(tokens) => tokens.into_iter().map(|(a, t)| (a, Some(t))).collect(),
        None => target_accounts(app, account_id)?.into_iter().map(|a| (a, None)).collect(),
    };
    let mut threads = Vec::new();
    let mut next = Vec::new();
    for (account, token) in targets {
        let gmail = app.gmail(&account).await?;
        let (ids, next_token) = gmail.list_threads(labels, q, token.as_deref(), 50).await?;
        threads.extend(sync::summaries(app, &gmail, &account, &ids).await?);
        if let Some(t) = next_token {
            next.push((account, t));
        }
    }
    threads.sort_by(|a, b| b.last_date.cmp(&a.last_date));
    Ok(ThreadPage { threads, next })
}

#[tauri::command]
pub async fn fetch_threads(app: S<'_>, account_id: Option<String>, labels: Vec<String>, page: Option<Vec<(String, String)>>) -> Result<ThreadPage> {
    fetch_page(&app, &account_id, &labels, None, page).await
}

#[tauri::command]
pub async fn search(app: S<'_>, account_id: Option<String>, query: String, page: Option<Vec<(String, String)>>) -> Result<ThreadPage> {
    if page.is_none() {
        app.db.add_recent_search(query.trim(), now_ms())?;
    }
    match fetch_page(&app, &account_id, &[], Some(&query), page).await {
        Ok(p) => Ok(p),
        // Offline (or Gmail unreachable): search the local cache instead.
        Err(Error::Http(_)) => Ok(ThreadPage { threads: app.db.search(account_id.as_deref(), &query, 100)?, next: vec![] }),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub fn recent_searches(app: S<'_>) -> Result<Vec<String>> {
    app.db.recent_searches()
}

#[tauri::command]
pub fn clear_recent_searches(app: S<'_>) -> Result<()> {
    app.db.clear_recent_searches()
}

#[tauri::command]
pub async fn get_thread(app: S<'_>, account_id: String, thread_id: String) -> Result<ThreadDetail> {
    sync::thread_detail(&app, &account_id, &thread_id).await
}

// ---- actions -----------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadRef {
    account_id: String,
    thread_id: String,
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum Op {
    Modify,
    Trash,
    Untrash,
}

/// Applies an action to many threads (across accounts), returning updated summaries.
#[tauri::command]
pub async fn act_on_threads(handle: AppHandle, app: S<'_>, threads: Vec<ThreadRef>, op: Op, add: Option<Vec<String>>, remove: Option<Vec<String>>) -> Result<Vec<ThreadSummary>> {
    let (add, remove) = (add.unwrap_or_default(), remove.unwrap_or_default());
    let app_ref: &App = &app;
    let results: Vec<Result<Option<ThreadSummary>>> = stream::iter(threads)
        .map(|t| {
            let (add, remove) = (add.clone(), remove.clone());
            async move {
                let gmail = app_ref.gmail(&t.account_id).await?;
                let (add, remove) = match op {
                    Op::Modify => {
                        gmail.modify_thread(&t.thread_id, &add, &remove).await?;
                        (add, remove)
                    }
                    Op::Trash => {
                        gmail.trash_thread(&t.thread_id).await?;
                        (vec!["TRASH".to_string()], vec!["INBOX".to_string(), "UNREAD".to_string()])
                    }
                    Op::Untrash => {
                        gmail.untrash_thread(&t.thread_id).await?;
                        (vec![], vec!["TRASH".to_string()])
                    }
                };
                app_ref.db.apply_labels(&t.account_id, &t.thread_id, &add, &remove)
            }
        })
        .buffer_unordered(6)
        .collect()
        .await;
    let mut out = Vec::new();
    for r in results {
        if let Some(t) = r? {
            out.push(t);
        }
    }
    app.wake.notify_one(); // refresh label counts soon
    sync::update_badge(&handle, &app);
    Ok(out)
}

#[tauri::command]
pub async fn block_sender(app: S<'_>, account_id: String, email: String) -> Result<()> {
    let gmail = app.gmail(&account_id).await?;
    let criteria = json!({ "from": email });
    if gmail.create_filter(json!({ "criteria": criteria, "action": { "addLabelIds": ["TRASH"] } })).await.is_err() {
        gmail.create_filter(json!({ "criteria": criteria, "action": { "removeLabelIds": ["INBOX"] } })).await?;
    }
    Ok(())
}

/// Unsubscribes via the message's List-Unsubscribe header. Returns a URL the UI should
/// open in the browser when the list only offers a web page.
#[tauri::command]
pub async fn unsubscribe(app: S<'_>, account_id: String, thread_id: String, message_id: String) -> Result<Option<String>> {
    let detail = sync::thread_detail(&app, &account_id, &thread_id).await?;
    let m = detail.messages.iter().find(|m| m.id == message_id).ok_or_else(|| Error::other("message not found"))?;
    let header = m.list_unsubscribe.clone().ok_or_else(|| Error::other("This sender doesn't offer unsubscribe"))?;
    let targets: Vec<String> = header.split(',').map(|s| s.trim().trim_matches(['<', '>']).to_string()).collect();
    let https = targets.iter().find(|t| t.starts_with("https://"));
    let one_click = m.list_unsubscribe_post.as_deref().is_some_and(|p| p.contains("One-Click"));
    if let (Some(url), true) = (https, one_click) {
        app.http.post(url).form(&[("List-Unsubscribe", "One-Click")]).send().await?.error_for_status()?;
        return Ok(None);
    }
    if let Some(mailto) = targets.iter().find(|t| t.starts_with("mailto:")) {
        let parsed = url::Url::parse(mailto).map_err(|e| Error::other(e.to_string()))?;
        let subject = parsed.query_pairs().find(|(k, _)| k.eq_ignore_ascii_case("subject")).map(|(_, v)| v.into_owned()).unwrap_or_else(|| "unsubscribe".into());
        let me = app.db.accounts()?.into_iter().find(|a| a.id == account_id).ok_or_else(|| Error::other("unknown account"))?;
        let raw = mime::build(&Outgoing {
            from: Addr { name: me.display_name.unwrap_or_default(), email: me.email },
            to: vec![Addr { name: String::new(), email: parsed.path().to_string() }],
            cc: vec![],
            bcc: vec![],
            subject,
            html: "<p>unsubscribe</p>".into(),
            text: "unsubscribe".into(),
            in_reply_to: None,
            references: None,
            attachments: vec![],
        })?;
        app.gmail(&account_id).await?.send(&raw, None).await?;
        return Ok(None);
    }
    Ok(https.cloned().or_else(|| targets.into_iter().find(|t| t.starts_with("http"))))
}

// ---- attachments -------------------------------------------------------------------

#[tauri::command]
pub async fn attachment_data(app: S<'_>, account_id: String, message_id: String, attachment_id: String) -> Result<String> {
    let data = app.gmail(&account_id).await?.attachment(&message_id, &attachment_id).await?;
    Ok(STANDARD.encode(data))
}

#[tauri::command]
pub async fn save_attachment(app: S<'_>, account_id: String, message_id: String, attachment_id: String, path: String) -> Result<()> {
    let data = app.gmail(&account_id).await?.attachment(&message_id, &attachment_id).await?;
    std::fs::write(path, data)?;
    Ok(())
}

/// Saves to a temp folder and opens with the default app (Preview, etc.).
#[tauri::command]
pub async fn open_attachment(handle: AppHandle, app: S<'_>, account_id: String, message_id: String, attachment_id: String, filename: String) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    let data = app.gmail(&account_id).await?.attachment(&message_id, &attachment_id).await?;
    let dir = std::env::temp_dir().join("letterbox-attachments").join(&message_id);
    std::fs::create_dir_all(&dir)?;
    let safe: String = filename.chars().map(|c| if c == '/' || c == '\\' || c == ':' { '_' } else { c }).collect();
    let path = dir.join(if safe.is_empty() { "attachment".into() } else { safe });
    std::fs::write(&path, data)?;
    handle.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|e| Error::other(e.to_string()))
}

// ---- compose -----------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DraftAttachment {
    #[serde(rename_all = "camelCase")]
    File { path: String, filename: String, mime_type: Option<String> },
    #[serde(rename_all = "camelCase")]
    Gmail { message_id: String, attachment_id: String, filename: String, mime_type: String },
    #[serde(rename_all = "camelCase")]
    Inline { data: String, filename: String, mime_type: String, content_id: String },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    account_id: String,
    draft_id: Option<String>,
    thread_id: Option<String>,
    from: Addr,
    to: Vec<Addr>,
    cc: Vec<Addr>,
    bcc: Vec<Addr>,
    subject: String,
    html: String,
    text: String,
    in_reply_to: Option<String>,
    references: Option<String>,
    attachments: Vec<DraftAttachment>,
}

pub fn guess_mime(filename: &str) -> &'static str {
    let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "heic" => "image/heic",
        "svg" => "image/svg+xml",
        "txt" | "md" => "text/plain",
        "csv" => "text/csv",
        "html" | "htm" => "text/html",
        "zip" => "application/zip",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "key" => "application/x-iwork-keynote-sffkey",
        "pages" => "application/x-iwork-pages-sffpages",
        "numbers" => "application/x-iwork-numbers-sffnumbers",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "ics" => "text/calendar",
        _ => "application/octet-stream",
    }
}

async fn build_draft(app: &App, d: &Draft) -> Result<Vec<u8>> {
    let mut attachments = Vec::new();
    for a in &d.attachments {
        attachments.push(match a {
            DraftAttachment::File { path, filename, mime_type } => OutAttachment {
                data: std::fs::read(path)?,
                mime_type: mime_type.clone().unwrap_or_else(|| guess_mime(filename).into()),
                filename: filename.clone(),
                content_id: None,
            },
            DraftAttachment::Gmail { message_id, attachment_id, filename, mime_type } => OutAttachment {
                data: app.gmail(&d.account_id).await?.attachment(message_id, attachment_id).await?,
                mime_type: mime_type.clone(),
                filename: filename.clone(),
                content_id: None,
            },
            DraftAttachment::Inline { data, filename, mime_type, content_id } => OutAttachment {
                data: STANDARD.decode(data).map_err(|e| Error::other(e.to_string()))?,
                mime_type: mime_type.clone(),
                filename: filename.clone(),
                content_id: Some(content_id.clone()),
            },
        });
    }
    mime::build(&Outgoing {
        from: d.from.clone(),
        to: d.to.clone(),
        cc: d.cc.clone(),
        bcc: d.bcc.clone(),
        subject: d.subject.clone(),
        html: d.html.clone(),
        text: d.text.clone(),
        in_reply_to: d.in_reply_to.clone(),
        references: d.references.clone(),
        attachments,
    })
}

async fn refresh_thread(app: &App, account: &str, thread_id: Option<&str>) {
    if let (Some(id), Ok(gmail)) = (thread_id, app.gmail(account).await) {
        let _ = sync::summaries(app, &gmail, account, &[(id.to_string(), String::new())]).await;
    }
}

#[tauri::command]
pub async fn send_message(app: S<'_>, draft: Draft) -> Result<()> {
    let raw = build_draft(&app, &draft).await?;
    let gmail = app.gmail(&draft.account_id).await?;
    let sent = match &draft.draft_id {
        Some(id) => gmail.send_draft(id, &raw, draft.thread_id.as_deref()).await?,
        None => gmail.send(&raw, draft.thread_id.as_deref()).await?,
    };
    let recipients: Vec<Addr> = draft.to.iter().chain(&draft.cc).chain(&draft.bcc).cloned().collect();
    app.db.add_contacts(&draft.account_id, &recipients, true)?;
    let thread = sent["threadId"].as_str().map(String::from).or(draft.thread_id.clone());
    refresh_thread(&app, &draft.account_id, thread.as_deref()).await;
    app.wake.notify_one();
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedDraft {
    draft_id: String,
    message_id: String,
    thread_id: String,
}

#[tauri::command]
pub async fn save_draft(app: S<'_>, draft: Draft) -> Result<SavedDraft> {
    let raw = build_draft(&app, &draft).await?;
    let v = app.gmail(&draft.account_id).await?.save_draft(draft.draft_id.as_deref(), &raw, draft.thread_id.as_deref()).await?;
    let saved = SavedDraft {
        draft_id: v["id"].as_str().unwrap_or_default().into(),
        message_id: v["message"]["id"].as_str().unwrap_or_default().into(),
        thread_id: v["message"]["threadId"].as_str().unwrap_or_default().into(),
    };
    refresh_thread(&app, &draft.account_id, Some(&saved.thread_id)).await;
    Ok(saved)
}

#[tauri::command]
pub async fn delete_draft(app: S<'_>, account_id: String, draft_id: String, thread_id: Option<String>) -> Result<()> {
    app.gmail(&account_id).await?.delete_draft(&draft_id).await?;
    refresh_thread(&app, &account_id, thread_id.as_deref()).await;
    Ok(())
}

#[tauri::command]
pub async fn draft_for_message(app: S<'_>, account_id: String, message_id: String) -> Result<Option<String>> {
    app.gmail(&account_id).await?.draft_for_message(&message_id).await
}

#[tauri::command]
pub fn search_contacts(app: S<'_>, account_id: Option<String>, query: String) -> Result<Vec<Addr>> {
    app.db.search_contacts(account_id.as_deref(), &query, 8)
}

// ---- Gmail settings ----------------------------------------------------------------

#[tauri::command]
pub async fn send_as(app: S<'_>, account_id: String) -> Result<Value> {
    app.gmail(&account_id).await?.send_as().await
}

#[tauri::command]
pub async fn get_vacation(app: S<'_>, account_id: String) -> Result<Value> {
    app.gmail(&account_id).await?.vacation().await
}

#[tauri::command]
pub async fn set_vacation(app: S<'_>, account_id: String, settings: Value) -> Result<Value> {
    app.gmail(&account_id).await?.set_vacation(settings).await
}

#[tauri::command]
pub async fn list_filters(app: S<'_>, account_id: String) -> Result<Value> {
    Ok(app.gmail(&account_id).await?.filters().await?)
}

#[tauri::command]
pub async fn create_filter(app: S<'_>, account_id: String, filter: Value) -> Result<Value> {
    app.gmail(&account_id).await?.create_filter(filter).await
}

#[tauri::command]
pub async fn delete_filter(app: S<'_>, account_id: String, filter_id: String) -> Result<()> {
    app.gmail(&account_id).await?.delete_filter(&filter_id).await
}

async fn reload_labels(app: &App, account: &str) -> Result<Vec<Label>> {
    let gmail = app.gmail(account).await?;
    sync::refresh_labels(app, &gmail, account).await
}

#[tauri::command]
pub async fn create_label(app: S<'_>, account_id: String, label: Value) -> Result<Vec<Label>> {
    app.gmail(&account_id).await?.create_label(label).await?;
    reload_labels(&app, &account_id).await
}

#[tauri::command]
pub async fn update_label(app: S<'_>, account_id: String, label_id: String, patch: Value) -> Result<Vec<Label>> {
    app.gmail(&account_id).await?.update_label(&label_id, patch).await?;
    reload_labels(&app, &account_id).await
}

#[tauri::command]
pub async fn delete_label(app: S<'_>, account_id: String, label_id: String) -> Result<Vec<Label>> {
    app.gmail(&account_id).await?.delete_label(&label_id).await?;
    reload_labels(&app, &account_id).await
}

// ---- smart features (BYOK) ---------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    #[serde(flatten)]
    provider: Provider,
    has_key: bool,
}

fn providers(app: &App) -> Vec<Provider> {
    app.cfg.pref("llmProviders").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
}

#[tauri::command]
pub fn llm_providers(app: S<'_>) -> Result<Vec<ProviderInfo>> {
    providers(&app)
        .into_iter()
        .map(|p| Ok(ProviderInfo { has_key: secrets::get(&secrets::llm_key(&p.id))?.is_some(), provider: p }))
        .collect()
}

/// Creates or updates a provider. `api_key`: None keeps the stored key, "" removes it.
#[tauri::command]
pub fn llm_save_provider(app: S<'_>, provider: Provider, api_key: Option<String>) -> Result<()> {
    let mut list = providers(&app);
    match list.iter_mut().find(|p| p.id == provider.id) {
        Some(existing) => *existing = provider.clone(),
        None => list.push(provider.clone()),
    }
    match api_key.as_deref() {
        Some("") => secrets::delete(&secrets::llm_key(&provider.id))?,
        Some(k) => secrets::set(&secrets::llm_key(&provider.id), k.trim())?,
        None => {}
    }
    let mut patch = Map::new();
    patch.insert("llmProviders".into(), serde_json::to_value(list)?);
    app.cfg.update_prefs(patch)?;
    Ok(())
}

#[tauri::command]
pub fn llm_delete_provider(app: S<'_>, provider_id: String) -> Result<()> {
    let list: Vec<Provider> = providers(&app).into_iter().filter(|p| p.id != provider_id).collect();
    secrets::delete(&secrets::llm_key(&provider_id))?;
    let mut patch = Map::new();
    patch.insert("llmProviders".into(), serde_json::to_value(list)?);
    app.cfg.update_prefs(patch)?;
    Ok(())
}

async fn run_feature(app: &App, feature: &str, system: &str, user: &str) -> Result<String> {
    let id = app
        .cfg
        .pref("llmFeatures")
        .and_then(|f| f.get(feature).and_then(|v| v.as_str()).map(String::from))
        .ok_or_else(|| Error::other("No provider is set for this feature. Choose one in Settings → Smart features."))?;
    let p = providers(app).into_iter().find(|p| p.id == id).ok_or_else(|| Error::other("The chosen provider was removed"))?;
    let key = secrets::get(&secrets::llm_key(&p.id))?;
    llm::complete(&app.http, &p, key.as_deref(), system, user).await
}

#[tauri::command]
pub async fn llm_test(app: S<'_>, provider_id: String) -> Result<String> {
    let p = providers(&app).into_iter().find(|p| p.id == provider_id).ok_or_else(|| Error::other("unknown provider"))?;
    let key = secrets::get(&secrets::llm_key(&p.id))?;
    llm::complete(&app.http, &p, key.as_deref(), "Reply with exactly: OK", "Connection test").await
}

#[tauri::command]
pub async fn smart_replies(app: S<'_>, account_id: String, thread_id: String) -> Result<Vec<String>> {
    let d = sync::thread_detail(&app, &account_id, &thread_id).await?;
    let raw = run_feature(&app, "smartReply", llm::SMART_REPLY_SYSTEM, &llm::thread_text(&d.summary.subject, &d.messages, 12_000)).await?;
    Ok(llm::parse_replies(&raw))
}

#[tauri::command]
pub async fn summarize_thread(app: S<'_>, account_id: String, thread_id: String) -> Result<String> {
    let d = sync::thread_detail(&app, &account_id, &thread_id).await?;
    run_feature(&app, "summary", llm::SUMMARY_SYSTEM, &llm::thread_text(&d.summary.subject, &d.messages, 30_000)).await
}

#[tauri::command]
pub async fn help_write(app: S<'_>, instruction: String, draft: String, account_id: Option<String>, thread_id: Option<String>) -> Result<String> {
    let mut prompt = format!("Instruction: {instruction}\n");
    if !draft.trim().is_empty() {
        prompt.push_str(&format!("\nCurrent draft:\n{draft}\n"));
    }
    if let (Some(a), Some(t)) = (account_id, thread_id) {
        if let Ok(d) = sync::thread_detail(&app, &a, &t).await {
            prompt.push_str(&format!("\nThread being replied to:\n{}\n", llm::thread_text(&d.summary.subject, &d.messages, 12_000)));
        }
    }
    run_feature(&app, "write", llm::WRITE_SYSTEM, &prompt).await
}
