//! Local SQLite cache. Gmail is the source of truth; this only makes the app fast to
//! open and lets cached mail be read and searched while offline.

use crate::error::Result;
use crate::model::{Account, Addr, Label, Message, ThreadSummary};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, email TEXT NOT NULL, display_name TEXT,
  history_id TEXT, position INTEGER NOT NULL DEFAULT 0, needs_reauth INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS labels (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, id TEXT NOT NULL,
  name TEXT NOT NULL, kind TEXT NOT NULL, color_bg TEXT, color_text TEXT,
  threads_unread INTEGER NOT NULL DEFAULT 0, threads_total INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (account_id, id)
);
CREATE TABLE IF NOT EXISTS threads (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, id TEXT NOT NULL,
  last_date INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (account_id, id)
);
CREATE INDEX IF NOT EXISTS threads_by_date ON threads(account_id, last_date DESC);
CREATE TABLE IF NOT EXISTS thread_labels (
  account_id TEXT NOT NULL, thread_id TEXT NOT NULL, label_id TEXT NOT NULL,
  PRIMARY KEY (account_id, label_id, thread_id),
  FOREIGN KEY (account_id, thread_id) REFERENCES threads(account_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS thread_labels_by_thread ON thread_labels(account_id, thread_id);
CREATE TABLE IF NOT EXISTS thread_details (
  account_id TEXT NOT NULL, thread_id TEXT NOT NULL, history_id TEXT NOT NULL, messages TEXT NOT NULL,
  PRIMARY KEY (account_id, thread_id),
  FOREIGN KEY (account_id, thread_id) REFERENCES threads(account_id, id) ON DELETE CASCADE
);
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  account_id UNINDEXED, thread_id UNINDEXED, subject, people, body, tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TABLE IF NOT EXISTS contacts (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '', uses INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (account_id, email)
);
CREATE TABLE IF NOT EXISTS recent_searches (query TEXT PRIMARY KEY, at INTEGER NOT NULL);
"#;

pub struct Db(Mutex<Connection>);

fn json<T: serde::Serialize>(v: &T) -> String {
    serde_json::to_string(v).unwrap_or_default()
}

fn people(t: &ThreadSummary) -> String {
    t.senders.iter().map(|a| format!("{} {}", a.name, a.email)).collect::<Vec<_>>().join(" ")
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        Self::init(Connection::open(path)?)
    }

    pub fn memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.execute_batch(SCHEMA)?;
        Ok(Db(Mutex::new(conn)))
    }

    fn conn(&self) -> MutexGuard<'_, Connection> {
        self.0.lock().unwrap()
    }

    // ---- accounts --------------------------------------------------------------------

    pub fn accounts(&self) -> Result<Vec<Account>> {
        let c = self.conn();
        let mut st = c.prepare("SELECT id, email, display_name, needs_reauth FROM accounts ORDER BY position, email")?;
        let rows = st.query_map([], |r| {
            Ok(Account { id: r.get(0)?, email: r.get(1)?, display_name: r.get(2)?, needs_reauth: r.get(3)? })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn upsert_account(&self, a: &Account) -> Result<()> {
        self.conn().execute(
            "INSERT INTO accounts (id, email, display_name, position, needs_reauth)
             VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(position), 0) + 1 FROM accounts), 0)
             ON CONFLICT(id) DO UPDATE SET display_name = COALESCE(excluded.display_name, display_name), needs_reauth = 0",
            params![a.id, a.email, a.display_name],
        )?;
        Ok(())
    }

    pub fn set_needs_reauth(&self, account: &str, value: bool) -> Result<()> {
        self.conn().execute("UPDATE accounts SET needs_reauth = ?2 WHERE id = ?1", params![account, value])?;
        Ok(())
    }

    pub fn remove_account(&self, account: &str) -> Result<()> {
        let c = self.conn();
        c.execute("DELETE FROM search_fts WHERE account_id = ?1", [account])?;
        c.execute("DELETE FROM accounts WHERE id = ?1", [account])?;
        Ok(())
    }

    pub fn history_id(&self, account: &str) -> Result<Option<String>> {
        Ok(self
            .conn()
            .query_row("SELECT history_id FROM accounts WHERE id = ?1", [account], |r| r.get(0))
            .optional()?
            .flatten())
    }

    pub fn set_history_id(&self, account: &str, history_id: &str) -> Result<()> {
        self.conn().execute("UPDATE accounts SET history_id = ?2 WHERE id = ?1", params![account, history_id])?;
        Ok(())
    }

    // ---- labels ----------------------------------------------------------------------

    pub fn replace_labels(&self, account: &str, labels: &[Label]) -> Result<()> {
        let mut c = self.conn();
        let tx = c.transaction()?;
        tx.execute("DELETE FROM labels WHERE account_id = ?1", [account])?;
        for l in labels {
            tx.execute(
                "INSERT INTO labels (account_id, id, name, kind, color_bg, color_text, threads_unread, threads_total, hidden)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![account, l.id, l.name, l.kind, l.color_bg, l.color_text, l.threads_unread, l.threads_total, l.hidden],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn labels(&self, account: Option<&str>) -> Result<Vec<Label>> {
        let c = self.conn();
        let mut st = c.prepare(
            "SELECT account_id, id, name, kind, color_bg, color_text, threads_unread, threads_total, hidden
             FROM labels WHERE (?1 IS NULL OR account_id = ?1) ORDER BY kind DESC, name COLLATE NOCASE",
        )?;
        let rows = st.query_map([account], |r| {
            Ok(Label {
                account_id: r.get(0)?,
                id: r.get(1)?,
                name: r.get(2)?,
                kind: r.get(3)?,
                color_bg: r.get(4)?,
                color_text: r.get(5)?,
                threads_unread: r.get(6)?,
                threads_total: r.get(7)?,
                hidden: r.get(8)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn inbox_unread_total(&self) -> Result<i64> {
        Ok(self.conn().query_row(
            "SELECT COALESCE(SUM(threads_unread), 0) FROM labels WHERE id = 'INBOX'",
            [],
            |r| r.get(0),
        )?)
    }

    // ---- threads ---------------------------------------------------------------------

    pub fn upsert_thread(&self, t: &ThreadSummary) -> Result<()> {
        let mut c = self.conn();
        let tx = c.transaction()?;
        tx.execute(
            "INSERT INTO threads (account_id, id, last_date, json) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(account_id, id) DO UPDATE SET last_date = excluded.last_date, json = excluded.json",
            params![t.account_id, t.id, t.last_date, json(t)],
        )?;
        tx.execute("DELETE FROM thread_labels WHERE account_id = ?1 AND thread_id = ?2", params![t.account_id, t.id])?;
        for l in &t.label_ids {
            tx.execute(
                "INSERT OR IGNORE INTO thread_labels (account_id, thread_id, label_id) VALUES (?1, ?2, ?3)",
                params![t.account_id, t.id, l],
            )?;
        }
        // Keep full-text bodies from a cached detail when only metadata changed.
        let body: Option<String> = tx
            .query_row(
                "SELECT body FROM search_fts WHERE account_id = ?1 AND thread_id = ?2",
                params![t.account_id, t.id],
                |r| r.get(0),
            )
            .optional()?;
        tx.execute("DELETE FROM search_fts WHERE account_id = ?1 AND thread_id = ?2", params![t.account_id, t.id])?;
        tx.execute(
            "INSERT INTO search_fts (account_id, thread_id, subject, people, body) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![t.account_id, t.id, t.subject, people(t), body.unwrap_or_else(|| t.snippet.clone())],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn delete_thread(&self, account: &str, thread_id: &str) -> Result<()> {
        let c = self.conn();
        c.execute("DELETE FROM search_fts WHERE account_id = ?1 AND thread_id = ?2", params![account, thread_id])?;
        c.execute("DELETE FROM threads WHERE account_id = ?1 AND id = ?2", params![account, thread_id])?;
        Ok(())
    }

    pub fn thread(&self, account: &str, thread_id: &str) -> Result<Option<ThreadSummary>> {
        let raw: Option<String> = self
            .conn()
            .query_row("SELECT json FROM threads WHERE account_id = ?1 AND id = ?2", params![account, thread_id], |r| r.get(0))
            .optional()?;
        Ok(raw.and_then(|j| serde_json::from_str(&j).ok()))
    }

    /// Threads carrying every label in `labels` (all accounts when `account` is None),
    /// newest first, optionally older than `before` (ms) for paging.
    pub fn threads(&self, account: Option<&str>, labels: &[String], before: Option<i64>, limit: i64) -> Result<Vec<ThreadSummary>> {
        let mut sql = String::from("SELECT t.json FROM threads t WHERE (?1 IS NULL OR t.account_id = ?1) AND (?2 IS NULL OR t.last_date < ?2)");
        for i in 0..labels.len() {
            sql.push_str(&format!(
                " AND EXISTS (SELECT 1 FROM thread_labels l WHERE l.account_id = t.account_id AND l.thread_id = t.id AND l.label_id = ?{})",
                i + 4
            ));
        }
        sql.push_str(" ORDER BY t.last_date DESC LIMIT ?3");
        let c = self.conn();
        let mut st = c.prepare(&sql)?;
        let mut values: Vec<rusqlite::types::Value> = vec![
            account.map(|a| a.to_string()).into(),
            before.into(),
            limit.into(),
        ];
        values.extend(labels.iter().map(|l| l.clone().into()));
        let rows = st.query_map(rusqlite::params_from_iter(values), |r| r.get::<_, String>(0))?;
        Ok(rows.filter_map(|r| r.ok()).filter_map(|j| serde_json::from_str(&j).ok()).collect())
    }

    pub fn thread_history_ids(&self, account: &str) -> Result<std::collections::HashMap<String, String>> {
        let c = self.conn();
        let mut st = c.prepare("SELECT id, json FROM threads WHERE account_id = ?1")?;
        let rows = st.query_map([account], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        Ok(rows
            .filter_map(|r| r.ok())
            .filter_map(|(id, j)| serde_json::from_str::<ThreadSummary>(&j).ok().map(|t| (id, t.history_id)))
            .collect())
    }

    /// Applies a label change locally after a successful API call.
    pub fn apply_labels(&self, account: &str, thread_id: &str, add: &[String], remove: &[String]) -> Result<Option<ThreadSummary>> {
        let Some(mut t) = self.thread(account, thread_id)? else { return Ok(None) };
        t.label_ids.retain(|l| !remove.contains(l));
        for l in add {
            if !t.label_ids.contains(l) {
                t.label_ids.push(l.clone());
            }
        }
        let has = |l: &str| t.label_ids.iter().any(|x| x == l);
        (t.unread, t.starred, t.important) = (has("UNREAD"), has("STARRED"), has("IMPORTANT"));
        self.upsert_thread(&t)?;
        if let Some((hist, mut msgs)) = self.thread_detail(account, thread_id)? {
            for m in &mut msgs {
                m.label_ids.retain(|l| !remove.contains(l) || l == "SENT" || l == "DRAFT");
                for l in add {
                    if !m.label_ids.contains(l) {
                        m.label_ids.push(l.clone());
                    }
                }
            }
            self.put_thread_detail(account, thread_id, &hist, &msgs)?;
        }
        Ok(Some(t))
    }

    pub fn thread_detail(&self, account: &str, thread_id: &str) -> Result<Option<(String, Vec<Message>)>> {
        let row: Option<(String, String)> = self
            .conn()
            .query_row(
                "SELECT history_id, messages FROM thread_details WHERE account_id = ?1 AND thread_id = ?2",
                params![account, thread_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        Ok(row.and_then(|(h, m)| serde_json::from_str(&m).ok().map(|m| (h, m))))
    }

    pub fn put_thread_detail(&self, account: &str, thread_id: &str, history_id: &str, msgs: &[Message]) -> Result<()> {
        let c = self.conn();
        c.execute(
            "INSERT INTO thread_details (account_id, thread_id, history_id, messages) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(account_id, thread_id) DO UPDATE SET history_id = excluded.history_id, messages = excluded.messages",
            params![account, thread_id, history_id, json(&msgs)],
        )?;
        let body: String = msgs.iter().filter_map(|m| m.text.clone().or_else(|| Some(m.snippet.clone()))).collect::<Vec<_>>().join("\n");
        c.execute("UPDATE search_fts SET body = ?3 WHERE account_id = ?1 AND thread_id = ?2", params![account, thread_id, body])?;
        Ok(())
    }

    // ---- search ----------------------------------------------------------------------

    /// Offline search over cached subjects, people and bodies.
    pub fn search(&self, account: Option<&str>, query: &str, limit: i64) -> Result<Vec<ThreadSummary>> {
        // Quote each term so FTS syntax characters in user input are taken literally.
        let fts: String = query
            .split_whitespace()
            .map(|w| format!("\"{}\"*", w.replace('"', "")))
            .collect::<Vec<_>>()
            .join(" ");
        if fts.is_empty() {
            return Ok(vec![]);
        }
        let c = self.conn();
        let mut st = c.prepare(
            "SELECT t.json FROM search_fts f JOIN threads t ON t.account_id = f.account_id AND t.id = f.thread_id
             WHERE search_fts MATCH ?1 AND (?2 IS NULL OR f.account_id = ?2) ORDER BY t.last_date DESC LIMIT ?3",
        )?;
        let rows = st.query_map(params![fts, account, limit], |r| r.get::<_, String>(0))?;
        Ok(rows.filter_map(|r| r.ok()).filter_map(|j| serde_json::from_str(&j).ok()).collect())
    }

    pub fn add_recent_search(&self, q: &str, at: i64) -> Result<()> {
        let c = self.conn();
        c.execute("INSERT OR REPLACE INTO recent_searches (query, at) VALUES (?1, ?2)", params![q, at])?;
        c.execute("DELETE FROM recent_searches WHERE query NOT IN (SELECT query FROM recent_searches ORDER BY at DESC LIMIT 20)", [])?;
        Ok(())
    }

    pub fn recent_searches(&self) -> Result<Vec<String>> {
        let c = self.conn();
        let mut st = c.prepare("SELECT query FROM recent_searches ORDER BY at DESC")?;
        let rows = st.query_map([], |r| r.get(0))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn clear_recent_searches(&self) -> Result<()> {
        self.conn().execute("DELETE FROM recent_searches", [])?;
        Ok(())
    }

    // ---- contacts --------------------------------------------------------------------

    pub fn add_contacts(&self, account: &str, contacts: &[Addr], used: bool) -> Result<()> {
        let mut c = self.conn();
        let tx = c.transaction()?;
        for a in contacts.iter().filter(|a| a.email.contains('@')) {
            tx.execute(
                "INSERT INTO contacts (account_id, email, name, uses) VALUES (?1, lower(?2), ?3, ?4)
                 ON CONFLICT(account_id, email) DO UPDATE SET
                   name = CASE WHEN excluded.name != '' THEN excluded.name ELSE name END, uses = uses + excluded.uses",
                params![account, a.email, a.name, used as i64],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn search_contacts(&self, account: Option<&str>, q: &str, limit: i64) -> Result<Vec<Addr>> {
        let like = format!("%{}%", q.to_lowercase().replace('%', ""));
        let c = self.conn();
        let mut st = c.prepare(
            "SELECT email, MAX(name), SUM(uses) u FROM contacts
             WHERE (?1 IS NULL OR account_id = ?1) AND (email LIKE ?2 OR lower(name) LIKE ?2)
             GROUP BY email ORDER BY u DESC, email LIMIT ?3",
        )?;
        let rows = st.query_map(params![account, like, limit], |r| Ok(Addr { email: r.get(0)?, name: r.get(1)? }))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db_with_account() -> Db {
        let db = Db::memory().unwrap();
        db.upsert_account(&Account { id: "a".into(), email: "a@x.com".into(), display_name: None, needs_reauth: false }).unwrap();
        db
    }

    fn thread(id: &str, date: i64, labels: &[&str], subject: &str) -> ThreadSummary {
        ThreadSummary {
            account_id: "a".into(),
            id: id.into(),
            subject: subject.into(),
            snippet: format!("snippet for {subject}"),
            senders: vec![Addr { name: "Ann Lee".into(), email: "ann@x.com".into() }],
            last_date: date,
            label_ids: labels.iter().map(|s| s.to_string()).collect(),
            ..Default::default()
        }
    }

    #[test]
    fn filters_threads_by_all_labels_and_pages_by_date() {
        let db = db_with_account();
        db.upsert_thread(&thread("1", 100, &["INBOX", "CATEGORY_PERSONAL"], "One")).unwrap();
        db.upsert_thread(&thread("2", 200, &["INBOX", "CATEGORY_SOCIAL"], "Two")).unwrap();
        db.upsert_thread(&thread("3", 300, &["INBOX", "CATEGORY_PERSONAL"], "Three")).unwrap();
        let primary = db.threads(None, &["INBOX".into(), "CATEGORY_PERSONAL".into()], None, 50).unwrap();
        assert_eq!(primary.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["3", "1"]);
        let older = db.threads(Some("a"), &["INBOX".into()], Some(300), 1).unwrap();
        assert_eq!(older[0].id, "2");
    }

    #[test]
    fn label_changes_update_flags_and_index() {
        let db = db_with_account();
        db.upsert_thread(&thread("1", 100, &["INBOX", "UNREAD"], "One")).unwrap();
        let t = db.apply_labels("a", "1", &["STARRED".into()], &["INBOX".into(), "UNREAD".into()]).unwrap().unwrap();
        assert!(t.starred && !t.unread);
        assert!(db.threads(None, &["INBOX".into()], None, 10).unwrap().is_empty());
        assert_eq!(db.threads(None, &["STARRED".into()], None, 10).unwrap().len(), 1);
    }

    #[test]
    fn full_text_search_uses_bodies_and_survives_metadata_updates() {
        let db = db_with_account();
        let t = thread("1", 100, &["INBOX"], "Quarterly plans");
        db.upsert_thread(&t).unwrap();
        let msg = Message { id: "m".into(), thread_id: "1".into(), text: Some("The budget spreadsheet is attached".into()), ..Default::default() };
        db.put_thread_detail("a", "1", "5", &[msg]).unwrap();
        db.upsert_thread(&t).unwrap(); // metadata refresh must keep the body text
        assert_eq!(db.search(None, "spreadsheet", 10).unwrap().len(), 1);
        assert_eq!(db.search(None, "quarter", 10).unwrap().len(), 1);
        assert_eq!(db.search(None, "ann", 10).unwrap().len(), 1);
        assert!(db.search(None, "\"unbalanced", 10).unwrap().is_empty());
    }

    #[test]
    fn contacts_rank_by_use() {
        let db = db_with_account();
        db.add_contacts("a", &[Addr { name: "Bob".into(), email: "Bob@Y.com".into() }, Addr { name: "".into(), email: "bobby@z.com".into() }], false).unwrap();
        db.add_contacts("a", &[Addr { name: "".into(), email: "bobby@z.com".into() }], true).unwrap();
        let found = db.search_contacts(None, "bob", 5).unwrap();
        assert_eq!(found[0].email, "bobby@z.com");
        assert_eq!(found[1], Addr { name: "Bob".into(), email: "bob@y.com".into() });
    }
}
