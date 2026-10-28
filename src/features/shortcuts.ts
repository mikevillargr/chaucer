import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../lib/ipc";
import { refreshMail, undoLast, useActions, usePrefs } from "../lib/queries";
import { refKey, useUi } from "../lib/store";
import type { ThreadDetail } from "../lib/types";
import { useStartCompose } from "./compose/startCompose";
import { useAdvance } from "./thread/Reader";
import { useConfirmed } from "./thread/useConfirmed";

/** Gmail keyboard shortcuts (the set Android Gmail lists under gmail_shortcut_*). */
export const SHORTCUTS: [string, string][] = [
  ["c", "Compose"], ["r", "Reply"], ["a", "Reply all"], ["f", "Forward"], ["e", "Archive"], ["#", "Delete"],
  ["!", "Report spam"], ["s", "Star / unstar"], ["⇧ I", "Mark as read"], ["⇧ U", "Mark as unread"],
  ["j / k", "Older / newer conversation"], ["Enter / o", "Open conversation"], ["x", "Select conversation"],
  ["u / Esc", "Back to list"], ["/", "Search"], ["z", "Undo last action"], ["⌘ R", "Refresh"], ["⌘ ,", "Settings"],
  ["⌘ P", "Print"], ["⌘ ↩", "Send (in compose)"], ["⌘ S", "Save draft (in compose)"], ["Esc", "Close compose and save"],
  ["?", "Show keyboard shortcuts"],
];

function typing(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

export function useShortcuts() {
  const qc = useQueryClient();
  const prefs = usePrefs();
  const { run } = useActions();
  const confirmed = useConfirmed();
  const advance = useAdvance();
  const startCompose = useStartCompose();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === ",") { e.preventDefault(); return ui.openSettings("general"); }
      if (mod && e.key.toLowerCase() === "r") { e.preventDefault(); void api.syncNow(); return refreshMail(qc); }
      if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); return void startCompose(); }
      if (typing(e) || mod || e.altKey || ui.settings) return;

      const sel = ui.selected;
      const targets = ui.checked.length
        ? ui.checked.map((k) => { const [accountId, threadId] = k.split("|"); return { accountId, threadId }; })
        : sel ? [sel] : [];
      const detail = sel ? qc.getQueryData<ThreadDetail>(["thread", sel.accountId, sel.threadId]) : undefined;
      const last = detail?.messages.filter((m) => !m.labelIds.includes("DRAFT")).at(-1);
      const move = (delta: number) => {
        const i = sel ? ui.order.findIndex((r) => r.threadId === sel.threadId && r.accountId === sel.accountId) : -1;
        const next = ui.order[i < 0 ? 0 : i + delta];
        if (next) ui.select(next);
      };
      const leaving = (p: Promise<boolean>) => {
        if (sel && !ui.checked.length) void p.then((ok) => ok && advance(sel));
        else void p.then(() => ui.setChecked([]));
      };

      const key = e.key;
      const handled = (() => {
        switch (key) {
          case "c": void startCompose(); return true;
          case "/": document.getElementById("search-input")?.focus(); return true;
          case "?": ui.setShortcutsHelp(!ui.shortcutsHelp); return true;
          case "j": move(1); return true;
          case "k": move(-1); return true;
          case "Enter": case "o": if (!sel && ui.order[0]) ui.select(ui.order[0]); return true;
          case "u": case "Escape": if (ui.shortcutsHelp) ui.setShortcutsHelp(false); else ui.select(null); return true;
          case "z": undoLast(); return true;
          case "x": if (sel) ui.toggleChecked(refKey(sel)); return true;
          case "e": leaving(confirmed.archive(targets)); return true;
          case "#": leaving(confirmed.trash(targets)); return true;
          case "!": leaving(run("spam", targets)); return true;
          case "s": if (detail) void run(detail.summary.starred ? "unstar" : "star", targets); return true;
          case "I": void run("read", targets); return true;
          case "U": void run("unread", targets); return true;
          case "r": if (detail && last) void startCompose.reply(detail, last, prefs.defaultReply === "replyAll" ? "replyAll" : "reply"); return true;
          case "a": if (detail && last) void startCompose.reply(detail, last, "replyAll"); return true;
          case "f": if (detail && last) void startCompose.forward(detail, last); return true;
          default: return false;
        }
      })();
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [qc, prefs.defaultReply, run, confirmed, advance, startCompose]);
}
