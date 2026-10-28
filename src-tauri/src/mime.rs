//! Builds RFC 5322 messages for sending and drafts.

use crate::error::Result;
use crate::model::Addr;
use mail_builder::headers::address::Address;
use mail_builder::MessageBuilder;

pub struct OutAttachment {
    pub filename: String,
    pub mime_type: String,
    pub data: Vec<u8>,
    /// Set for images embedded in the HTML body (`<img src="cid:…">`).
    pub content_id: Option<String>,
}

pub struct Outgoing {
    pub from: Addr,
    pub to: Vec<Addr>,
    pub cc: Vec<Addr>,
    pub bcc: Vec<Addr>,
    pub subject: String,
    pub html: String,
    pub text: String,
    pub in_reply_to: Option<String>,
    pub references: Option<String>,
    pub attachments: Vec<OutAttachment>,
}

fn addresses(list: &[Addr]) -> Address<'static> {
    Address::new_list(
        list.iter()
            .map(|a| Address::new_address((!a.name.is_empty()).then(|| a.name.clone()), a.email.clone()))
            .collect(),
    )
}

fn msg_ids(raw: &str) -> Vec<String> {
    raw.split_whitespace().map(|id| id.trim_matches(['<', '>']).to_string()).filter(|s| !s.is_empty()).collect()
}

pub fn build(o: &Outgoing) -> Result<Vec<u8>> {
    let mut b = MessageBuilder::new()
        .from(addresses(std::slice::from_ref(&o.from)))
        .subject(o.subject.clone())
        .html_body(o.html.clone())
        .text_body(o.text.clone());
    if !o.to.is_empty() {
        b = b.to(addresses(&o.to));
    }
    if !o.cc.is_empty() {
        b = b.cc(addresses(&o.cc));
    }
    if !o.bcc.is_empty() {
        b = b.bcc(addresses(&o.bcc));
    }
    if let Some(parent) = &o.in_reply_to {
        let parent_ids = msg_ids(parent);
        // References = parent's References + parent's Message-ID (RFC 5322 §3.6.4).
        let mut refs = o.references.as_deref().map(msg_ids).unwrap_or_default();
        refs.extend(parent_ids.iter().cloned());
        b = b.in_reply_to(parent_ids).references(refs);
    }
    for a in &o.attachments {
        b = match &a.content_id {
            Some(cid) => b.inline(a.mime_type.clone(), cid.clone(), a.data.clone()),
            None => b.attachment(a.mime_type.clone(), a.filename.clone(), a.data.clone()),
        };
    }
    Ok(b.write_to_vec()?)
}


#[cfg(test)]
mod tests {
    use super::*;

    fn addr(name: &str, email: &str) -> Addr {
        Addr { name: name.into(), email: email.into() }
    }

    #[test]
    fn builds_threaded_reply_with_attachment() {
        let raw = build(&Outgoing {
            from: addr("Mike V", "mike@example.com"),
            to: vec![addr("Ann", "ann@example.com")],
            cc: vec![],
            bcc: vec![addr("", "secret@example.com")],
            subject: "Re: Plans".into(),
            html: "<p>Sounds good</p>".into(),
            text: "Sounds good".into(),
            in_reply_to: Some("<m2@example.com>".into()),
            references: Some("<m1@example.com>".into()),
            attachments: vec![OutAttachment {
                filename: "notes.txt".into(),
                mime_type: "text/plain".into(),
                data: b"hello".to_vec(),
                content_id: None,
            }],
        })
        .unwrap();
        let s = String::from_utf8(raw).unwrap();
        assert!(s.contains("From: \"Mike V\" <mike@example.com>"), "{s}");
        assert!(s.contains("To: \"Ann\" <ann@example.com>"));
        assert!(s.contains("Bcc: <secret@example.com>"));
        assert!(s.contains("In-Reply-To: <m2@example.com>"));
        assert!(s.contains("References: <m1@example.com> <m2@example.com>"));
        assert!(s.contains("multipart/alternative"));
        assert!(s.contains("notes.txt"));
        assert!(!s.contains("Cc:"));
    }

}
