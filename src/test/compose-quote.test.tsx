import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { ComposeDock } from "../features/compose/Compose";
import { quoteFor } from "../lib/format";
import { queryClient } from "../lib/queries";
import { useUi } from "../lib/store";
import type { Message } from "../lib/types";

// jsdom has no layout, which ProseMirror asks about when it moves the cursor.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {} });
document.elementFromPoint = () => null;

const original = {
  id: "m1", from: { name: "Marissa", email: "m@example.com" }, to: [], cc: [], bcc: [], replyTo: [],
  subject: "Hello", date: 0, html: "<p>First line</p><p>Second line</p>", text: "", labelIds: [], attachments: [],
} as unknown as Message;
const quoted = quoteFor(original);

beforeEach(() => {
  useUi.setState({ composes: [] });
  useUi.getState().openCompose({ accountId: "a@example.com", mode: "reply", threadId: "t1", html: "<p></p>", quoted });
  render(<QueryClientProvider client={queryClient}><ComposeDock /></QueryClientProvider>);
});

const expand = async () => {
  fireEvent.click(await screen.findByTitle("Show quoted text"));
  return waitFor(() => {
    const el = document.querySelector<HTMLElement>(".quoted-editor .tiptap");
    expect(el).not.toBeNull();
    return el!;
  });
};

test("the quoted text is shown in an editable, selectable area", async () => {
  const el = await expand();
  expect(el.getAttribute("contenteditable")).toBe("true");
  expect(el.textContent).toContain("First line");
  expect(el.textContent).toContain("Second line");
});

test("an untouched quote is kept exactly as received", async () => {
  await expand();
  fireEvent.click(screen.getByTitle("Hide quoted text"));
  expect(useUi.getState().composes[0].quoted).toBe(quoted);
});

test("editing the quote changes what is sent, and keeps Gmail's quote markup", async () => {
  const el = await expand();
  const editor = (el as unknown as { editor: { commands: { insertContent: (s: string) => boolean } } }).editor;
  act(() => { editor.commands.insertContent("EDITED "); });
  const q = useUi.getState().composes[0].quoted;
  expect(q).toContain("EDITED");
  expect(q).toContain("First line");
  expect(q.startsWith('<div class="gmail_quote">')).toBe(true);
  expect(q).toContain('<blockquote class="gmail_quote"');
});
