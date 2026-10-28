import { useQueryClient } from "@tanstack/react-query";
import { forwardBlock, prefixed, quoteFor, textToHtml } from "../../lib/format";
import { api } from "../../lib/ipc";
import { useAccounts } from "../../lib/queries";
import { useUi, type ComposeState } from "../../lib/store";
import type { Addr, Message, SendAs, ThreadDetail } from "../../lib/types";

export function signatureHtml(sig?: string) {
  return sig ? `<p></p><div class="gmail_signature">-- <br>${sig}</div>` : "";
}

const lower = (a: Addr) => a.email.toLowerCase();

export function useStartCompose() {
  const qc = useQueryClient();
  const accounts = useAccounts();
  const { view, openCompose, toast } = useUi();

  async function sendAsFor(accountId: string): Promise<SendAs[]> {
    try {
      return await qc.fetchQuery({ queryKey: ["sendAs", accountId], queryFn: () => api.sendAs(accountId), staleTime: 600_000 });
    } catch {
      return [];
    }
  }

  async function defaultSig(accountId: string) {
    const list = await sendAsFor(accountId);
    return (list.find((s) => s.isDefault) ?? list[0])?.signature;
  }

  /** New message. `prefill` is used by mailto: links and smart features. */
  async function start(prefill: Partial<ComposeState> & { body?: string } = {}) {
    const accountId = prefill.accountId ?? view.accountId ?? accounts[0]?.id;
    if (!accountId) return toast({ text: "Add an account first", error: true });
    const { body, ...rest } = prefill;
    openCompose({ accountId, html: (body ? textToHtml(body) : "") + signatureHtml(await defaultSig(accountId)), ...rest });
  }

  async function reply(detail: ThreadDetail, m: Message, mode: "reply" | "replyAll", text = "") {
    const accountId = detail.summary.accountId;
    const mine = new Set([accountId.toLowerCase(), ...(await sendAsFor(accountId)).map((s) => s.sendAsEmail.toLowerCase())]);
    const fromMe = mine.has(lower(m.from));
    let to: Addr[] = fromMe ? m.to : m.replyTo.length ? m.replyTo : [m.from];
    let cc: Addr[] = [];
    if (mode === "replyAll") {
      const seen = new Set(to.map(lower));
      cc = [...m.to, ...m.cc].filter((a) => {
        const k = lower(a);
        if (mine.has(k) || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (fromMe) to = to.filter((a) => !mine.has(lower(a)));
    }
    openCompose({
      accountId, mode, to, cc,
      subject: prefixed("Re:", m.subject || detail.summary.subject),
      html: (text ? textToHtml(text) : "") + signatureHtml(await defaultSig(accountId)),
      quoted: quoteFor(m),
      threadId: detail.summary.id,
      inReplyTo: m.messageIdHeader,
      references: m.references,
    });
  }

  async function forward(detail: ThreadDetail, m: Message) {
    const accountId = detail.summary.accountId;
    openCompose({
      accountId, mode: "forward",
      subject: prefixed("Fwd:", m.subject || detail.summary.subject),
      html: signatureHtml(await defaultSig(accountId)),
      quoted: forwardBlock(m),
      threadId: detail.summary.id,
      attachments: m.attachments
        .filter((a) => !a.inline)
        .map((a) => ({ kind: "gmail", messageId: m.id, attachmentId: a.attachmentId, filename: a.filename, mimeType: a.mimeType })),
    });
  }

  /** Opens a saved draft (a DRAFT-labelled message) for editing. */
  async function editDraft(detail: ThreadDetail, m: Message) {
    const accountId = detail.summary.accountId;
    const draftId = await api.draftForMessage(accountId, m.id).catch(() => null);
    const replyTarget = [...detail.messages].reverse().find((x) => x.id !== m.id && !x.labelIds.includes("DRAFT"));
    openCompose({
      accountId, mode: "draft", draftId,
      to: m.to, cc: m.cc, bcc: m.bcc, subject: m.subject,
      html: m.html ?? textToHtml(m.text ?? ""),
      threadId: detail.messages.length > 1 ? detail.summary.id : null,
      inReplyTo: replyTarget?.messageIdHeader ?? null,
      references: replyTarget?.references ?? null,
      attachments: m.attachments
        .filter((a) => !a.inline)
        .map((a) => ({ kind: "gmail", messageId: m.id, attachmentId: a.attachmentId, filename: a.filename, mimeType: a.mimeType })),
    });
  }

  return Object.assign(start, { reply, forward, editDraft });
}
