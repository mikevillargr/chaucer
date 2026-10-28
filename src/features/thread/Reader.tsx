import { useQueryClient } from "@tanstack/react-query";
import { readableOn } from "../../lib/color";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar, confirmDialog, Icon, IconButton, Menu, Spinner } from "../../components/ui";
import { displayName, formatAddr, fullDate, parseMailto, shortDate } from "../../lib/format";
import { api, native } from "../../lib/ipc";
import { chipLabels } from "../../lib/labels";
import { useAccounts, useActions, useLabels, usePrefs, useProviders, useThread } from "../../lib/queries";
import { useUi } from "../../lib/store";
import type { Message, ThreadDetail, ThreadRef } from "../../lib/types";
import { useStartCompose } from "../compose/startCompose";
import { LabelMenu } from "../mailbox/LabelMenu";
import { Attachments } from "./Attachments";
import { EmailFrame, type Appearance } from "./EmailFrame";
import { useResolvedTheme } from "../../lib/theme";
import { useConfirmed } from "./useConfirmed";

/** Moves selection after the open thread leaves the list ("Auto-advance" setting). */
export function useAdvance() {
  const prefs = usePrefs();
  return useCallback((from: ThreadRef) => {
    const { order, select } = useUi.getState();
    const i = order.findIndex((r) => r.threadId === from.threadId && r.accountId === from.accountId);
    const mode = prefs.autoAdvance ?? "newer";
    if (mode === "list" || i < 0) return select(null);
    const next = mode === "newer" ? order[i - 1] ?? order[i + 1] : order[i + 1] ?? order[i - 1];
    select(next ?? null);
  }, [prefs.autoAdvance]);
}

