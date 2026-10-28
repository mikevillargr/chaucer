mod auth;
mod commands;
mod config;
mod db;
mod error;
mod gmail;
mod llm;
mod mime;
mod model;
mod parse;
mod secrets;
mod sync;

use error::{Error, Result};
use std::sync::Arc;
use tauri::{Emitter, Manager};

/// Shared state for commands and the sync loop.
pub struct App {
    pub http: reqwest::Client,
    pub cfg: config::Config,
    pub db: db::Db,
    pub tokens: auth::Tokens,
    /// Wakes the sync loop early (after actions, sends, or "Refresh").
    pub wake: tokio::sync::Notify,
    /// One quota limiter per account, shared by every request for that account.
    pub limiters: std::sync::Mutex<std::collections::HashMap<String, Arc<gmail::Limiter>>>,
}

impl App {
    pub fn limiter(&self, account: &str) -> Arc<gmail::Limiter> {
        self.limiters.lock().unwrap().entry(account.to_string()).or_default().clone()
    }

    /// A Gmail client with a fresh access token; flags accounts that need signing in again.
    pub async fn gmail(&self, account: &str) -> Result<gmail::Gmail> {
        match self.tokens.access_token(&self.http, self.cfg.google_client(), account).await {
            Ok(token) => Ok(gmail::Gmail::new(self.http.clone(), token, self.limiter(account))),
            Err(e @ Error::NotSignedIn(_)) => {
                let _ = self.db.set_needs_reauth(account, true);
                Err(e)
            }
            Err(e) => Err(e),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch (e.g. a mailto: link) is forwarded here.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(url) = argv.iter().find(|a| a.starts_with("mailto:")) {
                let _ = app.emit("open-mailto", url);
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            // One-time move of data saved under the app's previous name (Letterbox).
            let legacy = dir.with_file_name("com.mikevillargr.letterbox");
            if !dir.exists() && legacy.exists() {
                let _ = std::fs::rename(&legacy, &dir);
            }
            let state = Arc::new(App {
                http: reqwest::Client::builder()
                    .user_agent(concat!("Chaucer/", env!("CARGO_PKG_VERSION")))
                    .timeout(std::time::Duration::from_secs(60))
                    .build()?,
                cfg: config::Config::load(&dir)?,
                db: db::Db::open(&dir.join("mail.db"))?,
                tokens: auth::Tokens::default(),
                wake: tokio::sync::Notify::new(),
                limiters: Default::default(),
            });
            app.manage(state.clone());

            use tauri_plugin_deep_link::DeepLinkExt;
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls().iter().filter(|u| u.scheme() == "mailto") {
                    let _ = handle.emit("open-mailto", url.as_str());
                }
            });

            sync::start(app.handle().clone(), state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_status,
            commands::set_google_client,
            commands::add_account,
            commands::remove_account,
            commands::sync_now,
            commands::get_prefs,
            commands::set_prefs,
            commands::list_labels,
            commands::cached_threads,
            commands::fetch_threads,
            commands::search,
            commands::recent_searches,
            commands::clear_recent_searches,
            commands::get_thread,
            commands::act_on_threads,
            commands::block_sender,
            commands::unsubscribe,
            commands::attachment_data,
            commands::save_attachment,
            commands::open_attachment,
            commands::send_message,
            commands::save_draft,
            commands::delete_draft,
            commands::draft_for_message,
            commands::search_contacts,
            commands::send_as,
            commands::get_vacation,
            commands::set_vacation,
            commands::list_filters,
            commands::create_filter,
            commands::delete_filter,
            commands::create_label,
            commands::update_label,
            commands::delete_label,
            commands::llm_providers,
            commands::llm_save_provider,
            commands::llm_delete_provider,
            commands::llm_test,
            commands::smart_replies,
            commands::summarize_thread,
            commands::help_write,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Chaucer");
}
