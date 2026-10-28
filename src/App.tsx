import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect } from "react";
import { Resizer } from "./components/Resizer";
import { ConfirmHost, Dialog, Spinner, Toasts } from "./components/ui";
import { ComposeDock } from "./features/compose/Compose";
import { useStartCompose } from "./features/compose/startCompose";
import { Sidebar } from "./features/mailbox/Sidebar";
import { ThreadList } from "./features/mailbox/ThreadList";
import { Settings } from "./features/settings/Settings";
import { Onboarding } from "./features/setup/Onboarding";
import { SHORTCUTS, useShortcuts } from "./features/shortcuts";
import { Reader } from "./features/thread/Reader";
import { CHECK_INTERVAL_MS, useUpdates } from "./features/updates/updates";
import { parseMailto } from "./lib/format";
import { on } from "./lib/ipc";
import { refreshMail, usePrefs, useStatus } from "./lib/queries";
import { clampWidth, usePanes } from "./lib/panes";
import { useUi } from "./lib/store";
import { themeFamily } from "./lib/theme";

function ShortcutsHelp() {
  const { shortcutsHelp, setShortcutsHelp } = useUi();
  if (!shortcutsHelp) return null;
  return (
    <Dialog title="Keyboard shortcuts" onClose={() => setShortcutsHelp(false)} actions={<button className="btn text" onClick={() => setShortcutsHelp(false)}>Close</button>}>
      <div className="shortcut-grid">
        {SHORTCUTS.map(([k, d]) => <Fragment key={k}><kbd>{k}</kbd><span>{d}</span></Fragment>)}
      </div>
    </Dialog>
  );
}

function Mail() {
  const selected = useUi((s) => s.selected);
  const { widths, resizing, setWidth } = usePanes();
  useShortcuts();

  // Keep the reading pane usable when the window gets narrower.
  useEffect(() => {
    const fit = () => {
      const list = clampWidth("list", widths.list, widths.sidebar, window.innerWidth);
      if (list !== widths.list) setWidth("list", list);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [widths, setWidth]);

  const columns = selected ? `${widths.sidebar}px ${widths.list}px minmax(0, 1fr)` : `${widths.sidebar}px minmax(0, 1fr)`;
  return (
    <div className={`app ${selected ? "" : "no-reader"} ${resizing ? "resizing" : ""}`} style={{ gridTemplateColumns: columns }}>
      <Sidebar />
      <ThreadList />
      {selected && <Reader />}
      <Resizer pane="sidebar" label="Resize sidebar" at={widths.sidebar} />
      {selected && <Resizer pane="list" label="Resize conversation list" at={widths.sidebar + widths.list} />}
    </div>
  );
}

export default function App() {
  const qc = useQueryClient();
  const status = useStatus();
  const prefs = usePrefs();
  const startCompose = useStartCompose();

  useEffect(() => {
    const root = document.documentElement;
    if (prefs.theme && prefs.theme !== "system") root.dataset.theme = prefs.theme;
    else delete root.dataset.theme;
    const family = themeFamily(prefs.theme);
    if (family) root.dataset.family = family;
    else delete root.dataset.family;
    root.dataset.density = prefs.density ?? "default";
  }, [prefs.theme, prefs.density]);

  // Look for app updates shortly after launch, then every few hours.
  useEffect(() => {
    const first = setTimeout(() => void useUpdates.getState().check(), 15_000);
    const every = setInterval(() => void useUpdates.getState().check(), CHECK_INTERVAL_MS);
    return () => { clearTimeout(first); clearInterval(every); };
  }, []);

  useEffect(() => {
    const subs = [
      on("mail-changed", () => refreshMail(qc)),
      on("open-mailto", (url) => {
        try {
          const f = parseMailto(String(url));
          void startCompose({ to: f.to, cc: f.cc, bcc: f.bcc, subject: f.subject, body: f.body });
        } catch { /* ignore malformed links */ }
      }),
    ];
    return () => subs.forEach((s) => void s.then((off) => off()));
  }, [qc, startCompose]);

  if (status.isLoading) return <div className="empty"><Spinner /></div>;
  if (status.error) return <div className="empty">{String(status.error)}</div>;
  const s = status.data!;

  return (
    <>
      {!s.hasClient || s.accounts.length === 0 ? <Onboarding hasClient={s.hasClient} /> : <Mail />}
      <Settings />
      <ComposeDock />
      <ShortcutsHelp />
      <ConfirmHost />
      <Toasts />
    </>
  );
}