function MessageView({ detail, m, expanded, onToggle, me, isLast }: {
  detail: ThreadDetail; m: Message; expanded: boolean; onToggle: () => void; me?: string; isLast: boolean;
}) {
  const prefs = usePrefs();
  const startCompose = useStartCompose();
  const toast = useUi((s) => s.toast);
  const [allowImages, setAllowImages] = useState(prefs.externalImages === "always");
  const [showQuoted, setShowQuoted] = useState(false);
  const theme = useResolvedTheme();
  const [original, setOriginal] = useState(false);
  const [info, setInfo] = useState<{ blocked: number; hasQuote: boolean; designed: boolean; appearance: Appearance }>({ blocked: 0, hasQuote: false, designed: false, appearance: "light" });
  const [details, setDetails] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const accountId = detail.summary.accountId;
  const isDraft = m.labelIds.includes("DRAFT");

  const onLink = useCallback((href: string) => {
    if (href.startsWith("mailto:")) {
      const f = parseMailto(href);
      void startCompose({ accountId, to: f.to, cc: f.cc, bcc: f.bcc, subject: f.subject, body: f.body });
    } else if (/^https?:/i.test(href)) {
      void native.openUrl(href);
    }
  }, [accountId, startCompose]);

  const unsubscribe = async () => {
    if (!(await confirmDialog("Unsubscribe?", `Stop getting messages from ${displayName(m.from)}?`, "Unsubscribe"))) return;
    try {
      const url = await api.unsubscribe(accountId, detail.summary.id, m.id);
      if (url) await native.openUrl(url);
      toast({ text: url ? "Finish unsubscribing in your browser" : `Unsubscribed from ${displayName(m.from)}` });
    } catch (e) {
      toast({ text: String(e), error: true });
    }
  };

  const block = async () => {
    if (!(await confirmDialog(`Block ${m.from.email}?`, "Future messages from this sender will go to Trash.", "Block"))) return;
    try {
      await api.blockSender(accountId, m.from.email);
      toast({ text: `Blocked ${m.from.email}` });
    } catch (e) {
      toast({ text: String(e), error: true });
    }
  };

  const recipients = [...m.to, ...m.cc].map((a) => displayName(a, me)).join(", ");

  if (!expanded) {
    return (
      <div className="msg collapsed" onClick={onToggle}>
        <div className="msg-head">
          <Avatar addr={m.from} />
          <div style={{ minWidth: 0 }}>
            <span className="name">{displayName(m.from, me)}</span>
            {isDraft && <span style={{ color: "var(--error)" }}> Draft</span>}
            <div className="snippet">{m.snippet}</div>
          </div>
          <div className="meta">{shortDate(m.date)}</div>
        </div>
      </div>
    );
  }

  return (
    <article className="msg">
      <div className="msg-head">
        <Avatar addr={m.from} />
        <div style={{ minWidth: 0 }} onClick={isLast ? undefined : onToggle}>
          <span className="name">{m.from.name || m.from.email}</span>
          {m.from.name && <span className="email">&lt;{m.from.email}&gt;</span>}
          {m.listUnsubscribe && (
            <button className="btn text" style={{ height: 22, padding: "0 6px", fontSize: 12 }} onClick={(e) => { e.stopPropagation(); void unsubscribe(); }}>
              Unsubscribe
            </button>
          )}
          <div className="to" onClick={(e) => { e.stopPropagation(); setDetails(!details); }}>
            to {recipients || "undisclosed recipients"} <Icon name={details ? "arrow_drop_up" : "arrow_drop_down"} />
          </div>
          {details && (
            <div className="card" style={{ marginTop: 8, fontSize: 12 }}>
              <div className="form-grid" style={{ gridTemplateColumns: "60px 1fr", gap: "2px 12px" }}>
                <label>from:</label><span>{formatAddr(m.from)}</span>
                {m.replyTo.length > 0 && <><label>reply-to:</label><span>{m.replyTo.map(formatAddr).join(", ")}</span></>}
                <label>to:</label><span>{m.to.map(formatAddr).join(", ")}</span>
                {m.cc.length > 0 && <><label>cc:</label><span>{m.cc.map(formatAddr).join(", ")}</span></>}
                {m.bcc.length > 0 && <><label>bcc:</label><span>{m.bcc.map(formatAddr).join(", ")}</span></>}
                <label>date:</label><span>{fullDate(m.date)}</span>
                <label>subject:</label><span>{m.subject}</span>
              </div>
            </div>
          )}
        </div>
        <div className="meta">
          <span title={fullDate(m.date)}>{shortDate(m.date)}</span>
          {isDraft ? (
            <button className="btn text" onClick={() => void startCompose.editDraft(detail, m)}>Edit</button>
          ) : (
            <IconButton small icon="reply" label="Reply" onClick={() => void startCompose.reply(detail, m, "reply")} />
          )}
          <IconButton small icon="more_vert" label="More" onClick={(e) => setMenu(e.currentTarget as HTMLElement)} />
        </div>
      </div>
      <div className="msg-body">
        {theme === "dark" && m.html && (
          <div className="appearance-toggle">
            <button
              className="btn text"
              onClick={() => setOriginal(info.appearance === "dark")}
              title={info.appearance === "dark" ? "Show the sender's own colours" : "Show this email in dark colours"}
            >
              <Icon name={info.appearance === "dark" ? "light_mode" : "dark_mode"} />
              {info.appearance === "dark" ? "Original colours" : "Dark"}
            </button>
          </div>
        )}
        {info.blocked > 0 && !allowImages && (
          <div className="images-blocked">
            <Icon name="hide_image" /> Images are hidden.
            <button className="btn text" style={{ height: 28 }} onClick={() => setAllowImages(true)}>Show images</button>
          </div>
        )}
        {m.html ? (
          <EmailFrame html={m.html} allowRemote={allowImages} showQuoted={showQuoted} theme={theme} original={original} onLink={onLink} onInfo={setInfo} />
        ) : (
          <div className="plain">{m.text ?? m.snippet}</div>
        )}
        {info.hasQuote && (
          <button className="quoted-toggle" style={{ margin: "6px 0 0" }} title={showQuoted ? "Hide trimmed content" : "Show trimmed content"} onClick={() => setShowQuoted(!showQuoted)}>
            <Icon name="more_horiz" />
          </button>
        )}
      </div>
      <Attachments accountId={accountId} messageId={m.id} items={m.attachments} />
      {menu && (
        <Menu anchor={menu} onClose={() => setMenu(null)} align="right">
          <button onClick={() => { setMenu(null); void startCompose.reply(detail, m, "reply"); }}><Icon name="reply" /> Reply</button>
          <button onClick={() => { setMenu(null); void startCompose.reply(detail, m, "replyAll"); }}><Icon name="reply_all" /> Reply all</button>
          <button onClick={() => { setMenu(null); void startCompose.forward(detail, m); }}><Icon name="forward" /> Forward</button>
          <hr />
          {m.listUnsubscribe && <button onClick={() => { setMenu(null); void unsubscribe(); }}><Icon name="unsubscribe" /> Unsubscribe</button>}
          <button onClick={() => { setMenu(null); void block(); }}><Icon name="block" /> Block "{displayName(m.from)}"</button>
          <button onClick={() => { setMenu(null); window.print(); }}><Icon name="print" /> Print</button>
        </Menu>
      )}
    </article>
  );
}

