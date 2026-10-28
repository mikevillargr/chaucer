// In-memory stand-in for the Rust backend, used for the browser preview and tests.
// Implements the same commands as src-tauri/src/commands.rs with fake data.
import type { Account, Addr, Label, Message, Prefs, ProviderInfo, ThreadDetail, ThreadSummary } from "./types";

const HOUR = 3_600_000;
const now = Date.now();

const accounts: Account[] = [
  { id: "mike@growth-rocket.com", email: "mike@growth-rocket.com", displayName: "Mike Villar", needsReauth: false },
  { id: "mike.personal@gmail.com", email: "mike.personal@gmail.com", displayName: "Mike", needsReauth: false },
];

const sys = (accountId: string, id: string, name: string, unread = 0): Label => ({
  accountId, id, name, kind: "system", colorBg: null, colorText: null, threadsUnread: unread, threadsTotal: 0, hidden: false,
});
const user = (accountId: string, id: string, name: string, bg: string, fg: string): Label => ({
  accountId, id, name, kind: "user", colorBg: bg, colorText: fg, threadsUnread: 0, threadsTotal: 0, hidden: false,
});

const labels: Label[] = accounts.flatMap((a) => [
  sys(a.id, "INBOX", "INBOX"), sys(a.id, "STARRED", "STARRED"), sys(a.id, "IMPORTANT", "IMPORTANT"),
  sys(a.id, "SENT", "SENT"), sys(a.id, "DRAFT", "DRAFT"), sys(a.id, "SPAM", "SPAM"), sys(a.id, "TRASH", "TRASH"),
  sys(a.id, "CATEGORY_PERSONAL", "CATEGORY_PERSONAL"), sys(a.id, "CATEGORY_SOCIAL", "CATEGORY_SOCIAL"),
  sys(a.id, "CATEGORY_PROMOTIONS", "CATEGORY_PROMOTIONS"), sys(a.id, "CATEGORY_UPDATES", "CATEGORY_UPDATES"),
  sys(a.id, "CATEGORY_FORUMS", "CATEGORY_FORUMS"),
  user(a.id, `${a.id}-clients`, "Clients", "#16a765", "#ffffff"),
  user(a.id, `${a.id}-clients-nch`, "Clients/NCH", "#4986e7", "#ffffff"),
  user(a.id, `${a.id}-receipts`, "Receipts", "#ffad47", "#ffffff"),
]);

const people: Addr[] = [
  { name: "Ana Reyes", email: "ana@nchinc.com" },
  { name: "Priya Shah", email: "priya@entiretravel.com" },
  { name: "GitHub", email: "noreply@github.com" },
  { name: "Figma", email: "no-reply@figma.com" },
  { name: "Jordan Lee", email: "jordan@growth-rocket.com" },
  { name: "Stripe", email: "receipts@stripe.com" },
  { name: "LinkedIn", email: "messages-noreply@linkedin.com" },
  { name: "Sam Ortiz", email: "sam.ortiz@gmail.com" },
];

const threads: ThreadSummary[] = [];
const details = new Map<string, Message[]>();

function seed(i: number, account: Account, from: Addr, subject: string, body: string, ageH: number, labelIds: string[], extra: Partial<Message> = {}) {
  const id = `t${i}`;
  const m: Message = {
    id: `m${i}`, threadId: id, labelIds, date: now - ageH * HOUR, from,
    to: [{ name: account.displayName ?? "", email: account.email }], cc: [], bcc: [], replyTo: [],
    subject, snippet: body.replace(/<[^>]+>/g, "").slice(0, 120), html: body, text: null, attachments: [],
    messageIdHeader: `<${id}@mock>`, references: null, listUnsubscribe: null, listUnsubscribePost: null, ...extra,
  };
  const msgs = [m];
  if (i === 1) {
    msgs.unshift({ ...m, id: "m1a", labelIds: ["SENT"], date: now - 26 * HOUR, from: { name: account.displayName ?? "", email: account.email },
      to: [from], snippet: "Hi Ana — sharing the draft deck for this week's executive update…",
      html: "<p>Hi Ana — sharing the draft deck for this week's executive update. Let me know what you think.</p><p>Mike</p>" });
  }
  details.set(id, msgs);
  threads.push({
    accountId: account.id, id, historyId: "1", subject, snippet: m.snippet,
    senders: msgs.map((x) => x.from).filter((a, j, arr) => arr.findIndex((b) => b.email === a.email) === j),
    lastDate: m.date, unread: labelIds.includes("UNREAD"), starred: labelIds.includes("STARRED"),
    important: labelIds.includes("IMPORTANT"), labelIds: [...new Set(msgs.flatMap((x) => x.labelIds))],
    messageCount: msgs.length, hasAttachments: m.attachments.some((a) => !a.inline),
  });
}

