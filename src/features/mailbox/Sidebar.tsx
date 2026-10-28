import { useState } from "react";
import { Avatar, Icon, IconButton } from "../../components/ui";
import { labelTree, SYSTEM_NAV, type LabelNode } from "../../lib/labels";
import { useAccounts, useLabels } from "../../lib/queries";
import { useUi } from "../../lib/store";
import type { Label } from "../../lib/types";
import { useStartCompose } from "../compose/startCompose";

function sumUnread(labels: Label[], id: string) {
  return labels.filter((l) => l.id === id).reduce((n, l) => n + l.threadsUnread, 0);
}

export function Sidebar() {
  const { view, setView, openSettings } = useUi();
  const accounts = useAccounts();
  const labels = useLabels(view.accountId).data ?? [];
  const startCompose = useStartCompose();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const go = (label: string) =>
    setView({ accountId: view.accountId, label, category: label === "INBOX" ? "CATEGORY_PERSONAL" : null });
  const isActive = (id: string) => view.label === id;

  // In the unified view, user labels belong to different accounts; show those of the
  // first account only when a single account is selected (Gmail does the same per account).
  const tree = view.accountId ? labelTree(labels) : [];

  const renderNode = (n: LabelNode) => {
    const hasKids = n.children.length > 0;
    const expanded = open[n.label.id] ?? false;
    return (
      <div key={n.label.id}>
        <button
          className={`nav-item ${isActive(n.label.id) ? "active" : ""}`}
          style={{ paddingLeft: 14 + n.depth * 16 }}
          onClick={() => go(n.label.id)}
          title={n.label.name}
        >
          <span className="label-dot" style={{ background: n.label.colorBg ?? "var(--outline)" }} />
          <span className="name">{n.short}</span>
          {n.label.threadsUnread > 0 && <span className="count">{n.label.threadsUnread}</span>}
          {hasKids && (
            <span
              className="ms"
              role="button"
              aria-label={expanded ? "Collapse" : "Expand"}
              onClick={(e) => { e.stopPropagation(); setOpen({ ...open, [n.label.id]: !expanded }); }}
            >
              {expanded ? "expand_less" : "expand_more"}
            </span>
          )}
        </button>
        {hasKids && expanded && n.children.map(renderNode)}
      </div>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-top drag" data-tauri-drag-region>
        <span className="wordmark" data-tauri-drag-region><img src="/icon.png" alt="" />Chaucer</span>
        <IconButton icon="settings" label="Settings (⌘,)" onClick={() => openSettings("general")} />
      </div>
      <button className="compose-fab" onClick={() => startCompose()}>
        <Icon name="edit" /> Compose
      </button>

      <nav className="nav" aria-label="Mailboxes">
        {accounts.length > 1 && (
          <div className="account-switch">
            <button
              className={`account-btn ${view.accountId === null ? "active" : ""}`}
              onClick={() => setView({ accountId: null, label: "INBOX", category: "CATEGORY_PERSONAL" })}
            >
              <div className="avatar sm" style={{ background: "var(--primary)" }}><Icon name="all_inbox" /></div>
              <div className="who"><div>All inboxes</div></div>
            </button>
            {accounts.map((a) => (
              <button
                key={a.id}
                className={`account-btn ${view.accountId === a.id ? "active" : ""}`}
                onClick={() => setView({ accountId: a.id, label: "INBOX", category: "CATEGORY_PERSONAL" })}
                title={a.email}
              >
                <Avatar small addr={{ name: a.displayName ?? "", email: a.email }} />
                <div className="who">
                  <div>{a.displayName ?? a.email}</div>
                  <div className="sub">{a.needsReauth ? "Sign in again" : a.email}</div>
                </div>
                {a.needsReauth && <Icon name="error" className="sparkle" />}
              </button>
            ))}
          </div>
        )}

        {SYSTEM_NAV.map((s) => {
          const unread = s.id === "INBOX" || s.id === "SPAM" ? sumUnread(labels, s.id) : 0;
          const drafts = s.id === "DRAFT" ? labels.filter((l) => l.id === "DRAFT").reduce((n, l) => n + l.threadsTotal, 0) : 0;
          return (
            <button key={s.id} className={`nav-item ${isActive(s.id) ? "active" : ""}`} onClick={() => go(s.id)}>
              <Icon name={s.icon} fill={isActive(s.id)} />
              <span className="name">{s.name}</span>
              {(unread || drafts) > 0 && <span className="count">{unread || drafts}</span>}
            </button>
          );
        })}

        {tree.length > 0 && (
          <>
            <div className="nav-section">
              <span className="eyebrow">Labels</span>
              <IconButton icon="add" label="Create label" small onClick={() => openSettings("labels")} />
            </div>
            {tree.map(renderNode)}
          </>
        )}
      </nav>
    </aside>
  );
}
