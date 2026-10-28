//! Turns Gmail API resources (threads, messages, MIME part trees) into our model.

use crate::gmail::{decode_b64url, GMessage, GPart, GThread};
use crate::model::{Addr, Attachment, Message, ThreadSummary};

/// Splits an address-list header ("A <a@x>, \"B, C\" <b@x>, c@x") into addresses.
/// Gmail has already decoded RFC 2047 words, so only quoting needs handling.
pub fn parse_addrs(value: &str) -> Vec<Addr> {
    let mut parts = Vec::new();
    let (mut cur, mut quoted, mut angle) = (String::new(), false, false);
    for ch in value.chars() {
        match ch {
            '"' => quoted = !quoted,
            '<' if !quoted => angle = true,
            '>' if !quoted => angle = false,
            ',' | ';' if !quoted && !angle => {
                parts.push(std::mem::take(&mut cur));
                continue;
            }
            _ => {}
        }
        cur.push(ch);
    }
    parts.push(cur);
    parts.iter().filter_map(|p| parse_addr(p)).collect()
}

fn parse_addr(raw: &str) -> Option<Addr> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if let (Some(lt), Some(gt)) = (raw.rfind('<'), raw.rfind('>')) {
        if lt < gt {
            let email = raw[lt + 1..gt].trim().to_string();
            let name = raw[..lt].trim().trim_matches('"').trim().replace("\\\"", "\"");
            return Some(Addr { name, email });
        }
    }
    raw.contains('@').then(|| Addr { name: String::new(), email: raw.trim_matches('"').to_string() })
}

fn charset_of(content_type: Option<&str>) -> Option<String> {
    let ct = content_type?;
    ct.split(';').skip(1).find_map(|p| {
        let (k, v) = p.split_once('=')?;
        k.trim().eq_ignore_ascii_case("charset").then(|| v.trim().trim_matches('"').to_lowercase())
    })
}

fn decode_text(part: &GPart) -> Option<String> {
    let data = part.body.as_ref()?.data.as_deref()?;
    let bytes = decode_b64url(data).ok()?;
    let charset = charset_of(part.header("Content-Type")).unwrap_or_else(|| "utf-8".into());
    let enc = encoding_rs::Encoding::for_label(charset.as_bytes()).unwrap_or(encoding_rs::UTF_8);
    Some(enc.decode(&bytes).0.into_owned())
}

#[derive(Default)]
struct Bodies {
    html: Vec<String>,
    text: Vec<String>,
    attachments: Vec<Attachment>,
}

fn walk(part: &GPart, in_related: bool, out: &mut Bodies) {
    let mime = part.mime_type.to_lowercase();
    if mime.starts_with("multipart/") {
        let related = mime == "multipart/related";
        if mime == "multipart/alternative" {
            // Prefer the richest alternative: last html part, else last text part.
            let html = part.parts.iter().rev().find(|p| p.mime_type.eq_ignore_ascii_case("text/html") || p.mime_type.starts_with("multipart/"));
            let text = part.parts.iter().rev().find(|p| p.mime_type.eq_ignore_ascii_case("text/plain"));
            if let Some(h) = html {
                walk(h, in_related, out);
            }
            if let Some(t) = text {
                if let Some(s) = decode_text(t) {
                    out.text.push(s);
                }
            }
            return;
        }
        for p in &part.parts {
            walk(p, in_related || related, out);
        }
        return;
    }

    let body = part.body.clone().unwrap_or_default();
    let disposition = part.header("Content-Disposition").unwrap_or("").to_lowercase();
    let content_id = part.header("Content-ID").map(|c| c.trim().trim_matches(['<', '>']).to_string());
    let is_attachment = !part.filename.is_empty() || disposition.starts_with("attachment") || body.attachment_id.is_some();

    if !is_attachment && (mime == "text/html" || mime == "text/plain") {
        if let Some(s) = decode_text(part) {
            if mime == "text/html" { out.html.push(s) } else { out.text.push(s) }
        }
        return;
    }
    if let Some(id) = body.attachment_id {
        let inline = content_id.is_some() && (in_related || disposition.starts_with("inline"));
        out.attachments.push(Attachment {
            attachment_id: id,
            filename: if part.filename.is_empty() { "attachment".into() } else { part.filename.clone() },
            mime_type: mime,
            size: body.size,
            content_id,
            inline,
        });
    }
}