const [work, personal] = accounts;
seed(1, work, people[0], "Re: Weekly executive update — WB Oct 26",
  "<p>Thanks Mike, this looks great. Two small notes:</p><ul><li>Can we move the Striking Distance slide before AI Overviews?</li><li>Nevada rankings — add the week-over-week delta.</li></ul><p>Otherwise good to send Friday.</p><p>Ana</p>",
  1, ["INBOX", "UNREAD", "IMPORTANT", "CATEGORY_PERSONAL", `${work.id}-clients-nch`],
  { attachments: [{ attachmentId: "a1", filename: "NCH_Executive_Update_WB1026.pdf", mimeType: "application/pdf", size: 2_480_000, contentId: null, inline: false }] });
seed(2, work, people[1], "Star Clippers campaign — CPL question",
  "<p>Hi Mike,</p><p>Quick one: CPL on the Star Clippers ads jumped this week. Is that the new audience test or seasonal? Happy to jump on a call.</p><p>Priya</p>",
  3, ["INBOX", "UNREAD", "CATEGORY_PERSONAL", `${work.id}-clients`]);
seed(3, work, people[4], "Offsite agenda", "<p>Draft agenda for the November offsite is in the doc. Add anything by Thursday?</p>",
  20, ["INBOX", "STARRED", "CATEGORY_PERSONAL"]);
seed(4, work, people[2], "[growthrocket/tars] PR #412: Fix harness retry", "<p><b>jordan-lee</b> requested your review on this pull request.</p>",
  5, ["INBOX", "UNREAD", "CATEGORY_UPDATES"],
  { listUnsubscribe: "<https://github.com/notifications/unsubscribe/abc>", listUnsubscribePost: "List-Unsubscribe=One-Click" });
seed(5, work, people[3], "Your Figma invoice", "<p>Your invoice for October is ready. Total: $45.00</p>",
  30, ["INBOX", "CATEGORY_UPDATES", `${work.id}-receipts`]);
seed(6, personal, people[7], "Dinner Saturday?", "<p>Are we still on for Saturday? I can book the place on 5th around 7.</p>",
  2, ["INBOX", "UNREAD", "CATEGORY_PERSONAL"]);
seed(7, personal, people[6], "You appeared in 14 searches this week", "<p>See who's looking at your profile.</p>",
  8, ["INBOX", "CATEGORY_SOCIAL"],
  { listUnsubscribe: "<mailto:unsubscribe@linkedin.com?subject=unsubscribe>" });
seed(8, personal, people[5], "Your receipt from Paseo", "<p>Receipt #2041-3382 — $20.00 paid with Visa •••• 4242.</p>",
  50, ["INBOX", "CATEGORY_UPDATES"]);
seed(9, work, { name: "Mike Villar", email: work.email }, "Proposal: Q1 SEO roadmap", "<p>Attached is the roadmap we discussed.</p>",
  70, ["SENT"]);
seed(10, work, people[1], "Swain itinerary review", "<p>Here's the revised itinerary copy for review.</p>",
  96, ["INBOX", "CATEGORY_PERSONAL", `${work.id}-clients`]);

