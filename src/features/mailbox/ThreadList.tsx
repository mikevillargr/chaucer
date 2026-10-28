import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, Icon, IconButton, Spinner } from "../../components/ui";
import { shortDate, sendersLine } from "../../lib/format";
import { CATEGORIES, chipLabels, labelName } from "../../lib/labels";
import { useAccounts, useActions, useLabels, usePrefs, useThreadList } from "../../lib/queries";
import { refKey, useUi } from "../../lib/store";
import type { ThreadSummary } from "../../lib/types";
import { useConfirmed } from "../thread/useConfirmed";
import { LabelMenu } from "./LabelMenu";
import { SearchBar } from "./SearchBar";

function Row({ t, me, selected, checked, onOpen, onCheck }: {
  t: ThreadSummary; me?: string; selected: boolean; checked: boolean; onOpen: () => void; onCheck: () => void;
}) {
  const { run } = useActions();
  const confirmed = useConfirmed();
  const labels = useLabels(t.accountId).data ?? [];
  const ref = { accountId: t.accountId, threadId: t.id };
  const chips = chipLabels(t.labelIds, labels).slice(0, 3);
  const last = t.senders[t.senders.length - 1] ?? { name: "", email: "" };
  const isDraft = t.labelIds.includes("DRAFT");
  return (
    <div
      className={`row ${t.unread ? "unread" : ""} ${selected ? "selected" : ""} ${checked ? "checked" : ""}`}
      onClick={onOpen}
      role="option"
      aria-selected={selected}
      data-thread={t.id}
    >
      <div className="avatar-wrap" onClick={(e) => { e.stopPropagation(); onCheck(); }} title="Select">
        <Avatar addr={last} />
        <div className="check"><Icon name="check" /></div>
      </div>
      <div className="main">
        <div className="line">
          <span className="from">
            {sendersLine(t, me)}
            {isDraft && <span style={{ color: "var(--error)", fontWeight: 400 }}> Draft</span>}
          </span>
          {t.messageCount > 1 && <span className="count">{t.messageCount}</span>}
        </div>
        <div className="line">
          {t.important && <Icon name="label_important" fill className="star on" />}
          <span className="subject">{t.subject}</span>
        </div>
        <div className="snippet">{t.snippet}</div>
        {(chips.length > 0 || t.hasAttachments) && (
          <div className="labels">
            {t.hasAttachments && <span className="chip"><Icon name="attach_file" /> Attachment</span>}
            {chips.map((l) => (
              <span key={l.id} className="chip" style={{ background: l.colorBg ?? undefined, color: l.colorText ?? undefined }}>
                {l.name.split("/").pop()}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="side">
        <span className="date">{shortDate(t.lastDate)}</span>
        <IconButton
          small
          icon="star"
          fill={t.starred}
          className={`star ${t.starred ? "on" : ""}`}
          label={t.starred ? "Unstar" : "Star"}
          onClick={(e) => { e.stopPropagation(); void run(t.starred ? "unstar" : "star", [ref]); }}
        />
      </div>
      <div className="hover-actions" onClick={(e) => e.stopPropagation()}>
        <IconButton small icon="archive" label="Archive (e)" onClick={() => void confirmed.archive([ref])} />
        <IconButton small icon="delete" label="Delete (#)" onClick={() => void confirmed.trash([ref])} />
        <IconButton small icon={t.unread ? "drafts" : "mark_email_unread"} label={t.unread ? "Mark as read" : "Mark as unread"}
          onClick={() => void run(t.unread ? "read" : "unread", [ref])} />
      </div>
    </div>
  );
}

export function ThreadList() {
  const { view, setView, selected, select, checked, toggleChecked, setChecked, setOrder } = useUi();
  const prefs = usePrefs();
  const accounts = useAccounts();
  const labels = useLabels(view.accountId).data ?? [];
  const list = useThreadList(view);
  const { run } = useActions();
  const confirmed = useConfirmed();
  const [menu, setMenu] = useState<{ el: HTMLElement; mode: "label" | "move" } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const meFor = (accountId: string) => accounts.find((a) => a.id === accountId)?.email;

  const enabledTabs = prefs.categoryTabs ?? CATEGORIES.map((c) => c.id);
  const inboxType = prefs.inboxType ?? "default";
  const showTabs = view.label === "INBOX" && inboxType === "default" && enabledTabs.length > 1;

  // Category tabs only make sense in the default inbox; other inbox types show all of INBOX.
  useEffect(() => {
    if (view.label === "INBOX" && !showTabs && view.category) setView({ ...view, category: null });
    if (showTabs && !view.category) setView({ ...view, category: "CATEGORY_PERSONAL" });
  }, [showTabs, view, setView]);

  const sections = useMemo(() => {
    if (view.label !== "INBOX" || inboxType === "default") return [{ title: null as string | null, threads: list.threads }];
    const flag = { important: "IMPORTANT", unread: "UNREAD", starred: "STARRED" }[inboxType];
    const title = { important: "Important", unread: "Unread", starred: "Starred" }[inboxType];
    return [
      { title, threads: list.threads.filter((t) => t.labelIds.includes(flag)) },
      { title: "Everything else", threads: list.threads.filter((t) => !t.labelIds.includes(flag)) },
    ];
  }, [list.threads, view.label, inboxType]);

  const ordered = sections.flatMap((s) => s.threads);
  const checkedThreads = ordered.filter((t) => checked.includes(refKey({ accountId: t.accountId, threadId: t.id })));
  const checkedRefs = checkedThreads.map((t) => ({ accountId: t.accountId, threadId: t.id }));
  const allChecked = ordered.length > 0 && checkedThreads.length === ordered.length;

  const orderKey = ordered.map((t) => t.id).join(",");
  useEffect(() => {
    setOrder(ordered.map((t) => ({ accountId: t.accountId, threadId: t.id })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey, setOrder]);

  // Keep the selected row in view when moving with j/k.
  useEffect(() => {
    if (selected) listRef.current?.querySelector(`[data-thread="${selected.threadId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (list.hasMore && el.scrollTop + el.clientHeight > el.scrollHeight - 400) void list.loadMore();
  };

  const title = view.label === "SEARCH" ? `Results for “${view.query}”` : labelName(view.label, labels);

  return (
    <section className="list-pane" aria-label="Conversations">
      <div className="list-head drag" data-tauri-drag-region>
        <SearchBar />
      </div>
      <div className="list-toolbar">
        <IconButton
          icon={allChecked ? "check_box" : checkedThreads.length ? "indeterminate_check_box" : "check_box_outline_blank"}
          label="Select all"
          onClick={() => setChecked(allChecked ? [] : ordered.map((t) => refKey({ accountId: t.accountId, threadId: t.id })))}
        />
        {checkedThreads.length > 0 ? (
          <>
            <span className="title">{checkedThreads.length} selected</span>
            {view.label === "TRASH" ? (
              <IconButton icon="restore_from_trash" label="Restore" onClick={() => void run("untrash", checkedRefs).then(() => setChecked([]))} />
            ) : (
              <>
                {view.label === "INBOX" || view.label.startsWith("CATEGORY_") ? (
                  <IconButton icon="archive" label="Archive" onClick={() => void confirmed.archive(checkedRefs).then(() => setChecked([]))} />
                ) : (
                  <IconButton icon="move_to_inbox" label="Move to Inbox" onClick={() => void run("unarchive", checkedRefs).then(() => setChecked([]))} />
                )}
                <IconButton icon="delete" label="Delete" onClick={() => void confirmed.trash(checkedRefs).then(() => setChecked([]))} />
              </>
            )}
            {view.label === "SPAM" ? (
              <IconButton icon="report_off" label="Not spam" onClick={() => void run("notSpam", checkedRefs).then(() => setChecked([]))} />
            ) : (
              <IconButton icon="report" label="Report spam" onClick={() => void run("spam", checkedRefs).then(() => setChecked([]))} />
            )}
            <IconButton
              icon={checkedThreads.some((t) => t.unread) ? "drafts" : "mark_email_unread"}
              label={checkedThreads.some((t) => t.unread) ? "Mark as read" : "Mark as unread"}
              onClick={() => void run(checkedThreads.some((t) => t.unread) ? "read" : "unread", checkedRefs)}
            />
            <IconButton icon="label" label="Label as" onClick={(e) => setMenu({ el: e.currentTarget as HTMLElement, mode: "label" })} />
            <IconButton icon="drive_file_move" label="Move to" onClick={(e) => setMenu({ el: e.currentTarget as HTMLElement, mode: "move" })} />
          </>
        ) : (
          <>
            <span className="title">{title}</span>
            {list.refreshing ? <Spinner /> : <IconButton icon="refresh" label="Refresh (⌘R)" onClick={() => void list.refetch()} />}
          </>
        )}
      </div>
      {showTabs && (
        <div className="tabs" role="tablist">
          {CATEGORIES.filter((c) => enabledTabs.includes(c.id)).map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={view.category === c.id}
              className={`tab ${view.category === c.id ? "active" : ""}`}
              onClick={() => setView({ ...view, category: c.id })}
            >
              <Icon name={c.icon} fill={view.category === c.id} /> {c.name}
            </button>
          ))}
        </div>
      )}
      {list.offline && <div className="banner"><Icon name="cloud_off" /> Offline — showing saved mail.</div>}
      <div className="list" ref={listRef} onScroll={onScroll} role="listbox" aria-label={title}>
        {list.loading ? (
          Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skeleton"><i style={{ width: 40, height: 40, borderRadius: 20 }} /><div style={{ flex: 1, display: "grid", gap: 8 }}><i style={{ width: "40%" }} /><i style={{ width: "80%" }} /></div></div>
          ))
        ) : list.error ? (
          <div className="empty"><div><Icon name="error" /><div className="title">Couldn't load mail</div><div>{String(list.error)}</div><button className="btn" style={{ marginTop: 12 }} onClick={() => void list.refetch()}>Try again</button></div></div>
        ) : ordered.length === 0 ? (
          <div className="empty grid-paper"><div><Icon name={view.label === "SEARCH" ? "search_off" : "inbox"} /><div className="title">{view.label === "SEARCH" ? "No matches" : "All caught up"}</div><div>{view.label === "SEARCH" ? "No messages matched your search." : "Nothing in this folder."}</div></div></div>
        ) : (
          sections.map((s) => (
            <div key={s.title ?? "all"}>
              {s.title && s.threads.length > 0 && <div className="list-section"><span className="eyebrow">{s.title}</span></div>}
              {s.threads.map((t) => {
                const ref = { accountId: t.accountId, threadId: t.id };
                return (
                  <Row
                    key={refKey(ref)}
                    t={t}
                    me={meFor(t.accountId)}
                    selected={selected?.threadId === t.id && selected.accountId === t.accountId}
                    checked={checked.includes(refKey(ref))}
                    onOpen={() => select(ref)}
                    onCheck={() => toggleChecked(refKey(ref))}
                  />
                );
              })}
            </div>
          ))
        )}
        {list.hasMore && <div className="load-more"><Spinner /></div>}
      </div>
      {menu && <LabelMenu anchor={menu.el} threads={checkedThreads} mode={menu.mode} onClose={() => setMenu(null)} />}
    </section>
  );
}
