import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Avatar, confirmDialog, Icon, IconButton, Spinner, Switch } from "../../components/ui";
import { api } from "../../lib/ipc";
import { CATEGORIES, LABEL_COLORS, labelName } from "../../lib/labels";
import { refreshMail, useAccounts, useLabels, usePrefs, useProviders, useSetPrefs } from "../../lib/queries";
import { useUi } from "../../lib/store";
import type { Prefs, Vacation } from "../../lib/types";
import { SmartSettings } from "./SmartSettings";
import { useUpdates } from "../updates/updates";
import { isTauri } from "../../lib/ipc";

const SECTIONS = [
  { id: "general", name: "General", icon: "tune" },
  { id: "inbox", name: "Inbox", icon: "inbox" },
  { id: "accounts", name: "Accounts", icon: "manage_accounts" },
  { id: "labels", name: "Labels", icon: "label" },
  { id: "filters", name: "Filters & blocked", icon: "filter_alt" },
  { id: "vacation", name: "Vacation responder", icon: "beach_access" },
  { id: "notifications", name: "Notifications", icon: "notifications" },
  { id: "smart", name: "Smart features", icon: "auto_awesome" },
];

function Setting({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="setting">
      <div className="txt">{title}{hint && <small>{hint}</small>}</div>
      {children}
    </div>
  );
}

function Toggle<K extends keyof Prefs>({ k, title, hint, def = false }: { k: K; title: string; hint?: string; def?: boolean }) {
  const prefs = usePrefs();
  const set = useSetPrefs();
  const on = (prefs[k] as boolean | undefined) ?? def;
  return <Setting title={title} hint={hint}><Switch label={title} on={on} onChange={(v) => set.mutate({ [k]: v })} /></Setting>;
}

const SWIPE_OPTIONS: [string, string][] = [["archive", "Archive"], ["delete", "Delete"], ["read", "Mark read / unread"], ["none", "None"]];

function Choice<K extends keyof Prefs>({ k, title, hint, options, def }: {
  k: K; title: string; hint?: string; options: [string, string][]; def: string;
}) {
  const prefs = usePrefs();
  const set = useSetPrefs();
  return (
    <Setting title={title} hint={hint}>
      <select value={(prefs[k] as string | undefined) ?? def} onChange={(e) => set.mutate({ [k]: e.target.value })} aria-label={title}>
        {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
    </Setting>
  );
}

function AccountPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const accounts = useAccounts();
  if (accounts.length < 2) return null;
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Account" style={{ marginBottom: 16 }}>
      {accounts.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
    </select>
  );
}

function useAccountChoice() {
  const accounts = useAccounts();
  const [id, setId] = useState(accounts[0]?.id ?? "");
  useEffect(() => { if (!id && accounts[0]) setId(accounts[0].id); }, [accounts, id]);
  return [id, setId] as const;
}

function General() {
  return (
    <>
      <h2>General</h2>
      <p className="lead">How Chaucer looks and behaves.</p>
      <Choice k="theme" title="Theme" def="system" options={[["system", "System default"], ["light", "Light"], ["dark", "Dark"], ["kinetic", "Kinetic"], ["terminal-green", "Terminal Green"], ["terminal-white", "Terminal White"]]} />
      <Choice k="density" title="Conversation list density" def="default" options={[["default", "Default"], ["comfortable", "Comfortable"], ["compact", "Compact"]]} />
      <Choice k="defaultReply" title="Default reply action" def="reply" options={[["reply", "Reply"], ["replyAll", "Reply all"]]} />
      <Choice k="autoAdvance" title="Auto-advance" hint="Show this after you archive or delete a conversation" def="newer"
        options={[["newer", "Newer conversation"], ["older", "Older conversation"], ["list", "Conversation list"]]} />
      <Choice k="swipeRight" title="Trackpad swipe right" def="archive" hint="Swipe a conversation right with two fingers"
        options={SWIPE_OPTIONS} />
      <Choice k="swipeLeft" title="Trackpad swipe left" def="archive" hint="Swipe a conversation left with two fingers"
        options={SWIPE_OPTIONS} />
      <Choice k="externalImages" title="Images" hint="External images can tell the sender you opened the message" def="ask"
        options={[["ask", "Ask before displaying external images"], ["always", "Always display external images"]]} />
      <Toggle k="confirmArchive" title="Confirm before archiving" />
      <Toggle k="confirmDelete" title="Confirm before deleting" />
      <Toggle k="confirmSend" title="Confirm before sending" />
      <Updates />
      <h2 style={{ marginTop: 32 }}>Keyboard shortcuts</h2>
      <p className="lead">Press <kbd>?</kbd> anywhere to see them.</p>
    </>
  );
}