pub fn message(m: &GMessage) -> Message {
    let payload = m.payload.clone().unwrap_or_default();
    let header = |n: &str| payload.header(n).map(str::to_string);
    let addrs = |n: &str| header(n).map(|v| parse_addrs(&v)).unwrap_or_default();
    let mut bodies = Bodies::default();
    walk(&payload, false, &mut bodies);
    Message {
        id: m.id.clone(),
        thread_id: m.thread_id.clone(),
        label_ids: m.label_ids.clone(),
        date: m.internal_date.as_deref().and_then(|d| d.parse().ok()).unwrap_or(0),
        from: addrs("From").into_iter().next().unwrap_or_default(),
        to: addrs("To"),
        cc: addrs("Cc"),
        bcc: addrs("Bcc"),
        reply_to: addrs("Reply-To"),
        subject: header("Subject").unwrap_or_default(),
        snippet: html_escape::decode_html_entities(m.snippet.as_deref().unwrap_or("")).into_owned(),
        html: (!bodies.html.is_empty()).then(|| bodies.html.join("<hr>")),
        text: (!bodies.text.is_empty()).then(|| bodies.text.join("\n\n")),
        attachments: bodies.attachments,
        message_id_header: header("Message-ID").or_else(|| header("Message-Id")),
        references: header("References"),
        list_unsubscribe: header("List-Unsubscribe"),
        list_unsubscribe_post: header("List-Unsubscribe-Post"),
    }
}

