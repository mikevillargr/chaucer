import { useEffect, useState } from "react";
import { usePrefs } from "./queries";

/** The theme actually in use: the user's choice, or the system's when set to "system". */
export function useResolvedTheme(): "light" | "dark" {
  const pref = usePrefs().theme ?? "system";
  const query = typeof window !== "undefined" ? window.matchMedia?.("(prefers-color-scheme: dark)") : undefined;
  const [systemDark, setSystemDark] = useState(() => query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    query.addEventListener("change", on);
    return () => query.removeEventListener("change", on);
  }, [query]);
  if (pref === "light" || pref === "dark") return pref;
  return systemDark ? "dark" : "light";
}