function Updates() {
  const { status, version, error, check, install } = useUpdates();
  const [current, setCurrent] = useState<string>("");
  useEffect(() => {
    if (isTauri) void import("@tauri-apps/api/app").then((m) => m.getVersion()).then(setCurrent);
  }, []);
  const text = {
    idle: "Chaucer checks for updates automatically.",
    checking: "Checking…",
    available: `Version ${version} is available.`,
    downloading: "Downloading…",
    installing: "Installing… Chaucer will restart.",
    uptodate: "You're up to date.",
    error: `Couldn't check for updates: ${error}`,
  }[status];
  return (
    <Setting title={current ? `Chaucer ${current}` : "Chaucer"} hint={text}>
      {status === "available" ? (
        <button className="btn ink" onClick={() => void install()}>Restart to update</button>
      ) : (
        <button className="btn" disabled={!isTauri || status === "checking"} onClick={() => void check(true)}>Check for updates</button>
      )}
    </Setting>
  );
}

function Inbox() {
  const prefs = usePrefs();
  const set = useSetPrefs();
  const tabs = prefs.categoryTabs ?? CATEGORIES.map((c) => c.id);
  return (
    <>
      <h2>Inbox</h2>
      <p className="lead">Choose how your inbox is organised.</p>
      <Choice k="inboxType" title="Inbox type" def="default" hint="Important/Unread/Starred first show that group above everything else"
        options={[["default", "Default inbox"], ["important", "Important first"], ["unread", "Unread first"], ["starred", "Starred first"]]} />
      {(prefs.inboxType ?? "default") === "default" && (
        <>
          <h3 style={{ fontWeight: 500, margin: "24px 0 4px" }}>Inbox categories</h3>
          <p className="muted" style={{ marginTop: 0 }}>Gmail sorts mail into these tabs. Primary is always shown.</p>
          {CATEGORIES.map((c) => (
            <Setting key={c.id} title={c.name}>
              <Switch
                label={c.name}
                on={tabs.includes(c.id)}
                onChange={(v) => c.id !== "CATEGORY_PERSONAL" &&
                  set.mutate({ categoryTabs: v ? CATEGORIES.map((x) => x.id).filter((id) => id === c.id || tabs.includes(id)) : tabs.filter((t) => t !== c.id) })}
              />
            </Setting>
          ))}
        </>
      )}
    </>
  );
}

