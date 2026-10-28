import type { Label } from "./types";

/** Sidebar order and naming follow the Android Gmail drawer. */
export const SYSTEM_NAV: { id: string; name: string; icon: string }[] = [
  { id: "INBOX", name: "Inbox", icon: "inbox" },
  { id: "STARRED", name: "Starred", icon: "star" },
  { id: "IMPORTANT", name: "Important", icon: "label_important" },
  { id: "SENT", name: "Sent", icon: "send" },
  { id: "DRAFT", name: "Drafts", icon: "draft" },
  { id: "ALL", name: "All mail", icon: "mail" },
  { id: "SPAM", name: "Spam", icon: "report" },
  { id: "TRASH", name: "Trash", icon: "delete" },
];

export const CATEGORIES: { id: string; name: string; icon: string }[] = [
  { id: "CATEGORY_PERSONAL", name: "Primary", icon: "inbox" },
  { id: "CATEGORY_PROMOTIONS", name: "Promotions", icon: "sell" },
  { id: "CATEGORY_SOCIAL", name: "Social", icon: "group" },
  { id: "CATEGORY_UPDATES", name: "Updates", icon: "info" },
  { id: "CATEGORY_FORUMS", name: "Forums", icon: "forum" },
];

const HIDDEN_IN_CHIPS = new Set([
  "INBOX", "UNREAD", "STARRED", "IMPORTANT", "SENT", "DRAFT", "CHAT", "SPAM", "TRASH",
  ...CATEGORIES.map((c) => c.id),
]);

export function labelName(id: string, labels: Label[]): string {
  return SYSTEM_NAV.find((s) => s.id === id)?.name ?? CATEGORIES.find((c) => c.id === id)?.name ??
    labels.find((l) => l.id === id)?.name ?? id;
}

/** User labels worth showing as chips on a thread row or header. */
export function chipLabels(ids: string[], labels: Label[]): Label[] {
  return ids
    .filter((id) => !HIDDEN_IN_CHIPS.has(id))
    .map((id) => labels.find((l) => l.id === id))
    .filter((l): l is Label => !!l && l.kind === "user");
}

export interface LabelNode {
  label: Label;
  short: string;
  depth: number;
  children: LabelNode[];
}

/** Nests "Clients/NCH" under "Clients", as Gmail does. */
export function labelTree(labels: Label[]): LabelNode[] {
  const users = labels.filter((l) => l.kind === "user" && !l.hidden).sort((a, b) => a.name.localeCompare(b.name));
  const roots: LabelNode[] = [];
  const byName = new Map<string, LabelNode>();
  for (const l of users) {
    const parts = l.name.split("/");
    const node: LabelNode = { label: l, short: parts[parts.length - 1], depth: parts.length - 1, children: [] };
    byName.set(l.name, node);
    const parent = byName.get(parts.slice(0, -1).join("/"));
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

/** Gmail's fixed label palette (the API rejects other colours). */
export const LABEL_COLORS: { bg: string; fg: string }[] = [
  { bg: "#fb4c2f", fg: "#ffffff" }, { bg: "#ffad47", fg: "#ffffff" }, { bg: "#fad165", fg: "#000000" },
  { bg: "#16a766", fg: "#ffffff" }, { bg: "#43d692", fg: "#ffffff" }, { bg: "#4a86e8", fg: "#ffffff" },
  { bg: "#a479e2", fg: "#ffffff" }, { bg: "#f691b3", fg: "#ffffff" }, { bg: "#cccccc", fg: "#000000" },
  { bg: "#666666", fg: "#ffffff" },
];
