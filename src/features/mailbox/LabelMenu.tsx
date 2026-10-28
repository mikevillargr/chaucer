import { useState } from "react";
import { Icon, Menu } from "../../components/ui";
import { useActions, useLabels } from "../../lib/queries";
import { useUi } from "../../lib/store";
import type { ThreadSummary } from "../../lib/types";

/** "Label as" (toggle labels) or "Move to" (add one label and leave the current folder). */
export function LabelMenu({ anchor, threads, mode, onClose }: {
  anchor: HTMLElement; threads: ThreadSummary[]; mode: "label" | "move"; onClose: () => void;
}) {
  const accountId = threads[0]?.accountId ?? null;
  const sameAccount = threads.every((t) => t.accountId === accountId);
  const labels = (useLabels(accountId).data ?? []).filter((l) => l.kind === "user");
  const { view, openSettings } = useUi();
  const { setLabels } = useActions();
  const [q, setQ] = useState("");
  const refs = threads.map((t) => ({ accountId: t.accountId, threadId: t.id }));
  const shown = labels.filter((l) => l.name.toLowerCase().includes(q.toLowerCase()));

  if (!sameAccount) {
    return (
      <Menu anchor={anchor} onClose={onClose}>
        <div className="muted" style={{ padding: "8px 16px" }}>Select conversations from one account to change labels.</div>
      </Menu>
    );
  }

  const state = (id: string) => {
    const n = threads.filter((t) => t.labelIds.includes(id)).length;
    return n === 0 ? "none" : n === threads.length ? "all" : "some";
  };

  return (
    <Menu anchor={anchor} onClose={onClose}>
      <div className="muted" style={{ padding: "0 16px 4px", fontSize: 12 }}>{mode === "label" ? "Label as:" : "Move to:"}</div>
      <input type="text" autoFocus placeholder="Search labels" value={q} onChange={(e) => setQ(e.target.value)} />
      {mode === "move" && view.label !== "INBOX" && (
        <button onClick={() => { void setLabels(refs, ["INBOX"], [view.label].filter((l) => l !== "ALL")); onClose(); }}>
          <Icon name="inbox" /> Inbox
        </button>
      )}
      {shown.map((l) => {
        const s = state(l.id);
        return (
          <button
            key={l.id}
            onClick={() => {
              if (mode === "move") {
                const leave = view.label === "INBOX" ? ["INBOX"] : view.label.startsWith("CATEGORY_") || view.label === "ALL" ? [] : [view.label];
                void setLabels(refs, [l.id], leave);
                onClose();
              } else {
                void setLabels(refs, s === "all" ? [] : [l.id], s === "all" ? [l.id] : []);
              }
            }}
          >
            {mode === "label" ? (
              <Icon name={s === "all" ? "check_box" : s === "some" ? "indeterminate_check_box" : "check_box_outline_blank"} />
            ) : (
              <span className="label-dot" style={{ background: l.colorBg ?? "var(--outline)" }} />
            )}
            {l.name}
          </button>
        );
      })}
      {shown.length === 0 && <div className="muted" style={{ padding: "8px 16px" }}>No labels</div>}
      <hr />
      <button onClick={() => { openSettings("labels"); onClose(); }}><Icon name="new_label" /> Create new</button>
    </Menu>
  );
}
