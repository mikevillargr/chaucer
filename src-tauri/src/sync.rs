//! Keeps the local cache in step with Gmail: a first sync per account, then
//! incremental `history.list` polling. Emits `mail-changed` to the webview.

use crate::error::{Error, Result};
use crate::gmail::{GThread, Gmail};
use crate::model::{Addr, Label, Message, ThreadDetail, ThreadSummary};
use crate::{parse, App};
use base64::{engine::general_purpose::STANDARD, Engine};
use futures::stream::{self, StreamExt};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const CONCURRENCY: usize = 8;
pub const POLL_INTERVAL: Duration = Duration::from_secs(30);
const MAX_INLINE_IMAGE: i64 = 4 * 1024 * 1024;

fn to_label(account: &str, l: crate::gmail::GLabel) -> Label {
    let system = l.kind.as_deref() == Some("system");
    Label {
        account_id: account.to_string(),
        hidden: l.label_list_visibility.as_deref() == Some("labelHide"),
        kind: if system { "system".into() } else { "user".into() },
        color_bg: l.color.as_ref().and_then(|c| c.background_color.clone()),
        color_text: l.color.as_ref().and_then(|c| c.text_color.clone()),
        threads_unread: l.threads_unread.unwrap_or(0),
        threads_total: l.threads_total.unwrap_or(0),
        id: l.id,
        name: l.name,
    }
}

/// Reloads labels with their unread/total counts (labels.list omits counts).
pub async fn refresh_labels(app: &App, gmail: &Gmail, account: &str) -> Result<Vec<Label>> {
    let list = gmail.labels().await?;
    let detailed: Vec<Label> = stream::iter(list)
        .map(|l| async move {
            let id = l.id.clone();
            match gmail.label(&id).await {
                Ok(full) => to_label(account, full),
                Err(_) => to_label(account, l),
            }
        })
        .buffer_unordered(CONCURRENCY)
        .collect()
        .await;
    app.db.replace_labels(account, &detailed)?;
    Ok(detailed)
}

/// Fetches metadata for threads whose history id changed and returns summaries in
/// the given order. Threads that no longer exist are dropped from the cache.
pub async fn summaries(app: &App, gmail: &Gmail, account: &str, ids: &[(String, String)]) -> Result<Vec<ThreadSummary>> {
    let known = app.db.thread_history_ids(account)?;
    let stale: Vec<String> = ids
        .iter()
        .filter(|(id, hist)| hist.is_empty() || known.get(id) != Some(hist))
        .map(|(id, _)| id.clone())
        .collect();
    let fetched: Vec<(String, Result<GThread>)> = stream::iter(stale)
        .map(|id| async move { (id.clone(), gmail.thread_metadata(&id).await) })
        .buffer_unordered(CONCURRENCY)
        .collect()
        .await;
    for (id, res) in fetched {
        match res {
            Ok(t) if !t.messages.is_empty() => app.db.upsert_thread(&parse::summary(account, &t))?,
            Ok(_) => app.db.delete_thread(account, &id)?,
            Err(e) if e.is_status(404) => app.db.delete_thread(account, &id)?,
            Err(e) => return Err(e),
        }
    }
    let mut out = Vec::with_capacity(ids.len());
    for (id, _) in ids {
        if let Some(t) = app.db.thread(account, id)? {
            out.push(t);
        }
    }
    Ok(out)
}

/// First sync after sign-in (or after the history id expired).
pub async fn full_sync(app: &App, account: &str) -> Result<()> {
    let gmail = app.gmail(account).await?;
    let (_, history_id) = gmail.profile().await?;
    refresh_labels(app, &gmail, account).await?;
    let mut page: Option<String> = None;
    for _ in 0..3 {
        let (ids, next) = gmail.list_threads(&["INBOX".into()], None, page.as_deref(), 100).await?;
        summaries(app, &gmail, account, &ids).await?;
        match next {
            Some(n) => page = Some(n),
            None => break,
        }
    }
    for label in ["SENT", "STARRED", "DRAFT", "IMPORTANT"] {
        let (ids, _) = gmail.list_threads(&[label.into()], None, None, 50).await?;
        summaries(app, &gmail, account, &ids).await?;
    }
    app.db.set_history_id(account, &history_id)?;
    if let Ok(contacts) = gmail.contacts().await {
        let addrs: Vec<Addr> = contacts.into_iter().map(|(name, email)| Addr { name, email }).collect();
        app.db.add_contacts(account, &addrs, false)?;
    }
    Ok(())
}

/// Applies changes since the stored history id. Returns new unread inbox threads.
pub async fn incremental(app: &App, account: &str) -> Result<(bool, Vec<ThreadSummary>)> {
    let Some(start) = app.db.history_id(account)? else {
        full_sync(app, account).await?;
        return Ok((true, vec![]));
    };
    let gmail = app.gmail(account).await?;
    let delta = match gmail.history(&start).await {
        Ok(d) => d,
        Err(e) if e.is_status(404) => {
            full_sync(app, account).await?;
            return Ok((true, vec![]));
        }
        Err(e) => return Err(e),
    };
    let changed = !delta.threads.is_empty();
    if changed {
        let ids: Vec<(String, String)> = delta.threads.iter().map(|t| (t.clone(), String::new())).collect();
        summaries(app, &gmail, account, &ids).await?;
        refresh_labels(app, &gmail, account).await?;
    }
    app.db.set_history_id(account, &delta.history_id)?;
    let mut fresh = Vec::new();
    for (_, thread_id) in &delta.new_inbox {
        if let Some(t) = app.db.thread(account, thread_id)? {
            if t.unread && !fresh.iter().any(|f: &ThreadSummary| f.id == t.id) {
                fresh.push(t);
            }
        }
    }
    Ok((changed, fresh))
}