seed(11, work, people[0], "Notes from Tuesday",
  "<div style=\"color:#222222\">Hi Mike,</div><p><span style=\"color:#333\">Quick recap of Tuesday</span> — <font color=\"#1a1a1a\">the deck is approved</font> and <span style=\"color:#b91c1c\">the launch date moves to Nov 12</span>.</p><p style=\"background-color:#ffffff\">Thanks!</p>",
  6, ["INBOX", "CATEGORY_PERSONAL"]);
seed(12, work, { name: "Growth Weekly", email: "news@growthweekly.example" }, "This week in search: 5 changes to watch",
  "<table width=\"100%\" bgcolor=\"#00233b\" style=\"color:#ffffff\"><tr><td style=\"padding:24px;font-size:22px\">Growth Weekly</td></tr></table><table width=\"100%\" bgcolor=\"#fff6ec\"><tr><td style=\"padding:16px;color:#0a1b28\">1. AI Overviews expand to more queries.<br>2. Core update rollout finished.</td></tr></table>",
  10, ["INBOX", "CATEGORY_UPDATES"], { listUnsubscribe: "<https://growthweekly.example/u>", listUnsubscribePost: "List-Unsubscribe=One-Click" });

let prefs: Prefs = {};
const providers: ProviderInfo[] = [];
const recent: string[] = ["from:ana", "has:attachment invoice"];
const listeners = new Map<string, Set<(p: unknown) => void>>();

function refreshCounts() {
  for (const l of labels) {
    const mine = threads.filter((t) => t.accountId === l.accountId && t.labelIds.includes(l.id));
    l.threadsTotal = mine.length;
    l.threadsUnread = mine.filter((t) => t.unread).length;
  }
}
refreshCounts();

const matches = (accountId: string | null, ls: string[]) => (t: ThreadSummary) =>
  (!accountId || t.accountId === accountId) && ls.every((l) => t.labelIds.includes(l));

function apply(t: ThreadSummary, add: string[], remove: string[]) {
  t.labelIds = [...new Set([...t.labelIds.filter((l) => !remove.includes(l)), ...add])];
  t.unread = t.labelIds.includes("UNREAD");
  t.starred = t.labelIds.includes("STARRED");
  t.important = t.labelIds.includes("IMPORTANT");
  for (const m of details.get(t.id) ?? []) m.labelIds = [...new Set([...m.labelIds.filter((l) => !remove.includes(l)), ...add])];
}

const sorted = (list: ThreadSummary[]) => [...list].sort((a, b) => b.lastDate - a.lastDate);
const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));

