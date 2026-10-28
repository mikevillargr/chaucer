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