function SmartReplies({ detail, last }: { detail: ThreadDetail; last: Message }) {
  const startCompose = useStartCompose();
  const [state, setState] = useState<{ loading: boolean; replies: string[] | null; error?: string }>({ loading: false, replies: null });
  useEffect(() => setState({ loading: false, replies: null }), [detail.summary.id]);
  const load = async () => {
    setState({ loading: true, replies: null });
    try {
      setState({ loading: false, replies: await api.smartReplies(detail.summary.accountId, detail.summary.id) });
    } catch (e) {
      setState({ loading: false, replies: null, error: String(e) });
    }
  };
  return (
    <div className="smart-chips">
      {state.replies ? (
        state.replies.map((r) => (
          <button key={r} className="btn" onClick={() => void startCompose.reply(detail, last, "reply", r)}>{r}</button>
        ))
      ) : (
        <button className="btn" onClick={() => void load()} disabled={state.loading}>
          {state.loading ? <Spinner /> : <Icon name="auto_awesome" className="sparkle" />} Suggest replies
        </button>
      )}
      {state.error && <span className="error-text">{state.error}</span>}
    </div>
  );
}

export function Reader() {
  const { selected, select, view } = useUi();
  const qc = useQueryClient();
  const accounts = useAccounts();
  const prefs = usePrefs();
  const providers = useProviders().data ?? [];
  const { data: detail, isLoading, error } = useThread(selected);
  const labels = useLabels(selected?.accountId ?? null).data ?? [];
  const { run, setLabels } = useActions();
  const confirmed = useConfirmed();
  const advance = useAdvance();
  const startCompose = useStartCompose();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showOlder, setShowOlder] = useState(false);
  const [menu, setMenu] = useState<{ el: HTMLElement; mode: "label" | "move" | "more" } | null>(null);
  const [summary, setSummary] = useState<{ loading: boolean; text?: string; error?: string } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const me = accounts.find((a) => a.id === selected?.accountId)?.email;
  const hasProvider = (f: "smartReply" | "summary") => {
    const id = prefs.llmFeatures?.[f];
    return !!id && providers.some((p) => p.id === id);
  };

  // Gmail opens a thread with the latest message and any unread ones expanded.
  useEffect(() => {
    if (!detail) return;
    const open = new Set<string>();
    detail.messages.forEach((m, i) => {
      if (i === detail.messages.length - 1 || m.labelIds.includes("UNREAD") || m.labelIds.includes("DRAFT")) open.add(m.id);
    });
    setExpanded(open);
    setShowOlder(false);
    setSummary(null);
    bodyRef.current?.scrollTo(0, 0);
  }, [detail?.summary.id, detail?.messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mark as read on open.
  useEffect(() => {
    if (detail?.summary.unread) void run("read", [{ accountId: detail.summary.accountId, threadId: detail.summary.id }], { quiet: true });
  }, [detail?.summary.id, detail?.summary.unread]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => {
    if (!detail) return [];
    const msgs = detail.messages;
    if (showOlder || msgs.length <= 4) return msgs.map((m) => ({ m, hidden: 0 }));
    // Collapse the middle of long threads into "N older messages", keeping first and last two.
    const keep = msgs.filter((m, i) => i === 0 || i >= msgs.length - 2 || expanded.has(m.id));
    return keep.map((m, i) => ({ m, hidden: i === 1 ? msgs.length - keep.length : 0 }));
  }, [detail, showOlder, expanded]);

  if (!selected) {
    return (
      <section className="reader" aria-label="Reading pane">
        <div className="reader-bar drag" data-tauri-drag-region />
        <div className="empty grid-paper"><div><Icon name="mail" /><div className="title">No conversation selected</div><div>Pick one from the list, or press <kbd>c</kbd> to write.</div></div></div>
      </section>
    );
  }

  const ref = selected;
  const summaryRow = detail?.summary;
  const inTrash = summaryRow?.labelIds.includes("TRASH");
  const inSpam = summaryRow?.labelIds.includes("SPAM");
  const inInbox = summaryRow?.labelIds.includes("INBOX");
  const last = detail?.messages.filter((m) => !m.labelIds.includes("DRAFT")).at(-1);
  const leave = async (p: Promise<boolean>) => {
    if (await p) advance(ref);
  };

  const summarize = async () => {
    setSummary({ loading: true });
    try {
      setSummary({ loading: false, text: await api.summarizeThread(ref.accountId, ref.threadId) });
    } catch (e) {
      setSummary({ loading: false, error: String(e) });
    }
  };

  return (
    <section className="reader" aria-label="Reading pane">
      <div className="reader-bar drag" data-tauri-drag-region>
        <IconButton icon="close" label="Close" onClick={() => select(null)} />
        {inTrash ? (
          <IconButton icon="restore_from_trash" label="Restore" onClick={() => void leave(run("untrash", [ref]))} />
        ) : inInbox ? (
          <IconButton icon="archive" label="Archive (e)" onClick={() => void leave(confirmed.archive([ref]))} />
        ) : (
          <IconButton icon="move_to_inbox" label="Move to Inbox" onClick={() => void run("unarchive", [ref])} />
        )}
        {inSpam ? (
          <IconButton icon="report_off" label="Not spam" onClick={() => void leave(run("notSpam", [ref]))} />
        ) : (
          <IconButton icon="report" label="Report spam (!)" onClick={() => void leave(run("spam", [ref]))} />
        )}
        {!inTrash && <IconButton icon="delete" label="Delete (#)" onClick={() => void leave(confirmed.trash([ref]))} />}
        <IconButton icon="mark_email_unread" label="Mark as unread (⇧U)" onClick={() => void run("unread", [ref]).then(() => select(null))} />
        <IconButton icon="drive_file_move" label="Move to" onClick={(e) => setMenu({ el: e.currentTarget as HTMLElement, mode: "move" })} />
        <IconButton icon="label" label="Label as" onClick={(e) => setMenu({ el: e.currentTarget as HTMLElement, mode: "label" })} />
        <IconButton icon="more_vert" label="More" onClick={(e) => setMenu({ el: e.currentTarget as HTMLElement, mode: "more" })} />
        <div className="spacer" />
        {hasProvider("summary") && detail && (
          <button className="btn tonal" onClick={() => void summarize()}><Icon name="auto_awesome" /> Summarize</button>
        )}
        <IconButton icon="chevron_left" label="Newer (k)" onClick={() => moveSel(-1)} />
        <IconButton icon="chevron_right" label="Older (j)" onClick={() => moveSel(1)} />
      </div>
      <div className="reader-body" ref={bodyRef}>
        {isLoading && <div className="empty"><Spinner /></div>}
        {error && <div className="empty"><div><Icon name="error" /><div>{String(error)}</div></div></div>}
        {detail && summaryRow && (
          <>
            <div className="thread-title">
              <div style={{ flex: 1 }}>
                <h1>{summaryRow.subject}</h1>
                <div className="chips">
                  {chipLabels(summaryRow.labelIds, labels).map((l) => (
                    <span key={l.id} className="chip" style={l.colorBg ? { background: l.colorBg, color: readableOn(l.colorBg, l.colorText) } : undefined}>
                      {l.name}
                      <span className="ms" style={{ fontSize: 14 }} role="button" aria-label={`Remove ${l.name}`}
                        onClick={() => void setLabels([ref], [], [l.id])}>close</span>
                    </span>
                  ))}
                  {summaryRow.labelIds.includes("INBOX") && view.label !== "INBOX" && <span className="chip">Inbox</span>}
                </div>
              </div>
              <IconButton
                icon={summaryRow.important ? "label_important" : "label_important_outline"}
                fill={summaryRow.important}
                className={`star ${summaryRow.important ? "on" : ""}`}
                label={summaryRow.important ? "Mark as not important" : "Mark as important"}
                onClick={() => void run(summaryRow.important ? "notImportant" : "important", [ref])}
              />
              <IconButton
                icon="star"
                fill={summaryRow.starred}
                className={`star ${summaryRow.starred ? "on" : ""}`}
                label={summaryRow.starred ? "Unstar (s)" : "Star (s)"}
                onClick={() => void run(summaryRow.starred ? "unstar" : "star", [ref])}
              />
            </div>
            {summary && (
              <div className="summary-card">
                <div className="head"><span className="eyebrow">Summary</span>
                  <span style={{ flex: 1 }} /><IconButton small icon="close" label="Close summary" onClick={() => setSummary(null)} />
                </div>
                {summary.loading ? <Spinner /> : summary.error ? <span className="error-text">{summary.error}</span> : summary.text}
              </div>
            )}
            {visible.map(({ m, hidden }) => (
              <div key={m.id}>
                {hidden > 0 && (
                  <div className="collapsed-group"><button onClick={() => setShowOlder(true)}>{hidden} older messages</button></div>
                )}
                <MessageView
                  detail={detail}
                  m={m}
                  me={me}
                  isLast={m.id === detail.messages.at(-1)?.id}
                  expanded={expanded.has(m.id)}
                  onToggle={() => {
                    const next = new Set(expanded);
                    if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                    setExpanded(next);
                  }}
                />
              </div>
            ))}
            {last && (
              <>
                {hasProvider("smartReply") && <SmartReplies detail={detail} last={last} />}
                <div className="reply-row">
                  <button className="btn" onClick={() => void startCompose.reply(detail, last, "reply")}><Icon name="reply" /> Reply</button>
                  {last.to.length + last.cc.length > 1 && (
                    <button className="btn" onClick={() => void startCompose.reply(detail, last, "replyAll")}><Icon name="reply_all" /> Reply all</button>
                  )}
                  <button className="btn" onClick={() => void startCompose.forward(detail, last)}><Icon name="forward" /> Forward</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
      {menu && detail && (menu.mode === "more" ? (
        <Menu anchor={menu.el} onClose={() => setMenu(null)}>
          <button onClick={() => { setMenu(null); void run(detail.summary.important ? "notImportant" : "important", [ref]); }}>
            <Icon name="label_important" /> {detail.summary.important ? "Mark as not important" : "Mark as important"}
          </button>
          <button onClick={() => { setMenu(null); void run(detail.summary.starred ? "unstar" : "star", [ref]); }}>
            <Icon name="star" /> {detail.summary.starred ? "Remove star" : "Add star"}
          </button>
          <hr />
          <button onClick={() => { setMenu(null); window.print(); }}><Icon name="print" /> Print all</button>
          <button onClick={() => { setMenu(null); void qc.invalidateQueries({ queryKey: ["thread", ref.accountId, ref.threadId] }); }}>
            <Icon name="refresh" /> Reload conversation
          </button>
        </Menu>
      ) : (
        <LabelMenu anchor={menu.el} threads={[detail.summary]} mode={menu.mode} onClose={() => setMenu(null)} />
      ))}
    </section>
  );

  function moveSel(delta: number) {
    const { order } = useUi.getState();
    const i = order.findIndex((r) => r.threadId === ref.threadId && r.accountId === ref.accountId);
    const next = order[i + delta];
    if (next) select(next);
  }
}

