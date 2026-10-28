import { sanitizeEmail } from "../features/thread/EmailFrame";
import { htmlToText, parseAddrList, parseMailto, prefixed, sendersLine } from "../lib/format";
import { labelTree } from "../lib/labels";
import { belongs } from "../lib/queries";
import type { Label, ThreadSummary } from "../lib/types";

const thread = (labelIds: string[], accountId = "a@x.com"): ThreadSummary => ({
  accountId, id: "t", historyId: "1", subject: "s", snippet: "", senders: [], lastDate: 0,
  unread: false, starred: false, important: false, labelIds, messageCount: 1, hasAttachments: false,
});

describe("sanitizeEmail", () => {
  it("strips scripts and handlers", () => {
    const { html } = sanitizeEmail('<p onclick="x()">hi</p><script>alert(1)</script><img src="x" onerror="y()">', true);
    expect(html).not.toMatch(/script|onclick|onerror/);
    expect(html).toContain("hi");
  });

  it("blocks remote images and CSS urls until allowed", () => {
    const src = '<img src="https://track.example/p.gif"><div style="background:url(https://x.example/bg.png)">a</div>' +
      '<style>.a{background:url("https://x.example/c.png")}</style>';
    const blocked = sanitizeEmail(src, false);
    expect(blocked.blocked).toBe(3);
    expect(blocked.html).not.toContain("https://x.example");
    expect(blocked.html).toContain('data-blocked-src="https://track.example/p.gif"');
    expect(sanitizeEmail(src, true).html).toContain('src="https://track.example/p.gif"');
  });

  it("keeps data: inline images and detects quoted text", () => {
    const r = sanitizeEmail('<img src="data:image/png;base64,AAAA"><div class="gmail_quote">old</div>', false);
    expect(r.blocked).toBe(0);
    expect(r.html).toContain("data:image/png");
    expect(r.hasQuote).toBe(true);
  });
});

describe("format helpers", () => {
  it("parses typed recipients", () => {
    expect(parseAddrList('Ann Lee <ann@x.com>, bob@y.org; not-an-email')).toEqual([
      { name: "Ann Lee", email: "ann@x.com" },
      { name: "", email: "bob@y.org" },
    ]);
  });

  it("parses mailto links", () => {
    const m = parseMailto("mailto:ann@x.com?cc=bob@y.org&subject=Hello%20there&body=Line%201");
    expect(m.to[0].email).toBe("ann@x.com");
    expect(m.cc[0].email).toBe("bob@y.org");
    expect(m.subject).toBe("Hello there");
    expect(m.body).toBe("Line 1");
  });

  it("does not stack reply prefixes", () => {
    expect(prefixed("Re:", "Plans")).toBe("Re: Plans");
    expect(prefixed("Re:", "RE: Plans")).toBe("RE: Plans");
    expect(prefixed("Fwd:", "Fw: Plans")).toBe("Fw: Plans");
  });

  it("names senders like Gmail", () => {
    const t = thread([]);
    t.senders = [{ name: "Ann Lee", email: "ann@x.com" }, { name: "Mike V", email: "a@x.com" }];
    expect(sendersLine(t, "a@x.com")).toBe("Ann, me");
  });

  it("turns html into text", () => {
    expect(htmlToText("<p>Hi</p><p>there<br>you</p>")).toBe("Hi\nthere\nyou");
  });
});

describe("view membership", () => {
  it("drops archived threads from the inbox but keeps them in All mail", () => {
    expect(belongs({ accountId: null, label: "INBOX" }, thread(["INBOX"]))).toBe(true);
    expect(belongs({ accountId: null, label: "INBOX" }, thread(["STARRED"]))).toBe(false);
    expect(belongs({ accountId: null, label: "ALL" }, thread(["STARRED"]))).toBe(true);
    expect(belongs({ accountId: null, label: "ALL" }, thread(["TRASH"]))).toBe(false);
    expect(belongs({ accountId: null, label: "TRASH" }, thread(["TRASH"]))).toBe(true);
  });

  it("respects category tabs and accounts", () => {
    const v = { accountId: "a@x.com", label: "INBOX", category: "CATEGORY_SOCIAL" };
    expect(belongs(v, thread(["INBOX", "CATEGORY_SOCIAL"]))).toBe(true);
    expect(belongs(v, thread(["INBOX", "CATEGORY_PERSONAL"]))).toBe(false);
    expect(belongs(v, thread(["INBOX", "CATEGORY_SOCIAL"], "b@x.com"))).toBe(false);
  });
});

