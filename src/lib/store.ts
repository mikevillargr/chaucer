import { flushSync } from "react-dom";
import { create } from "zustand";
import type { Addr, DraftAttachment, ThreadRef } from "./types";

/** What the thread list shows. `label` is a Gmail label id, "ALL" (All mail) or "SEARCH". */
export interface View {
  accountId: string | null;
  label: string;
  category?: string | null;
  query?: string | null;
}

export interface ComposeState {
  key: string;
  accountId: string;
  mode: "new" | "reply" | "replyAll" | "forward" | "draft";
  to: Addr[];
  cc: Addr[];
  bcc: Addr[];
  subject: string;
  /** Initial editor content (signature, prefilled text). */
  html: string;
  /** Quoted original / forwarded block appended below the editor when sending. */
  quoted: string;
  threadId: string | null;
  inReplyTo: string | null;
  references: string | null;
  attachments: DraftAttachment[];
  draftId: string | null;
  minimized: boolean;
}

export interface Toast {
  id: number;
  text: string;
  undo?: () => void;
  error?: boolean;
}

interface UiState {
  view: View;
  selected: ThreadRef | null;
  checked: string[]; // "accountId|threadId"
  composes: ComposeState[];
  settings: string | null; // open settings section
  shortcutsHelp: boolean;
  toasts: Toast[];
  /** Thread order currently shown in the list, for j/k and auto-advance. */
  order: ThreadRef[];
  setOrder: (o: ThreadRef[]) => void;
  setView: (v: View) => void;
  select: (t: ThreadRef | null) => void;
  toggleChecked: (key: string) => void;
  setChecked: (keys: string[]) => void;
  openCompose: (c: Partial<ComposeState> & { accountId: string }) => void;
  updateCompose: (key: string, patch: Partial<ComposeState>) => void;
  closeCompose: (key: string) => void;
  openSettings: (section: string | null) => void;
  setShortcutsHelp: (v: boolean) => void;
  toast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
}

let toastId = 0;
let composeId = 0;

export const refKey = (t: ThreadRef) => `${t.accountId}|${t.threadId}`;

export const useUi = create<UiState>((set) => ({
  view: { accountId: null, label: "INBOX", category: "CATEGORY_PERSONAL" },
  selected: null,
  checked: [],
  composes: [],
  settings: null,
  shortcutsHelp: false,
  toasts: [],
  order: [],
  setOrder: (order) => set({ order }),
  setView: (view) => set({ view, selected: null, checked: [] }),
  // Opening or closing the reading pane animates the layout change where supported.
  select: (selected) => {
    const togglesPane = !selected !== !useUi.getState().selected;
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (togglesPane && doc.startViewTransition && !reduce) doc.startViewTransition(() => flushSync(() => set({ selected })));
    else set({ selected });
  },
  toggleChecked: (key) =>
    set((s) => ({ checked: s.checked.includes(key) ? s.checked.filter((k) => k !== key) : [...s.checked, key] })),
  setChecked: (checked) => set({ checked }),
  openCompose: (c) =>
    set((s) => {
      // Re-focus an existing reply window for the same thread instead of opening a second one.
      const existing = c.threadId && c.mode !== "new" ? s.composes.find((x) => x.threadId === c.threadId) : undefined;
      if (existing) return { composes: s.composes.map((x) => (x === existing ? { ...x, minimized: false } : x)) };
      const compose: ComposeState = {
        key: `c${++composeId}`, mode: "new", to: [], cc: [], bcc: [], subject: "", html: "", quoted: "",
        threadId: null, inReplyTo: null, references: null, attachments: [], draftId: null, minimized: false, ...c,
      };
      return { composes: [...s.composes.slice(-2), compose] };
    }),
  updateCompose: (key, patch) => set((s) => ({ composes: s.composes.map((c) => (c.key === key ? { ...c, ...patch } : c)) })),
  closeCompose: (key) => set((s) => ({ composes: s.composes.filter((c) => c.key !== key) })),
  openSettings: (settings) => set({ settings }),
  setShortcutsHelp: (shortcutsHelp) => set({ shortcutsHelp }),
  toast: (t) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.error ? 8000 : 6000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));
