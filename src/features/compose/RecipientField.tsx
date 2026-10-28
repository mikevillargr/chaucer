import { useEffect, useState } from "react";
import { Icon } from "../../components/ui";
import { parseAddrList } from "../../lib/format";
import { api } from "../../lib/ipc";
import type { Addr } from "../../lib/types";

/** Chip input for To/Cc/Bcc with contact autocomplete (People API + recent recipients). */
export function RecipientField({ label, value, onChange, accountId, autoFocus, extra }: {
  label: string; value: Addr[]; onChange: (v: Addr[]) => void; accountId: string; autoFocus?: boolean; extra?: React.ReactNode;
}) {
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<Addr[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 1) return setSuggestions([]);
    let alive = true;
    const t = setTimeout(() => {
      api.searchContacts(accountId, q).then((r) => {
        if (alive) {
          setSuggestions(r.filter((s) => !value.some((v) => v.email.toLowerCase() === s.email.toLowerCase())));
          setActive(0);
        }
      }).catch(() => {});
    }, 120);
    return () => { alive = false; clearTimeout(t); };
  }, [text, accountId, value]);

  const add = (addrs: Addr[]) => {
    const fresh = addrs.filter((a) => !value.some((v) => v.email.toLowerCase() === a.email.toLowerCase()));
    if (fresh.length) onChange([...value, ...fresh]);
    setText("");
    setSuggestions([]);
  };

  const commit = () => {
    const parsed = parseAddrList(text);
    if (parsed.length) add(parsed);
  };

  return (
    <div className="field">
      <label>{label}</label>
      <div className="recips">
        {value.map((a) => (
          <span key={a.email} className="recip" title={a.email}>
            {a.name || a.email}
            <button aria-label={`Remove ${a.email}`} onClick={() => onChange(value.filter((v) => v !== a))}><Icon name="close" /></button>
          </span>
        ))}
        <input
          value={text}
          autoFocus={autoFocus}
          aria-label={label}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,;]\s*$/.test(v)) {
              const parsed = parseAddrList(v);
              if (parsed.length) return add(parsed);
            }
            setText(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && suggestions.length) { e.preventDefault(); setActive((active + 1) % suggestions.length); }
            else if (e.key === "ArrowUp" && suggestions.length) { e.preventDefault(); setActive((active - 1 + suggestions.length) % suggestions.length); }
            else if ((e.key === "Enter" || e.key === "Tab") && suggestions.length && text) { e.preventDefault(); add([suggestions[active]]); }
            else if (e.key === "Enter" || (e.key === "Tab" && text)) { if (text) { e.preventDefault(); commit(); } }
            else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => setTimeout(commit, 150)}
          onPaste={(e) => {
            const parsed = parseAddrList(e.clipboardData.getData("text"));
            if (parsed.length > 1) { e.preventDefault(); add(parsed); }
          }}
        />
      </div>
      {extra}
      {suggestions.length > 0 && text && (
        <div className="suggest">
          {suggestions.map((s, i) => (
            <button key={s.email} className={i === active ? "on" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => add([s])}>
              <span>{s.name || s.email}</span>
              {s.name && <small>{s.email}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