/// Builds the list-row summary for a thread fetched in `metadata` or `full` format.
pub fn summary(account_id: &str, t: &GThread) -> ThreadSummary {
    let msgs: Vec<&GMessage> = t.messages.iter().filter(|m| !m.label_ids.iter().any(|l| l == "TRASH") || t.messages.iter().all(|m| m.label_ids.iter().any(|l| l == "TRASH"))).collect();
    let msgs = if msgs.is_empty() { t.messages.iter().collect() } else { msgs };
    let first = msgs.first().map(|m| message(m)).unwrap_or_default();
    let last = msgs.last().copied();

    let mut senders: Vec<Addr> = Vec::new();
    let mut labels: Vec<String> = Vec::new();
    let mut has_attachments = false;
    for m in &msgs {
        let parsed = message(m);
        if !senders.iter().any(|s| s.email.eq_ignore_ascii_case(&parsed.from.email)) && !parsed.from.email.is_empty() {
            senders.push(parsed.from);
        }
        for l in &m.label_ids {
            if !labels.contains(l) {
                labels.push(l.clone());
            }
        }
        let p = m.payload.as_ref();
        has_attachments |= p.is_some_and(|p| p.mime_type.eq_ignore_ascii_case("multipart/mixed"))
            || !parsed.attachments.iter().all(|a| a.inline);
    }
    let has = |l: &str| labels.iter().any(|x| x == l);
    ThreadSummary {
        account_id: account_id.to_string(),
        id: t.id.clone(),
        history_id: t.history_id.clone().unwrap_or_default(),
        subject: if first.subject.is_empty() { "(no subject)".into() } else { first.subject },
        snippet: last
            .and_then(|m| m.snippet.as_deref())
            .map(|s| html_escape::decode_html_entities(s).into_owned())
            .unwrap_or_default(),
        senders,
        last_date: last.and_then(|m| m.internal_date.as_deref()).and_then(|d| d.parse().ok()).unwrap_or(0),
        unread: has("UNREAD"),
        starred: has("STARRED"),
        important: has("IMPORTANT"),
        message_count: msgs.len() as i64,
        has_attachments,
        label_ids: labels,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gmail::{GBody, GHeader};
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};

    fn h(n: &str, v: &str) -> GHeader {
        GHeader { name: n.into(), value: v.into() }
    }

    fn leaf(mime: &str, headers: Vec<GHeader>, data: &[u8]) -> GPart {
        GPart {
            mime_type: mime.into(),
            headers,
            body: Some(GBody { data: Some(URL_SAFE_NO_PAD.encode(data)), size: data.len() as i64, attachment_id: None }),
            ..Default::default()
        }
    }

    #[test]
    fn parses_address_lists() {
        let a = parse_addrs(r#""Doe, Jane" <jane@x.com>, Bob <bob@y.org>; carol@z.net"#);
        assert_eq!(a.len(), 3);
        assert_eq!(a[0], Addr { name: "Doe, Jane".into(), email: "jane@x.com".into() });
        assert_eq!(a[1].email, "bob@y.org");
        assert_eq!(a[2], Addr { name: "".into(), email: "carol@z.net".into() });
        assert!(parse_addrs("undisclosed-recipients:;").is_empty());
    }

    #[test]
    fn extracts_alternative_bodies_attachments_and_charset() {
        let payload = GPart {
            mime_type: "multipart/mixed".into(),
            headers: vec![h("From", "Ann <ann@x.com>"), h("Subject", "Hi"), h("Message-ID", "<m1@x>")],
            parts: vec![
                GPart {
                    mime_type: "multipart/related".into(),
                    parts: vec![
                        GPart {
                            mime_type: "multipart/alternative".into(),
                            parts: vec![
                                leaf("text/plain", vec![h("Content-Type", "text/plain; charset=\"ISO-8859-1\"")], b"caf\xe9"),
                                leaf("text/html", vec![], b"<p>caf&eacute; <img src=\"cid:logo\"></p>"),
                            ],
                            ..Default::default()
                        },
                        GPart {
                            mime_type: "image/png".into(),
                            filename: "logo.png".into(),
                            headers: vec![h("Content-ID", "<logo>")],
                            body: Some(GBody { attachment_id: Some("att-logo".into()), size: 10, data: None }),
                            ..Default::default()
                        },
                    ],
                    ..Default::default()
                },
                GPart {
                    mime_type: "application/pdf".into(),
                    filename: "report.pdf".into(),
                    headers: vec![h("Content-Disposition", "attachment; filename=report.pdf")],
                    body: Some(GBody { attachment_id: Some("att-pdf".into()), size: 2048, data: None }),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let m = message(&GMessage {
            id: "m1".into(),
            thread_id: "t1".into(),
            label_ids: vec!["INBOX".into(), "UNREAD".into()],
            snippet: Some("caf&#233;".into()),
            internal_date: Some("1700000000000".into()),
            payload: Some(payload),
        });
        assert_eq!(m.text.as_deref(), Some("café"));
        assert!(m.html.unwrap().contains("cid:logo"));
        assert_eq!(m.snippet, "café");
        assert_eq!(m.message_id_header.as_deref(), Some("<m1@x>"));
        assert_eq!(m.attachments.len(), 2);
        assert!(m.attachments[0].inline && m.attachments[0].content_id.as_deref() == Some("logo"));
        assert!(!m.attachments[1].inline);
    }

    #[test]
    fn summarises_thread() {
        let msg = |id: &str, from: &str, labels: &[&str], date: &str| GMessage {
            id: id.into(),
            thread_id: "t".into(),
            label_ids: labels.iter().map(|s| s.to_string()).collect(),
            snippet: Some(format!("snippet {id}")),
            internal_date: Some(date.into()),
            payload: Some(GPart { mime_type: "text/plain".into(), headers: vec![h("From", from), h("Subject", "Plans")], ..Default::default() }),
        };
        let t = GThread {
            id: "t".into(),
            history_id: Some("99".into()),
            snippet: None,
            messages: vec![
                msg("a", "Ann <ann@x.com>", &["INBOX"], "1000"),
                msg("b", "Bob <bob@x.com>", &["INBOX", "UNREAD", "STARRED"], "2000"),
                msg("c", "ann@x.com", &["SENT"], "3000"),
            ],
        };
        let s = summary("me@x.com", &t);
        assert_eq!(s.subject, "Plans");
        assert_eq!(s.snippet, "snippet c");
        assert_eq!(s.last_date, 3000);
        assert_eq!(s.senders.len(), 2);
        assert!(s.unread && s.starred && !s.important);
        assert_eq!(s.message_count, 3);
    }
}