const handlers: Record<string, (a: any) => unknown> = {
  app_status: () => ({ hasClient: true, accounts }),
  set_google_client: () => undefined,
  add_account: () => accounts[0],
  remove_account: () => undefined,
  sync_now: () => undefined,
  get_prefs: () => prefs,
  set_prefs: ({ patch }) => {
    prefs = { ...prefs, ...patch };
    for (const [k, v] of Object.entries(patch)) if (v === null) delete prefs[k];
    return prefs;
  },
  list_labels: ({ accountId }) => labels.filter((l) => !accountId || l.accountId === accountId),
  cached_threads: ({ accountId, labels: ls }) => sorted(threads.filter(matches(accountId, ls))),
  fetch_threads: async ({ accountId, labels: ls }) => {
    await wait();
    return { threads: sorted(threads.filter(matches(accountId, ls))), next: [] };
  },
  search: async ({ accountId, query }) => {
    await wait();
    const q = String(query).toLowerCase().replace(/\b\w+:/g, "").trim();
    if (!recent.includes(query)) recent.unshift(query);
    return {
      threads: sorted(threads.filter((t) => (!accountId || t.accountId === accountId) &&
        [t.subject, t.snippet, ...t.senders.map((s) => s.name + s.email)].join(" ").toLowerCase().includes(q))),
      next: [],
    };
  },
  recent_searches: () => recent,
  clear_recent_searches: () => void recent.splice(0),
  get_thread: async ({ threadId }): Promise<ThreadDetail> => {
    await wait(80);
    const summary = threads.find((t) => t.id === threadId)!;
    return { summary, messages: details.get(threadId) ?? [] };
  },
  act_on_threads: ({ threads: refs, op, add = [], remove = [] }) => {
    const out: ThreadSummary[] = [];
    for (const r of refs as { threadId: string }[]) {
      const t = threads.find((x) => x.id === r.threadId);
      if (!t) continue;
      if (op === "trash") apply(t, ["TRASH"], ["INBOX", "UNREAD"]);
      else if (op === "untrash") apply(t, [], ["TRASH"]);
      else apply(t, add, remove);
      out.push(t);
    }
    refreshCounts();
    return out;
  },
  block_sender: () => undefined,
  unsubscribe: () => null,
  attachment_data: () => "",
  save_attachment: () => undefined,
  open_attachment: () => undefined,
  send_message: async () => wait(400),
  save_draft: async () => ({ draftId: "d1", messageId: "md1", threadId: "td1" }),
  delete_draft: () => undefined,
  draft_for_message: () => null,
  search_contacts: ({ query }) =>
    people.filter((p) => (p.name + p.email).toLowerCase().includes(String(query).toLowerCase())).slice(0, 6),
  send_as: ({ accountId }) => {
    const a = accounts.find((x) => x.id === accountId)!;
    return [{ sendAsEmail: a.email, displayName: a.displayName, isPrimary: true, isDefault: true,
      signature: "<div>Mike Villar<br>Growth Rocket</div>" }];
  },
  get_vacation: () => ({ enableAutoReply: false, responseSubject: "", responseBodyHtml: "" }),
  set_vacation: ({ settings }) => settings,
  list_filters: () => [{ id: "f1", criteria: { from: "noreply@github.com" }, action: { removeLabelIds: ["INBOX"] } }],
  create_filter: ({ filter }) => ({ id: "f2", ...filter }),
  delete_filter: () => undefined,
  create_label: ({ accountId, label }) => {
    labels.push(user(accountId, `${accountId}-${Date.now()}`, label.name, "#a479e2", "#ffffff"));
    return labels.filter((l) => l.accountId === accountId);
  },
  update_label: ({ accountId }) => labels.filter((l) => l.accountId === accountId),
  delete_label: ({ accountId, labelId }) => {
    labels.splice(labels.findIndex((l) => l.id === labelId), 1);
    return labels.filter((l) => l.accountId === accountId);
  },
  llm_providers: () => providers,
  llm_save_provider: ({ provider, apiKey }) => {
    const i = providers.findIndex((p) => p.id === provider.id);
    const hasKey = apiKey ? true : i >= 0 ? providers[i].hasKey : false;
    if (i >= 0) providers[i] = { ...provider, hasKey };
    else providers.push({ ...provider, hasKey });
  },
  llm_delete_provider: ({ providerId }) => void providers.splice(providers.findIndex((p) => p.id === providerId), 1),
  llm_test: async () => (await wait(300), "OK"),
  smart_replies: async () => (await wait(500), ["Sounds good, thanks!", "Let me take a look.", "Can we talk tomorrow?"]),
  summarize_thread: async () => (await wait(600),
    "• Ana approved the deck with two edits.\n• Move Striking Distance before AI Overviews; add Nevada week-over-week delta.\n• Send on Friday."),
  help_write: async ({ instruction }) => (await wait(600),
    `Hi Priya,\n\nThanks for flagging this. The jump is mostly from the new audience test we launched Monday (${instruction}). I'll share a breakdown by Thursday.\n\nBest,\nMike`),
};

export async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const h = handlers[cmd];
  if (!h) throw new Error(`mock: unknown command ${cmd}`);
  return (await h(args)) as T;
}

export async function listen(event: string, cb: (payload: unknown) => void) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(cb);
  return () => listeners.get(event)!.delete(cb);
}
