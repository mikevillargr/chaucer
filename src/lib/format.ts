import type { Addr, Message, ThreadSummary } from "./types";

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** List timestamp: time today, "Mon d" this year, otherwise a short date. */
export function shortDate(ms: number, now = new Date()): string {
  const d = new Date(ms);
  if (sameDay(d, now)) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.toLocaleDateString(undefined, { year: "2-digit", month: "numeric", day: "numeric" });
}

export function fullDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function displayName(a: Addr, me?: string): string {
  if (me && a.email.toLowerCase() === me.toLowerCase()) return "me";
  return a.name || a.email.split("@")[0] || a.email;
}

/** "Ann, Bob, me" for the thread list, first names when several people are involved. */
export function sendersLine(t: ThreadSummary, me?: string): string {
  if (t.senders.length === 0) return "(no sender)";
  if (t.senders.length === 1) return displayName(t.senders[0], me);
  return t.senders
    .slice(-3)
    .map((s) => displayName(s, me).split(" ")[0])
    .join(", ");
}

export function formatAddr(a: Addr): string {
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(a: Addr): string {
  const src = a.name || a.email;
  const parts = src.replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Stable avatar hue from the email address. */
export function avatarHue(email: string): number {
  let h = 0;
  for (const c of email.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** "Re:" / "Fwd:" without stacking prefixes. */
export function prefixed(prefix: "Re:" | "Fwd:", subject: string): string {
  const s = subject.trim();
  const re = prefix === "Re:" ? /^re:/i : /^(fwd?|fw):/i;
  return re.test(s) ? s : `${prefix} ${s}`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Plain text → simple HTML paragraphs with links. */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`)
    .join("");
}

export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("style,script,head").forEach((n) => n.remove());
  doc.querySelectorAll("br").forEach((n) => n.replaceWith("\n"));
  doc.querySelectorAll("p,div,li,tr,h1,h2,h3,h4,blockquote").forEach((n) => n.append("\n"));
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Quoted original for replies, in Gmail's own markup so other clients collapse it. */
export function quoteFor(m: Message): string {
  const who = escapeHtml(formatAddr(m.from));
  const body = m.html ?? textToHtml(m.text ?? "");
  return `<div class="gmail_quote"><div class="gmail_attr">On ${escapeHtml(fullDate(m.date))}, ${who} wrote:<br></div>` +
    `<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${body}</blockquote></div>`;
}

export function forwardBlock(m: Message): string {
  const line = (k: string, v: string) => (v ? `${k}: ${escapeHtml(v)}<br>` : "");
  const body = m.html ?? textToHtml(m.text ?? "");
  return `<div class="gmail_quote">---------- Forwarded message ---------<br>` +
    line("From", formatAddr(m.from)) + line("Date", fullDate(m.date)) + line("Subject", m.subject) +
    line("To", m.to.map(formatAddr).join(", ")) + line("Cc", m.cc.map(formatAddr).join(", ")) +
    `<br>${body}</div>`;
}

/** Parses "Name <a@b>, c@d" typed into a recipient field. */
export function parseAddrList(input: string): Addr[] {
  return input
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^(.*)<([^>]+)>$/);
      return m ? { name: m[1].trim().replace(/^"|"$/g, ""), email: m[2].trim() } : { name: "", email: s };
    })
    .filter((a) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email));
}

/** Parses a mailto: URL into compose fields. */
export function parseMailto(url: string): { to: Addr[]; cc: Addr[]; bcc: Addr[]; subject: string; body: string } {
  const u = new URL(url);
  const q = u.searchParams;
  return {
    to: parseAddrList(decodeURIComponent(u.pathname) + (q.get("to") ? "," + q.get("to") : "")),
    cc: parseAddrList(q.get("cc") ?? ""),
    bcc: parseAddrList(q.get("bcc") ?? ""),
    subject: q.get("subject") ?? "",
    body: q.get("body") ?? "",
  };
}
