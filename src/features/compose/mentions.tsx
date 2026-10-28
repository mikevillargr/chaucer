// Gmail-style @mentions in the compose body: type @ or + and a name, pick a contact, and
// they're inserted as a mailto link and added to To.
import Mention, { type MentionNodeAttrs } from "@tiptap/extension-mention";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import { api } from "../../lib/ipc";
import type { Addr } from "../../lib/types";

export interface MentionMenu {
  items: Addr[];
  index: number;
  rect: DOMRect | null;
  pick: (a: Addr) => void;
}

type Props = SuggestionProps<Addr, MentionNodeAttrs>;

export function mentionExtension(opts: {
  accountId: () => string;
  onMenu: (menu: MentionMenu | null) => void;
  onPick: (a: Addr) => void;
}) {
  const trigger = (char: "@" | "+") => ({
    char,
    // Only after a space or at the start, so typing an email address doesn't open the menu.
    allowedPrefixes: [" ", " "],
    items: async ({ query }: { query: string }) => {
      try {
        return (await api.searchContacts(opts.accountId(), query)).slice(0, 6);
      } catch {
        return [];
      }
    },
    command: ({ editor, range, props }: { editor: Props["editor"]; range: Props["range"]; props: MentionNodeAttrs }) => {
      if (!props.id) return;
      editor.chain().focus().insertContentAt(range, [{ type: "mention", attrs: props }, { type: "text", text: " " }]).run();
      opts.onPick({ email: props.id, name: props.label && props.label !== props.id ? props.label : "" });
    },
    render: () => {
      let current: Props | null = null;
      let index = 0;
      const show = () => {
        if (!current || current.items.length === 0) return opts.onMenu(null);
        const p = current;
        opts.onMenu({
          items: p.items,
          index,
          rect: p.clientRect?.() ?? null,
          pick: (a) => p.command({ id: a.email, label: a.name || a.email }),
        });
      };
      return {
        onStart: (p: Props) => { current = p; index = 0; show(); },
        onUpdate: (p: Props) => { current = p; index = Math.min(index, Math.max(0, p.items.length - 1)); show(); },
        onKeyDown: ({ event }: SuggestionKeyDownProps) => {
          if (!current || current.items.length === 0) return false;
          const n = current.items.length;
          if (event.key === "ArrowDown") { index = (index + 1) % n; show(); return true; }
          if (event.key === "ArrowUp") { index = (index - 1 + n) % n; show(); return true; }
          if (event.key === "Enter" || event.key === "Tab") {
            const a = current.items[index];
            current.command({ id: a.email, label: a.name || a.email });
            return true;
          }
          if (event.key === "Escape") { opts.onMenu(null); current = null; return true; }
          return false;
        },
        onExit: () => { current = null; opts.onMenu(null); },
      };
    },
  });

  return Mention.configure({
    suggestions: [trigger("@"), trigger("+")],
    deleteTriggerWithBackspace: true,
    renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
    renderHTML: ({ node }) => [
      "a",
      { href: `mailto:${node.attrs.id}`, class: "mention", "data-mention": node.attrs.id },
      `@${node.attrs.label ?? node.attrs.id}`,
    ],
  });
}

export function MentionPopup({ menu }: { menu: MentionMenu | null }) {
  if (!menu?.rect) return null;
  const top = Math.min(menu.rect.bottom + 6, window.innerHeight - 40 * menu.items.length - 16);
  return (
    <div className="mention-menu" role="listbox" aria-label="Mention someone" style={{ top, left: menu.rect.left }}>
      {menu.items.map((a, i) => (
        <button
          key={a.email}
          role="option"
          aria-selected={i === menu.index}
          className={i === menu.index ? "on" : ""}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => menu.pick(a)}
        >
          <span>{a.name || a.email}</span>
          {a.name && <small>{a.email}</small>}
        </button>
      ))}
    </div>
  );
}
