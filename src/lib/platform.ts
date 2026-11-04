// Which desktop platform the UI is running on. Set once at startup as
// <html data-platform="windows" | "mac"> so CSS can adapt (see initPlatform).
//
// Only Windows gets different behaviour: macOS, and anything else (the Linux browser preview),
// keeps the original Mac-style UI.
export type Platform = "windows" | "mac";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Pure so it can be tested. `search` may force a platform with `?platform=windows|mac`; that is
 * honoured in the browser preview and in dev builds, never in an installed app.
 */
export function detectPlatform(userAgent: string, search = "", allowOverride = true): Platform {
  if (allowOverride) {
    const forced = new URLSearchParams(search).get("platform");
    if (forced === "windows" || forced === "mac") return forced;
  }
  return /Windows/i.test(userAgent) ? "windows" : "mac";
}

export const platform: Platform =
  typeof navigator === "undefined"
    ? "mac"
    : detectPlatform(navigator.userAgent, typeof location === "undefined" ? "" : location.search, !inTauri || import.meta.env.DEV);

export const isWindows = platform === "windows";

export function initPlatform() {
  document.documentElement.dataset.platform = platform;
}

/**
 * Renders a shortcut for the current platform. Write it with `+`: "Mod+Shift+Enter".
 * Mac: ⌘⇧↩ (or "⌘ ⇧ ↩" when `spaced`). Windows: Ctrl+Shift+Enter.
 */
export function formatShortcut(combo: string, opts: { spaced?: boolean; windows?: boolean } = {}): string {
  const win = opts.windows ?? isWindows;
  const parts = combo.split("+").map((p) => {
    if (p === "Mod") return win ? "Ctrl" : "⌘";
    if (p === "Shift") return win ? "Shift" : "⇧";
    if (p === "Enter") return win ? "Enter" : "↩";
    return p;
  });
  return win ? parts.join("+") : parts.join(opts.spaced ? " " : "");
}

/** "(⌘R)" / "(Ctrl+R)" for button tooltips. */
export const hint = (combo: string) => `(${formatShortcut(combo)})`;

/** Where credentials are kept, for user-facing copy (three phrasings, to keep the Mac text as it was). */
export const credentialStore = () => (isWindows ? "Windows Credential Manager" : "your macOS Keychain");
export const credentialStoreShort = () => (isWindows ? "Credential Manager" : "Keychain");
export const credentialStorePlain = () => (isWindows ? "Windows Credential Manager" : "your Keychain");

/** Where the OS lets people tune notification banners and sounds. */
export const notificationSettingsPath = () =>
  isWindows ? "Windows Settings → System → Notifications" : "System Settings → Notifications";