/// Full thread with bodies; served from cache when the history id hasn't moved.
pub async fn thread_detail(app: &App, account: &str, thread_id: &str) -> Result<ThreadDetail> {
    let cached_summary = app.db.thread(account, thread_id)?;
    if let (Some(s), Some((hist, messages))) = (&cached_summary, app.db.thread_detail(account, thread_id)?) {
        if hist == s.history_id {
            return Ok(ThreadDetail { summary: s.clone(), messages });
        }
    }
    let gmail = match app.gmail(account).await {
        Ok(g) => g,
        // Offline or signed out: fall back to whatever is cached.
        Err(e) => match (cached_summary, app.db.thread_detail(account, thread_id)?) {
            (Some(s), Some((_, messages))) => return Ok(ThreadDetail { summary: s, messages }),
            _ => return Err(e),
        },
    };
    let full = gmail.thread_full(thread_id).await?;
    let summary = parse::summary(account, &full);
    let mut messages: Vec<Message> = full.messages.iter().map(parse::message).collect();
    embed_inline_images(&gmail, &mut messages).await;
    app.db.upsert_thread(&summary)?;
    app.db.put_thread_detail(account, thread_id, &summary.history_id, &messages)?;
    let people: Vec<Addr> = messages.iter().flat_map(|m| std::iter::once(m.from.clone()).chain(m.to.clone()).chain(m.cc.clone())).collect();
    app.db.add_contacts(account, &people, false)?;
    Ok(ThreadDetail { summary, messages })
}

/// Replaces `cid:` references in HTML bodies with data URLs for embedded images.
async fn embed_inline_images(gmail: &Gmail, messages: &mut [Message]) {
    for m in messages.iter_mut() {
        let Some(html) = m.html.as_mut() else { continue };
        for a in m.attachments.iter().filter(|a| a.content_id.is_some() && a.size <= MAX_INLINE_IMAGE) {
            let cid = a.content_id.as_deref().unwrap();
            if !html.contains(&format!("cid:{cid}")) {
                continue;
            }
            if let Ok(data) = gmail.attachment(&m.id, &a.attachment_id).await {
                let url = format!("data:{};base64,{}", a.mime_type, STANDARD.encode(data));
                *html = html.replace(&format!("cid:{cid}"), &url);
            }
        }
    }
}

fn notifications_enabled(app: &App, account: &str) -> bool {
    app.cfg
        .pref("notifyAccounts")
        .and_then(|v| v.get(account).and_then(|b| b.as_bool()))
        .unwrap_or(true)
}

fn notify(handle: &AppHandle, app: &App, account: &str, threads: &[ThreadSummary]) {
    use tauri_plugin_notification::NotificationExt;
    if !notifications_enabled(app, account) {
        return;
    }
    for t in threads.iter().take(3) {
        let from = t.senders.last().map(|s| if s.name.is_empty() { s.email.clone() } else { s.name.clone() }).unwrap_or_default();
        let _ = handle.notification().builder().title(from).body(format!("{}\n{}", t.subject, t.snippet)).show();
    }
    if threads.len() > 3 {
        let _ = handle
            .notification()
            .builder()
            .title(format!("{} more new messages", threads.len() - 3))
            .body(account.to_string())
            .show();
    }
}

pub fn update_badge(handle: &AppHandle, app: &App) {
    let total = app.db.inbox_unread_total().unwrap_or(0);
    if let Some(w) = handle.get_webview_window("main") {
        let _ = w.set_badge_count((total > 0).then_some(total));
    }
}

/// One pass over every signed-in account.
pub async fn sync_all(handle: &AppHandle, app: &App) {
    let Ok(accounts) = app.db.accounts() else { return };
    let mut changed_accounts = Vec::new();
    for a in accounts.iter().filter(|a| !a.needs_reauth) {
        match incremental(app, &a.id).await {
            Ok((changed, fresh)) => {
                if changed {
                    changed_accounts.push(a.id.clone());
                }
                notify(handle, app, &a.id, &fresh);
            }
            Err(Error::NotSignedIn(_)) => changed_accounts.push(a.id.clone()),
            Err(e) => log::warn!("sync {} failed: {e}", a.id),
        }
    }
    if !changed_accounts.is_empty() {
        let _ = handle.emit("mail-changed", &changed_accounts);
    }
    update_badge(handle, app);
}

pub fn start(handle: AppHandle, app: Arc<App>) {
    tauri::async_runtime::spawn(async move {
        loop {
            sync_all(&handle, &app).await;
            tokio::select! {
                _ = tokio::time::sleep(POLL_INTERVAL) => {}
                _ = app.wake.notified() => {}
            }
        }
    });
}
