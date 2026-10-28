import { useEffect, useState } from "react";
import { usePrefs } from "./queries";

/** Themes with their own palette. All of them are dark-only. */
export const SKIN_THEMES = ["kinetic", "terminal-green", "terminal-white"] as const;
export type Skin = (typeof SKIN_THEMES)[number];
export const isSkin = (t: string | undefined): t is Skin => SKIN_THEMES.includes(t as Skin);
/** Terminal themes share one stylesheet grammar and differ only in tokens. */
export const themeFamily = (t: string | undefined) => (t === "terminal-green" || t === "terminal-white" ? "terminal" : t === "kinetic" ? "kinetic" : undefined);

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
  if (isSkin(pref)) return "dark";
  return systemDark ? "dark" : "light";
}
