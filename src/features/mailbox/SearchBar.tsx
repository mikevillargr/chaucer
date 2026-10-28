import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Icon, IconButton } from "../../components/ui";
import { api } from "../../lib/ipc";
import { useUi } from "../../lib/store";

export function SearchBar() {
  const { view, setView } = useUi();
  const qc = useQueryClient();
  const [text, setText] = useState(view.label === "SEARCH" ? view.query ?? "" : "");
  const [focused, setFocused] = useState(false);
  const recent = useQuery({ queryKey: ["recentSearches"], queryFn: api.recentSearches, enabled: focused });

  useEffect(() => {
    if (view.label !== "SEARCH") setText("");
  }, [view.label]);

  const submit = (q: string) => {
    const query = q.trim();
    if (!query) return;
    setText(query);
    setView({ accountId: view.accountId, label: "SEARCH", query });
    (document.activeElement as HTMLElement)?.blur();
    setTimeout(() => qc.invalidateQueries({ queryKey: ["recentSearches"] }), 500);
  };

  const suggestions = (recent.data ?? []).filter((r) => r.toLowerCase().includes(text.toLowerCase())).slice(0, 6);

  return (
    <div className="search" role="search">
      <Icon name="search" />
      <input
        id="search-input"
        placeholder="Search in mail"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit(text);
          if (e.key === "Escape") (e.target as HTMLInputElement).blur();
        }}
        aria-label="Search in mail"
      />
      {view.label === "SEARCH" && (
        <IconButton icon="close" label="Clear search" small onClick={() => setView({ accountId: view.accountId, label: "INBOX", category: "CATEGORY_PERSONAL" })} />
      )}
      {focused && suggestions.length > 0 && (
        <div className="search-pop">
          {suggestions.map((s) => (
            <button key={s} onMouseDown={(e) => e.preventDefault()} onClick={() => submit(s)}>
              <Icon name="history" /> {s}
            </button>
          ))}
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void api.clearRecentSearches().then(() => recent.refetch())}
            style={{ color: "var(--primary)", fontSize: 13 }}
          >
            Clear search history
          </button>
        </div>
      )}
    </div>
  );
}