it("nests labels by slash", () => {
  const l = (name: string): Label => ({ accountId: "a", id: name, name, kind: "user", colorBg: null, colorText: null, threadsUnread: 0, threadsTotal: 0, hidden: false });
  const tree = labelTree([l("Clients/NCH"), l("Clients"), l("Receipts")]);
  expect(tree.map((n) => n.short)).toEqual(["Clients", "Receipts"]);
  expect(tree[0].children[0].short).toBe("NCH");
});

describe("update notes", () => {
  it("flattens changelog markdown for the update card", async () => {
    const { plainNotes } = await import("../features/updates/updates");
    expect(plainNotes("### Mail\n- **Undo** for actions\n\nSee [setup](https://x.y/z).\n")).toEqual([
      "### Mail", "- Undo for actions", "See setup.",
    ]);
  });
});

describe("dark mode email rendering", () => {
  it("measures contrast and lightens unreadable text", async () => {
    const { contrast, legibleOn, parseColor } = await import("../lib/color");
    const bg = parseColor("#071622")!;
    expect(contrast(parseColor("#000")!, parseColor("white")!)).toBeCloseTo(21, 0);
    const fixed = parseColor(legibleOn(parseColor("#333")!, bg))!;
    expect(contrast(fixed, bg)).toBeGreaterThanOrEqual(4.5);
    expect(legibleOn(parseColor("#e9eef3")!, bg)).toBe("#e9eef3"); // already legible: unchanged
    expect(parseColor("rgba(0, 0, 0, 0)")).toBeNull();
  });

  it("recolours simple emails and keeps designed ones on a light card", async () => {
    const { contrast, parseColor } = await import("../lib/color");
    const simple = sanitizeEmail('<p style="color:#222">Hi</p><font color="#111">there</font><div style="background-color:#fff">x</div>', true, "dark");
    expect(simple.appearance).toBe("dark");
    const doc = new DOMParser().parseFromString(simple.html, "text/html");
    const p = doc.querySelector("p")!.style.color;
    expect(contrast(parseColor(p)!, parseColor("#071622")!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(parseColor(doc.querySelector("font")!.getAttribute("color")!)!, parseColor("#071622")!)).toBeGreaterThanOrEqual(4.5);
    expect(doc.querySelector("div")!.style.backgroundColor).toBe("transparent");

    const designed = sanitizeEmail('<table bgcolor="#00233b"><tr><td style="color:#fff">News</td></tr></table>', true, "dark");
    expect(designed.designed).toBe(true);
    expect(designed.appearance).toBe("original");
    expect(sanitizeEmail("<p>x</p>", true, "dark", true).appearance).toBe("original"); // user override
    expect(sanitizeEmail("<p>x</p>", true, "light").appearance).toBe("light");
  });
});

describe("pane widths", () => {
  it("clamps to bounds and leaves room for the reader", async () => {
    const { clampWidth, PANES } = await import("../lib/panes");
    expect(clampWidth("list", 100, 256, 1600)).toBe(PANES.list.min);
    expect(clampWidth("list", 2000, 256, 1600)).toBe(PANES.list.max);
    expect(clampWidth("list", 600, 256, 1000)).toBe(1000 - 256 - PANES.readerMin);
    expect(clampWidth("sidebar", 300, 400, 1600)).toBe(300);
  });
});

it("maps neutral email text onto app text tones in dark mode", async () => {
  const { darkModeText, parseColor } = await import("../lib/color");
  const bg = parseColor("#071622")!;
  expect(darkModeText(parseColor("#222")!, bg)).toBe("#e9eef3");
  expect(darkModeText(parseColor("#666")!, bg)).toBe("#b4c2cd");
  expect(darkModeText(parseColor("#b91c1c")!, bg)).not.toBe("#e9eef3"); // coloured text keeps its hue
});
