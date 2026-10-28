import { useQueryClient } from "@tanstack/react-query";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef, useState } from "react";
import { confirmDialog, Icon, IconButton, Spinner } from "../../components/ui";
import { htmlToText, textToHtml } from "../../lib/format";
import { api, native } from "../../lib/ipc";
import { refreshMail, useAccounts, usePrefs, useProviders, useSendAs } from "../../lib/queries";
import { useUi, type ComposeState } from "../../lib/store";
import type { Addr, Draft, DraftAttachment } from "../../lib/types";
import { RecipientField } from "./RecipientField";
import { signatureHtml } from "./startCompose";

let activeCompose: string | null = null;

/** Turns pasted/inline data: images into cid: parts so recipients see them. */
function extractInlineImages(html: string): { html: string; inline: DraftAttachment[] } {
  const inline: DraftAttachment[] = [];
  const out = html.replace(/<img([^>]*?)src="data:([^;"]+);base64,([^"]+)"([^>]*)>/g, (_m, pre, mime, data, post) => {
    const cid = `img${inline.length + 1}.${Date.now().toString(36)}@letterbox`;
    inline.push({ kind: "inline", data, mimeType: mime, filename: `image${inline.length + 1}.${mime.split("/")[1] ?? "png"}`, contentId: cid });
    return `<img${pre}src="cid:${cid}"${post}>`;
  });
  return { html: out, inline };
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export function Compose({ c }: { c: ComposeState }) {
  const { updateCompose, closeCompose, toast } = useUi();
  const qc = useQueryClient();
  const prefs = usePrefs();
  const accounts = useAccounts();
  const providers = useProviders().data ?? [];
  const sendAs = useSendAs(c.accountId).data ?? [];
  const [fromEmail, setFromEmail] = useState<string | null>(null);
  const [showCc, setShowCc] = useState(c.cc.length > 0);
  const [showBcc, setShowBcc] = useState(c.bcc.length > 0);
  const [showQuoted, setShowQuoted] = useState(false);
  const [formatBar, setFormatBar] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [busy, setBusy] = useState<"send" | "save" | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpText, setHelpText] = useState("");
  const [helpBusy, setHelpBusy] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const dirty = useRef(false);
  const state = useRef(c);
  state.current = c;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false, autolink: true }),
      Image.configure({ allowBase64: true, inline: true }),
      Placeholder.configure({ placeholder: "Compose email" }),
    ],
    content: c.html || "<p></p>",
    autofocus: c.mode === "new" && c.to.length === 0 ? false : "start",
    onUpdate: () => { dirty.current = true; },
  });

  const from: Addr = (() => {
    const s = sendAs.find((x) => x.sendAsEmail === fromEmail) ?? sendAs.find((x) => x.isDefault) ?? sendAs[0];
    const account = accounts.find((a) => a.id === c.accountId);
    return s ? { name: s.displayName ?? account?.displayName ?? "", email: s.sendAsEmail } : { name: account?.displayName ?? "", email: c.accountId };
  })();

  const buildDraft = useCallback((): Draft => {
    const cur = state.current;
    const body = (editor?.getHTML() ?? "") + (cur.quoted ? `<br>${cur.quoted}` : "");
    const { html, inline } = extractInlineImages(body);
    return {
      accountId: cur.accountId, draftId: cur.draftId, threadId: cur.threadId, from,
      to: cur.to, cc: cur.cc, bcc: cur.bcc, subject: cur.subject, html, text: htmlToText(html),
      inReplyTo: cur.inReplyTo, references: cur.references, attachments: [...cur.attachments, ...inline],
    };
  }, [editor, from]);

  const isEmpty = () => {
    const cur = state.current;
    return !cur.to.length && !cur.cc.length && !cur.bcc.length && !cur.subject.trim() && !(editor?.getText().trim()) && !cur.attachments.length;
  };

  const saveDraft = useCallback(async (quiet = true) => {
    if (!dirty.current || isEmpty()) return;
    dirty.current = false;
    setBusy((b) => b ?? "save");
    try {
      const saved = await api.saveDraft(buildDraft());
      updateCompose(state.current.key, { draftId: saved.draftId, threadId: state.current.threadId ?? saved.threadId });
      setSavedAt(Date.now());
      if (!quiet) toast({ text: "Draft saved" });
    } catch (e) {
      dirty.current = true;
      if (!quiet) toast({ text: String(e), error: true });
    } finally {
      setBusy((b) => (b === "save" ? null : b));
    }
  }, [buildDraft, updateCompose, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave like Gmail: a few seconds after the last change.
  useEffect(() => {
    const t = setInterval(() => void saveDraft(), 4000);
    return () => clearInterval(t);
  }, [saveDraft]);

  const set = (patch: Partial<ComposeState>) => {
    dirty.current = true;
    updateCompose(c.key, patch);
  };

  const addFiles = (paths: string[]) => {
    if (!paths.length) return;
    set({ attachments: [...state.current.attachments, ...paths.map((p) => ({ kind: "file" as const, path: p, filename: fileName(p) }))] });
  };

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void native.onFileDrop((paths) => {
      if (activeCompose === c.key) addFiles(paths);
      setDropping(false);
    }).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, [c.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    const cur = state.current;
    if (!cur.to.length && !cur.cc.length && !cur.bcc.length) return toast({ text: "Please specify at least one recipient.", error: true });
    if (!cur.subject.trim() && !(await confirmDialog("Send without a subject?", "This message has no subject.", "Send"))) return;
    if (prefs.confirmSend && !(await confirmDialog("Send this message?", `To ${cur.to.map((a) => a.email).join(", ")}`, "Send"))) return;
    setBusy("send");
    try {
      await api.sendMessage(buildDraft());
      closeCompose(c.key);
      toast({ text: "Message sent" });
      refreshMail(qc);
    } catch (e) {
      toast({ text: `Couldn't send: ${e}`, error: true });
      setBusy(null);
    }
  };

  const discard = async () => {
    closeCompose(c.key);
    if (state.current.draftId) {
      await api.deleteDraft(c.accountId, state.current.draftId, state.current.threadId).catch(() => {});
      refreshMail(qc);
    }
    toast({ text: "Draft discarded" });
  };

  const close = async () => {
    await saveDraft(false);
    closeCompose(c.key);
    refreshMail(qc);
  };

  const helpWrite = async () => {
    if (!helpText.trim() || !editor) return;
    setHelpBusy(true);
    try {
      const current = editor.getText();
      const out = await api.helpWrite(helpText, current, c.accountId, c.threadId);
      const sig = (sendAs.find((s) => s.sendAsEmail === from.email) ?? sendAs[0])?.signature;
      editor.commands.setContent(textToHtml(out) + signatureHtml(sig));
      dirty.current = true;
      setHelpOpen(false);
      setHelpText("");
    } catch (e) {
      toast({ text: String(e), error: true });
    } finally {
      setHelpBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void send(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); dirty.current = true; void saveDraft(false); }
    else if (e.key === "Escape") { e.preventDefault(); void close(); }
    e.stopPropagation(); // keep global shortcuts out of the editor
  };

  const title = c.subject || (c.mode === "forward" ? "Forward" : c.mode.startsWith("reply") ? "Reply" : "New Message");
  const hasWrite = !!prefs.llmFeatures?.write && providers.some((p) => p.id === prefs.llmFeatures?.write);
  const ownAccounts = accounts.length > 1 && !c.threadId;

  return (
    <div
      className={`compose ${c.minimized ? "min" : ""} ${maximized && !c.minimized ? "max" : ""}`}
      role="dialog"
      aria-label={title}
      onKeyDown={onKeyDown}
      onFocus={() => (activeCompose = c.key)}
      onMouseEnter={() => (activeCompose = c.key)}
      onDragEnter={() => setDropping(true)}
      onDragLeave={(e) => e.currentTarget === e.target && setDropping(false)}
      style={{ position: maximized && !c.minimized ? "fixed" : "relative" }}
    >
      <div className="compose-head" onClick={() => c.minimized && updateCompose(c.key, { minimized: false })}>
        <span className="t">{title}</span>
        <IconButton small icon={c.minimized ? "expand_less" : "minimize"} label={c.minimized ? "Expand" : "Minimize"}
          onClick={(e) => { e.stopPropagation(); updateCompose(c.key, { minimized: !c.minimized }); }} />
        {!c.minimized && <IconButton small icon={maximized ? "close_fullscreen" : "open_in_full"} label={maximized ? "Exit full screen" : "Full screen"} onClick={() => setMaximized(!maximized)} />}
        <IconButton small icon="close" label="Save & close (Esc)" onClick={(e) => { e.stopPropagation(); void close(); }} />
      </div>
      {!c.minimized && (
        <>
          {dropping && <div className="drop-hint">Drop files to attach</div>}
          {(sendAs.length > 1 || ownAccounts) && (
            <div className="field">
              <label>From</label>
              <select
                value={`${c.accountId}|${from.email}`}
                onChange={(e) => {
                  const [acct, email] = e.target.value.split("|");
                  if (acct !== c.accountId) set({ accountId: acct, draftId: null });
                  setFromEmail(email);
                }}
                aria-label="From"
              >
                {sendAs.map((s) => (
                  <option key={s.sendAsEmail} value={`${c.accountId}|${s.sendAsEmail}`}>
                    {s.displayName ? `${s.displayName} <${s.sendAsEmail}>` : s.sendAsEmail}
                  </option>
                ))}
                {ownAccounts && accounts.filter((a) => a.id !== c.accountId).map((a) => (
                  <option key={a.id} value={`${a.id}|${a.email}`}>{a.displayName ? `${a.displayName} <${a.email}>` : a.email}</option>
                ))}
              </select>
            </div>
          )}
          <RecipientField
            label="To" value={c.to} onChange={(to) => set({ to })} accountId={c.accountId}
            autoFocus={c.mode === "new" && c.to.length === 0 || c.mode === "forward"}
            extra={(!showCc || !showBcc) && (
              <div className="toggles">
                {!showCc && <button onClick={() => setShowCc(true)}>Cc</button>}
                {!showBcc && <button onClick={() => setShowBcc(true)}>Bcc</button>}
              </div>
            )}
          />
          {showCc && <RecipientField label="Cc" value={c.cc} onChange={(cc) => set({ cc })} accountId={c.accountId} />}
          {showBcc && <RecipientField label="Bcc" value={c.bcc} onChange={(bcc) => set({ bcc })} accountId={c.accountId} />}
          <div className="field">
            <input placeholder="Subject" aria-label="Subject" value={c.subject} onChange={(e) => set({ subject: e.target.value })} />
          </div>
          <div className="editor" onClick={() => editor?.commands.focus()}>
            <EditorContent editor={editor} />
          </div>
          {c.quoted && (
            <>
              <button className="quoted-toggle" style={{ margin: "0 16px 8px" }} title={showQuoted ? "Hide quoted text" : "Show quoted text"} onClick={() => setShowQuoted(!showQuoted)}>
                <Icon name="more_horiz" />
              </button>
              {showQuoted && <div className="quoted-preview" dangerouslySetInnerHTML={{ __html: htmlToText(c.quoted).replace(/[<>&]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[ch]!).replace(/\n/g, "<br>") }} />}
            </>
          )}
          {c.attachments.length > 0 && (
            <div className="compose-atts">
              {c.attachments.filter((a) => a.kind !== "inline").map((a, i) => (
                <span key={i} className="recip" title={a.kind === "file" ? a.path : a.filename}>
                  <Icon name="attach_file" /> {a.filename}
                  <button aria-label={`Remove ${a.filename}`} onClick={() => set({ attachments: c.attachments.filter((x) => x !== a) })}><Icon name="close" /></button>
                </span>
              ))}
            </div>
          )}
          {helpOpen && (
            <div className="help-write">
              <Icon name="auto_awesome" className="sparkle" />
              <input
                autoFocus
                placeholder={editor?.getText().trim() ? "How should I rewrite this? (e.g. shorter, more formal)" : "Help me write… (e.g. decline politely, suggest Tuesday)"}
                value={helpText}
                onChange={(e) => setHelpText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void helpWrite(); } if (e.key === "Escape") { e.stopPropagation(); setHelpOpen(false); } }}
              />
              {helpBusy ? <Spinner /> : <button className="btn tonal" onClick={() => void helpWrite()}>Create</button>}
            </div>
          )}
          {linkUrl !== null && (
            <div className="help-write">
              <Icon name="link" />
              <input
                autoFocus
                aria-label="Link URL"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (/^(https?:|mailto:)/.test(linkUrl)) editor?.chain().focus().extendMarkRange("link").setLink({ href: linkUrl }).run();
                    setLinkUrl(null);
                  }
                  if (e.key === "Escape") { e.stopPropagation(); setLinkUrl(null); }
                }}
              />
              <button className="btn text" onClick={() => setLinkUrl(null)}>Cancel</button>
            </div>
          )}
          {formatBar && editor && (
            <div className="format-bar">
              <IconButton small icon="format_bold" label="Bold (⌘B)" className={editor.isActive("bold") ? "on" : ""} onClick={() => editor.chain().focus().toggleBold().run()} />
              <IconButton small icon="format_italic" label="Italic (⌘I)" className={editor.isActive("italic") ? "on" : ""} onClick={() => editor.chain().focus().toggleItalic().run()} />
              <IconButton small icon="format_underlined" label="Underline (⌘U)" className={editor.isActive("underline") ? "on" : ""} onClick={() => editor.chain().focus().toggleUnderline().run()} />
              <IconButton small icon="strikethrough_s" label="Strikethrough" className={editor.isActive("strike") ? "on" : ""} onClick={() => editor.chain().focus().toggleStrike().run()} />
              <IconButton small icon="format_list_bulleted" label="Bulleted list" className={editor.isActive("bulletList") ? "on" : ""} onClick={() => editor.chain().focus().toggleBulletList().run()} />
              <IconButton small icon="format_list_numbered" label="Numbered list" className={editor.isActive("orderedList") ? "on" : ""} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
              <IconButton small icon="format_quote" label="Quote" className={editor.isActive("blockquote") ? "on" : ""} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
              <IconButton small icon="format_clear" label="Remove formatting" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} />
            </div>
          )}
          <div className="compose-foot">
            <button className="btn filled" onClick={() => void send()} disabled={busy === "send"}>
              {busy === "send" ? "Sending…" : "Send"}
            </button>
            <IconButton icon="format_color_text" label="Formatting options" className={formatBar ? "on" : ""} onClick={() => setFormatBar(!formatBar)} />
            <IconButton icon="attach_file" label="Attach files" onClick={() => void native.pickFiles().then(addFiles)} />
            <IconButton icon="link" label="Insert link" onClick={() => setLinkUrl(linkUrl === null ? "https://" : null)} />
            {hasWrite && <IconButton icon="auto_awesome" label="Help me write" className="sparkle" onClick={() => setHelpOpen(!helpOpen)} />}
            <span className="spacer" />
            <span className="muted" style={{ fontSize: 12 }}>{busy === "save" ? "Saving…" : savedAt ? "Draft saved" : ""}</span>
            <IconButton icon="delete" label="Discard draft" onClick={() => void discard()} />
          </div>
        </>
      )}
    </div>
  );
}

export function ComposeDock() {
  const composes = useUi((s) => s.composes);
  if (!composes.length) return null;
  return (
    <div className="compose-dock">
      {composes.map((c) => <Compose key={c.key} c={c} />)}
    </div>
  );
}