function Accounts() {
  const accounts = useAccounts();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [busy, setBusy] = useState<string | null>(null);
  const add = async (hint?: string) => {
    setBusy(hint ?? "new");
    try {
      await api.addAccount(hint);
      refreshMail(qc);
    } catch (e) {
      toast({ text: String(e), error: true });
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <h2>Accounts</h2>
      <p className="lead">Google accounts signed in to Chaucer. Sign-in happens in your browser.</p>
      {accounts.map((a) => (
        <div className="setting" key={a.id}>
          <Avatar addr={{ name: a.displayName ?? "", email: a.email }} />
          <div className="txt">{a.displayName ?? a.email}<small>{a.email}{a.needsReauth && " · signed out, sign in again"}</small></div>
          {a.needsReauth && <button className="btn" onClick={() => void add(a.email)} disabled={!!busy}>Sign in</button>}
          <button className="btn danger" onClick={async () => {
            if (!(await confirmDialog(`Remove ${a.email}?`, "Its saved mail is removed from this Mac. Nothing is deleted from Gmail.", "Remove"))) return;
            await api.removeAccount(a.id);
            refreshMail(qc);
          }}>Remove</button>
        </div>
      ))}
      <div style={{ marginTop: 16 }}>
        <button className="btn filled" onClick={() => void add()} disabled={!!busy}>
          {busy === "new" ? <Spinner /> : <Icon name="person_add" />} Add another account
        </button>
        {busy && <p className="muted">Finish signing in in your browser…</p>}
      </div>
    </>
  );
}

function Labels() {
  const [accountId, setAccountId] = useAccountChoice();
  const labels = useLabels(accountId).data ?? [];
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const users = labels.filter((l) => l.kind === "user").sort((a, b) => a.name.localeCompare(b.name));
  const done = (list: unknown) => { qc.setQueryData(["labels", accountId], list); qc.invalidateQueries({ queryKey: ["labels"] }); };
  const fail = (e: unknown) => toast({ text: String(e), error: true });

  return (
    <>
      <h2>Labels</h2>
      <p className="lead">Create, colour and remove labels. Use a parent to nest them.</p>
      <AccountPicker value={accountId} onChange={setAccountId} />
      <div className="card row-actions">
        <input className="input" placeholder="New label name" value={name} onChange={(e) => setName(e.target.value)} aria-label="New label name" />
        <select className="input" value={parent} onChange={(e) => setParent(e.target.value)} aria-label="Nest under">
          <option value="">No parent</option>
          {users.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
        </select>
        <button className="btn filled" disabled={!name.trim()} onClick={() => {
          api.createLabel(accountId, { name: parent ? `${parent}/${name.trim()}` : name.trim(), labelListVisibility: "labelShow", messageListVisibility: "show" })
            .then((l) => { done(l); setName(""); }).catch(fail);
        }}>Create</button>
      </div>
      {users.map((l) => (
        <div className="setting" key={l.id}>
          <span className="label-dot" style={{ background: l.colorBg ?? "var(--outline)" }} />
          <div className="txt">{l.name}<small>{l.threadsTotal} conversations</small></div>
          <div className="row-actions">
            {LABEL_COLORS.map((c) => (
              <button key={c.bg} title="Set colour" aria-label={`Colour ${c.bg}`} onClick={() =>
                api.updateLabel(accountId, l.id, { color: { backgroundColor: c.bg, textColor: c.fg } }).then(done).catch(fail)}
                style={{ width: 16, height: 16, borderRadius: 4, border: l.colorBg === c.bg ? "2px solid var(--on-surface)" : 0, background: c.bg, padding: 0 }} />
            ))}
          </div>
          <Switch label="Show in label list" on={!l.hidden} onChange={(v) =>
            api.updateLabel(accountId, l.id, { labelListVisibility: v ? "labelShow" : "labelHide" }).then(done).catch(fail)} />
          <IconButton icon="delete" label={`Delete ${l.name}`} onClick={async () => {
            if (await confirmDialog(`Delete "${l.name}"?`, "Conversations keep their messages; only the label is removed.", "Delete"))
              api.deleteLabel(accountId, l.id).then(done).catch(fail);
          }} />
        </div>
      ))}
    </>
  );
}

function Filters() {
  const [accountId, setAccountId] = useAccountChoice();
  const labels = useLabels(accountId).data ?? [];
  const toast = useUi((s) => s.toast);
  const filters = useQuery({ queryKey: ["filters", accountId], queryFn: () => api.listFilters(accountId), enabled: !!accountId });
  const [crit, setCrit] = useState({ from: "", to: "", subject: "", query: "" });
  const [action, setAction] = useState({ archive: false, read: false, star: false, trash: false, label: "" });

  const describe = (c: Record<string, unknown>) =>
    Object.entries(c).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}: ${v}`).join(", ");
  const describeAction = (a: { addLabelIds?: string[]; removeLabelIds?: string[]; forward?: string }) => [
    ...(a.removeLabelIds ?? []).map((l) => (l === "INBOX" ? "Skip the Inbox" : l === "UNREAD" ? "Mark as read" : `Remove ${labelName(l, labels)}`)),
    ...(a.addLabelIds ?? []).map((l) => (l === "TRASH" ? "Delete it" : l === "STARRED" ? "Star it" : `Apply ${labelName(l, labels)}`)),
    ...(a.forward ? [`Forward to ${a.forward}`] : []),
  ].join(", ");

  const create = async () => {
    const criteria = Object.fromEntries(Object.entries(crit).filter(([, v]) => v.trim()));
    if (!Object.keys(criteria).length) return toast({ text: "Add at least one condition", error: true });
    const add = [action.star && "STARRED", action.trash && "TRASH", action.label].filter(Boolean) as string[];
    const remove = [action.archive && "INBOX", action.read && "UNREAD"].filter(Boolean) as string[];
    if (!add.length && !remove.length) return toast({ text: "Choose at least one action", error: true });
    try {
      await api.createFilter(accountId, { criteria, action: { addLabelIds: add, removeLabelIds: remove } });
      setCrit({ from: "", to: "", subject: "", query: "" });
      setAction({ archive: false, read: false, star: false, trash: false, label: "" });
      void filters.refetch();
    } catch (e) {
      toast({ text: String(e), error: true });
    }
  };

  return (
    <>
      <h2>Filters & blocked addresses</h2>
      <p className="lead">Filters run in Gmail, so they apply everywhere. Blocking a sender creates a filter that deletes their mail.</p>
      <AccountPicker value={accountId} onChange={setAccountId} />
      <div className="card">
        <div className="form-grid">
          <label>From</label><input className="input" value={crit.from} onChange={(e) => setCrit({ ...crit, from: e.target.value })} />
          <label>To</label><input className="input" value={crit.to} onChange={(e) => setCrit({ ...crit, to: e.target.value })} />
          <label>Subject</label><input className="input" value={crit.subject} onChange={(e) => setCrit({ ...crit, subject: e.target.value })} />
          <label>Has the words</label><input className="input" value={crit.query} onChange={(e) => setCrit({ ...crit, query: e.target.value })} />
          <label>Then</label>
          <div className="row-actions">
            {([["archive", "Skip the Inbox"], ["read", "Mark as read"], ["star", "Star it"], ["trash", "Delete it"]] as const).map(([k, t]) => (
              <label key={k} style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--on-surface)" }}>
                <input type="checkbox" checked={action[k]} onChange={(e) => setAction({ ...action, [k]: e.target.checked })} /> {t}
              </label>
            ))}
            <select className="input" value={action.label} onChange={(e) => setAction({ ...action, label: e.target.value })} aria-label="Apply label">
              <option value="">Apply label…</option>
              {labels.filter((l) => l.kind === "user").map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginTop: 12 }}><button className="btn filled" onClick={() => void create()}>Create filter</button></div>
      </div>
      {filters.isLoading && <Spinner />}
      {(filters.data ?? []).map((f) => (
        <div className="setting" key={f.id}>
          <div className="txt">{describe(f.criteria)}<small>{describeAction(f.action)}</small></div>
          <IconButton icon="delete" label="Delete filter" onClick={() => void api.deleteFilter(accountId, f.id).then(() => filters.refetch())} />
        </div>
      ))}
      {filters.data?.length === 0 && <p className="muted">No filters yet.</p>}
    </>
  );
}

function VacationSection() {
  const [accountId, setAccountId] = useAccountChoice();
  const toast = useUi((s) => s.toast);
  const q = useQuery({ queryKey: ["vacation", accountId], queryFn: () => api.getVacation(accountId), enabled: !!accountId });
  const [v, setV] = useState<Vacation | null>(null);
  useEffect(() => { if (q.data) setV(q.data); }, [q.data]);
  if (!v) return <><h2>Vacation responder</h2><Spinner /></>;
  const toDate = (ms?: string) => (ms ? new Date(Number(ms)).toISOString().slice(0, 10) : "");
  const fromDate = (s: string) => (s ? String(new Date(s + "T00:00:00").getTime()) : undefined);
  return (
    <>
      <h2>Vacation responder</h2>
      <p className="lead">Send an automatic reply while you're away. Gmail sends it, even when your Mac is off.</p>
      <AccountPicker value={accountId} onChange={setAccountId} />
      <Setting title="Vacation responder"><Switch label="Vacation responder" on={v.enableAutoReply} onChange={(on) => setV({ ...v, enableAutoReply: on })} /></Setting>
      <div className="form-grid" style={{ marginTop: 16 }}>
        <label>First day</label><input className="input" type="date" value={toDate(v.startTime)} onChange={(e) => setV({ ...v, startTime: fromDate(e.target.value) })} />
        <label>Last day</label><input className="input" type="date" value={toDate(v.endTime)} onChange={(e) => setV({ ...v, endTime: fromDate(e.target.value) })} />
        <label>Subject</label><input className="input" value={v.responseSubject ?? ""} onChange={(e) => setV({ ...v, responseSubject: e.target.value })} />
        <label>Message</label>
        <textarea className="input" rows={6} value={v.responseBodyPlainText ?? (v.responseBodyHtml ?? "").replace(/<[^>]+>/g, "")}
          onChange={(e) => setV({ ...v, responseBodyPlainText: e.target.value, responseBodyHtml: undefined })} />
        <label />
        <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--on-surface)" }}>
          <input type="checkbox" checked={!!v.restrictToContacts} onChange={(e) => setV({ ...v, restrictToContacts: e.target.checked })} /> Only send to people in my contacts
        </label>
      </div>
      <div style={{ marginTop: 16 }}>
        <button className="btn filled" onClick={() => api.setVacation(accountId, v).then(() => toast({ text: "Vacation responder saved" })).catch((e) => toast({ text: String(e), error: true }))}>
          Save changes
        </button>
      </div>
    </>
  );
}

function Notifications() {
  const accounts = useAccounts();
  const prefs = usePrefs();
  const set = useSetPrefs();
  const map = prefs.notifyAccounts ?? {};
  return (
    <>
      <h2>Notifications</h2>
      <p className="lead">Chaucer notifies you about new mail in your Inbox while it's running. macOS controls sounds and banners in System Settings → Notifications.</p>
      {accounts.map((a) => (
        <Setting key={a.id} title={a.email}>
          <Switch label={`Notifications for ${a.email}`} on={map[a.id] ?? true} onChange={(v) => set.mutate({ notifyAccounts: { ...map, [a.id]: v } })} />
        </Setting>
      ))}
    </>
  );
}

export function Settings() {
  const { settings, openSettings } = useUi();
  useProviders();
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && openSettings(null);
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [openSettings]);
  if (!settings) return null;
  return (
    <div className="settings" role="dialog" aria-label="Settings">
      <nav className="settings-nav drag" data-tauri-drag-region>
        <button className="nav-item" onClick={() => openSettings(null)} style={{ marginBottom: 8 }}>
          <Icon name="arrow_back" /><span className="name">Back to mail</span>
        </button>
        {SECTIONS.map((s) => (
          <button key={s.id} className={`nav-item ${settings === s.id ? "active" : ""}`} onClick={() => openSettings(s.id)}>
            <Icon name={s.icon} fill={settings === s.id} /><span className="name">{s.name}</span>
          </button>
        ))}
      </nav>
      <main className="settings-main">
        {settings === "general" && <General />}
        {settings === "inbox" && <Inbox />}
        {settings === "accounts" && <Accounts />}
        {settings === "labels" && <Labels />}
        {settings === "filters" && <Filters />}
        {settings === "vacation" && <VacationSection />}
        {settings === "notifications" && <Notifications />}
        {settings === "smart" && <SmartSettings />}
      </main>
    </div>
  );
}

