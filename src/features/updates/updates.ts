// In-app updates via tauri-plugin-updater: checks the latest GitHub release's latest.json,
// verifies the signature, installs, and relaunches. No-ops in the browser preview.
import { create } from "zustand";
import { isTauri } from "../../lib/ipc";

type Status = "idle" | "checking" | "available" | "downloading" | "installing" | "uptodate" | "error";

interface PendingUpdate {
  version: string;
  body?: string;
  downloadAndInstall: (onEvent?: (e: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) => Promise<void>;
}

interface UpdateState {
  status: Status;
  version?: string;
  notes?: string;
  progress?: number; // 0..1 while downloading
  error?: string;
  dismissed: boolean;
  check: (manual?: boolean) => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
}

let pending: PendingUpdate | null = null;

export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export const useUpdates = create<UpdateState>((set, get) => ({
  status: "idle",
  dismissed: false,
  async check(manual = false) {
    if (!isTauri || ["checking", "downloading", "installing"].includes(get().status)) return;
    set({ status: "checking", error: undefined });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = (await check()) as PendingUpdate | null;
      pending = update;
      if (update) set({ status: "available", version: update.version, notes: update.body, dismissed: manual ? false : get().dismissed && get().version === update.version });
      else set({ status: "uptodate" });
    } catch (e) {
      // Background checks fail quietly (offline, no release yet); manual checks report it.
      set({ status: manual ? "error" : "idle", error: String(e) });
    }
  },
  async install() {
    if (!pending) return;
    let total = 0;
    let received = 0;
    set({ status: "downloading", progress: 0 });
    try {
      await pending.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data?.contentLength ?? 0;
        if (e.event === "Progress") {
          received += e.data?.chunkLength ?? 0;
          if (total) set({ progress: Math.min(1, received / total) });
        }
        if (e.event === "Finished") set({ status: "installing", progress: 1 });
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },
  dismiss: () => set({ dismissed: true }),
}));

/** Release notes come from CHANGELOG.md; flatten the markdown for a compact panel. */
export function plainNotes(md?: string): string[] {
  return (md ?? "")
    .split("\n")
    .map((l) => l.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trimEnd())
    .filter((l) => l.trim().length > 0);
}
