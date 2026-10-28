// Resizable pane widths (sidebar, thread list), remembered between launches.
import { create } from "zustand";

export const PANES = {
  sidebar: { min: 200, max: 360, def: 256 },
  list: { min: 300, max: 680, def: 400 },
  readerMin: 380,
} as const;

type Pane = "sidebar" | "list";
const KEY = "chaucer.panes";

function load(): Record<Pane, number> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { sidebar: Number(v.sidebar) || PANES.sidebar.def, list: Number(v.list) || PANES.list.def };
  } catch {
    return { sidebar: PANES.sidebar.def, list: PANES.list.def };
  }
}

/** Keeps a width inside its bounds and leaves the reading pane at least readerMin wide. */
export function clampWidth(pane: Pane, w: number, other: number, viewport: number): number {
  const { min, max } = PANES[pane];
  const room = viewport - other - PANES.readerMin;
  return Math.round(Math.max(min, Math.min(max, w, Math.max(min, room))));
}

interface PaneState {
  widths: Record<Pane, number>;
  resizing: boolean;
  setWidth: (pane: Pane, w: number) => void;
  reset: (pane: Pane) => void;
  setResizing: (v: boolean) => void;
}

export const usePanes = create<PaneState>((set, get) => ({
  widths: load(),
  resizing: false,
  setWidth: (pane, w) => {
    const widths = { ...get().widths, [pane]: w };
    set({ widths });
    localStorage.setItem(KEY, JSON.stringify(widths));
  },
  reset: (pane) => get().setWidth(pane, PANES[pane].def),
  setResizing: (resizing) => set({ resizing }),
}));
