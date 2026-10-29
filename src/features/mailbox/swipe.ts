import { useEffect, useRef, type RefObject } from "react";
import type { Action } from "../../lib/queries";
import type { ThreadSummary } from "../../lib/types";

export type SwipeKind = "archive" | "delete" | "read" | "none";
export type SwipeDir = "left" | "right";

export interface SwipeAction {
  action: Action;
  icon: string;
  label: string;
}

/** Distance (px) a row must travel before releasing commits the action. */
export const SWIPE_THRESHOLD = 96;
const IDLE_MS = 100;
const COMMIT_MS = 160;

/** What a configured swipe does to this thread in this folder, or null when it doesn't apply. */
export function resolveSwipe(kind: SwipeKind, t: ThreadSummary, folder: string): SwipeAction | null {
  switch (kind) {
    case "read":
      return t.unread
        ? { action: "read", icon: "drafts", label: "Mark as read" }
        : { action: "unread", icon: "mark_email_unread", label: "Mark as unread" };
    case "archive":
      if (folder === "TRASH") return { action: "untrash", icon: "restore_from_trash", label: "Restore" };
      if (folder === "SPAM") return { action: "notSpam", icon: "report_off", label: "Not spam" };
      return t.labelIds.includes("INBOX") ? { action: "archive", icon: "archive", label: "Archive" } : null;
    case "delete":
      return folder === "TRASH" ? null : { action: "trash", icon: "delete", label: "Delete" };
    default:
      return null;
  }
}

/** Linear up to the threshold, then increasingly stiff, so the row can't be flung off screen. */
export function resist(distance: number, width: number): number {
  const d = Math.abs(distance);
  const shown = d <= SWIPE_THRESHOLD ? d : SWIPE_THRESHOLD + (d - SWIPE_THRESHOLD) * 0.35;
  return Math.sign(distance) * Math.min(shown, width * 0.6);
}

interface Options {
  left: SwipeAction | null;
  right: SwipeAction | null;
  /** Resolves false when the action was cancelled or failed, so the row springs back. */
  onCommit: (dir: SwipeDir) => Promise<boolean> | boolean;
}

/**
 * Two-finger horizontal swipe on a Mac trackpad. WebKit delivers it as `wheel` events with deltaX
 * (including momentum after the fingers lift), so a gesture is "a run of wheel events with no gap
 * longer than IDLE_MS". The axis is decided by the first event; vertical runs are left to scroll.
 */
export function useTrackpadSwipe(wrap: RefObject<HTMLElement | null>, row: RefObject<HTMLElement | null>, opts: Options) {
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    const el = wrap.current;
    const body = row.current;
    if (!el || !body) return;
    let mode: "idle" | "h" | "v" = "idle";
    let busy = false;
    let offset = 0;
    let timer = 0;

    const paint = (x: number, animate: boolean) => {
      body.style.transition = animate ? `transform ${COMMIT_MS}ms var(--ease)` : "none";
      body.style.transform = x ? `translateX(${x}px)` : "";
      el.dataset.dir = x === 0 ? "" : x > 0 ? "right" : "left";
      el.dataset.armed = Math.abs(x) >= SWIPE_THRESHOLD ? "true" : "";
    };
    const reset = () => { offset = 0; mode = "idle"; busy = false; paint(0, true); };

    const end = async () => {
      if (mode !== "h") { mode = "idle"; return; }
      const dir: SwipeDir = offset > 0 ? "right" : "left";
      if (Math.abs(offset) < SWIPE_THRESHOLD || !latest.current[dir]) return reset();
      busy = true;
      paint(Math.sign(offset) * el.clientWidth, true);
      await new Promise((r) => window.setTimeout(r, COMMIT_MS));
      const ok = await latest.current.onCommit(dir);
      if (!ok) reset(); else { offset = 0; mode = "idle"; busy = false; }
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || busy) { if (busy && mode === "h") e.preventDefault(); return; } // ctrl+wheel is pinch zoom
      if (mode === "idle") mode = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? "h" : "v";
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void end(), IDLE_MS);
      if (mode !== "h") return;
      e.preventDefault();
      // Deltas follow the "natural scrolling" setting; WebKit says whether they were inverted so the
      // row can follow the fingers either way.
      const natural = (e as WheelEvent & { webkitDirectionInvertedFromDevice?: boolean }).webkitDirectionInvertedFromDevice !== false;
      let next = offset + (natural ? -e.deltaX : e.deltaX);
      if ((next > 0 && !latest.current.right) || (next < 0 && !latest.current.left)) next = 0;
      offset = next;
      paint(resist(offset, el.clientWidth), false);
    };

    // Not passive: preventDefault stops WebKit treating the swipe as history navigation / rubber-banding.
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => { el.removeEventListener("wheel", onWheel); window.clearTimeout(timer); };
  }, [wrap, row]);
}
