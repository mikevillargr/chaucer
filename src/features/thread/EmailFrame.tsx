import DOMPurify from "dompurify";
import { useEffect, useMemo, useRef, useState } from "react";
import { darkModeText, isLightBackground, parseColor, type Rgb } from "../../lib/color";

const BASE_CSS = `
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; color: #1f1f1f;
         word-wrap: break-word; overflow-wrap: anywhere; padding: 4px 2px; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  pre { white-space: pre-wrap; }
  a { color: #00233b; }
  blockquote { margin: 0 0 0 .8ex; border-left: 1px solid #ccc; padding-left: 1ex; }
  body:not(.show-quoted) .gmail_quote, body:not(.show-quoted) blockquote[type="cite"],
  body:not(.show-quoted) #divRplyFwdMsg, body:not(.show-quoted) #divRplyFwdMsg ~ *,
  body:not(.show-quoted) .yahoo_quoted, body:not(.show-quoted) #appendonsend ~ * { display: none !important; }
`;

/** Dark rendering for simple emails: transparent page, light text, azure links. */
const DARK_CSS = `
  html { color-scheme: dark; }
  html, body { background: transparent !important; }
  body { color: #e9eef3; }
  a { color: #62d7de; }
  blockquote { border-left-color: rgba(233, 238, 243, .25); }
  hr { border-color: rgba(233, 238, 243, .18); }
`;

const DARK_SURFACE: Rgb = [7, 22, 34]; // --surface in dark mode (#071622)
const QUOTE_SELECTOR = '.gmail_quote, blockquote[type="cite"], #divRplyFwdMsg, .yahoo_quoted, #appendonsend';
const REMOTE_URL = /url\(\s*(['"]?)(https?:)?\/\/[^)]*\)/gi;
const HAS_REMOTE_URL = /url\(\s*['"]?(https?:)?\/\//i;
const CSS_BG = /background(?:-color)?\s*:\s*([^;}]+)/gi;

export type Appearance = "light" | "dark" | "original";

export interface Sanitized {
  html: string;
  blocked: number;
  hasQuote: boolean;
  /** The sender styled the email with its own backgrounds (newsletters, receipts). */
  designed: boolean;
  /** How it was rendered: light, recoloured for dark, or original colours on a light card. */
  appearance: Appearance;
}

function firstColor(value: string): Rgb | null {
  const token = value.match(/#[0-9a-f]{3,6}\b|rgba?\([^)]*\)|\b[a-z]+\b/i)?.[0];
  return token ? parseColor(token) : null;
}

/** Does the email paint its own (non-white) backgrounds? */
function isDesigned(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of doc.querySelectorAll<HTMLElement>("[bgcolor], [style], [background]")) {
    const bg = el.getAttribute("bgcolor") ?? el.style?.backgroundColor ?? "";
    const c = bg ? parseColor(bg) ?? firstColor(bg) : null;
    if (c && !isLightBackground(c)) return true;
    if (el.getAttribute("background") || /url\(/i.test(el.style?.backgroundImage ?? "")) return true;
  }
  for (const style of doc.querySelectorAll("style")) {
    for (const m of (style.textContent ?? "").matchAll(CSS_BG)) {
      const c = firstColor(m[1]);
      if ((c && !isLightBackground(c)) || /url\(/i.test(m[1])) return true;
    }
  }
  return false;
}

/** Recolours inline text that would be unreadable on the dark surface; drops white fills. */
function adaptForDark(el: HTMLElement) {
  const fix = (value: string) => {
    const c = parseColor(value);
    return c ? darkModeText(c, DARK_SURFACE) : null;
  };
  if (el.style?.color) {
    const v = fix(el.style.color);
    if (v) el.style.setProperty("color", v, "important");
  }
  const fontColor = el.tagName === "FONT" ? el.getAttribute("color") : null;
  if (fontColor) {
    const v = fix(fontColor);
    if (v) el.setAttribute("color", v);
  }
  const bg = el.style?.backgroundColor ? parseColor(el.style.backgroundColor) : null;
  if (bg && isLightBackground(bg)) el.style.setProperty("background-color", "transparent");
  const attrBg = el.getAttribute("bgcolor");
  if (attrBg && parseColor(attrBg) && isLightBackground(parseColor(attrBg)!)) el.removeAttribute("bgcolor");
}

function adaptStylesheet(css: string): string {
  return css
    .replace(/(^|[;{\s])color\s*:\s*([^;}!]+)/gi, (m, pre, value) => {
      const c = parseColor(value);
      return c ? `${pre}color: ${darkModeText(c, DARK_SURFACE)}` : m;
    })
    .replace(CSS_BG, (m, value) => {
      const c = firstColor(value);
      return c && isLightBackground(c) ? "background-color: transparent" : m;
    });
}

/**
 * Strips active content, blocks remote images until allowed, and picks an appearance:
 * in dark mode simple emails are recoloured, designed ones keep their colours on a light card
 * (like Apple Mail). `original` forces the sender's colours.
 */
export function sanitizeEmail(html: string, allowRemote: boolean, theme: "light" | "dark" = "light", original = false): Sanitized {
  const designed = theme === "dark" ? isDesigned(html) : false;
  const appearance: Appearance = theme === "light" ? "light" : original || designed ? "original" : "dark";
  let blocked = 0;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    const el = node as HTMLElement;
    if (el.tagName === "A") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }
    if (appearance === "dark" && el.nodeType === 1) adaptForDark(el);
    if (allowRemote) return;
    for (const attr of ["src", "srcset", "background", "poster"]) {
      const v = el.getAttribute?.(attr);
      if (v && /^(https?:)?\/\//i.test(v.trim())) {
        el.removeAttribute(attr);
        if (attr === "src") {
          el.setAttribute("data-blocked-src", v);
          blocked++;
        }
      }
    }
    const style = el.getAttribute?.("style");
    if (style && HAS_REMOTE_URL.test(style)) {
      el.setAttribute("style", style.replace(REMOTE_URL, "none"));
      blocked++;
    }
  });
  try {
    let out = DOMPurify.sanitize(html, {
      WHOLE_DOCUMENT: true,
      FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "base", "meta", "link"],
      FORBID_ATTR: ["onerror", "onload", "onclick"],
      ADD_ATTR: ["target"],
      ALLOW_DATA_ATTR: true,
    });
    out = out.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (_m, attrs, css: string) => {
      let cleaned = allowRemote ? css : css.replace(REMOTE_URL, () => (blocked++, "none")).replace(/@import[^;]+;/gi, "");
      if (appearance === "dark") cleaned = adaptStylesheet(cleaned);
      return `<style${attrs}>${cleaned}</style>`;
    });
    const hasQuote = new DOMParser().parseFromString(out, "text/html").querySelector(QUOTE_SELECTOR) !== null;
    return { html: out, blocked, hasQuote, designed, appearance };
  } finally {
    DOMPurify.removeHook("afterSanitizeAttributes");
  }
}

export function EmailFrame({ html, allowRemote, showQuoted, theme, original, onLink, onInfo }: {
  html: string;
  allowRemote: boolean;
  showQuoted: boolean;
  theme: "light" | "dark";
  original: boolean;
  onLink: (href: string) => void;
  onInfo?: (info: { blocked: number; hasQuote: boolean; designed: boolean; appearance: Appearance }) => void;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(60);
  const clean = useMemo(() => sanitizeEmail(html, allowRemote, theme, original), [html, allowRemote, theme, original]);

  useEffect(() => {
    onInfo?.({ blocked: clean.blocked, hasQuote: clean.hasQuote, designed: clean.designed, appearance: clean.appearance });
  }, [clean, onInfo]);

  const srcDoc = useMemo(() => {
    const style = `<style>${BASE_CSS}${clean.appearance === "dark" ? DARK_CSS : ""}</style>`;
    return clean.html.includes("<head>") ? clean.html.replace("<head>", `<head>${style}`) : style + clean.html;
  }, [clean]);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | null = null;
    const onLoad = () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      doc.body.classList.toggle("show-quoted", showQuoted);
      const measure = () => setHeight(Math.max(40, doc.documentElement.scrollHeight));
      measure();
      observer = new ResizeObserver(measure);
      observer.observe(doc.body);
      doc.addEventListener("click", (e) => {
        const a = (e.target as Element).closest?.("a");
        const href = a?.getAttribute("href");
        if (!href) return;
        e.preventDefault();
        if (!href.startsWith("#")) onLink(href);
      });
    };
    frame.addEventListener("load", onLoad);
    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [srcDoc, onLink, showQuoted]);

  useEffect(() => {
    const doc = ref.current?.contentDocument;
    if (doc?.body) {
      doc.body.classList.toggle("show-quoted", showQuoted);
      setHeight(Math.max(40, doc.documentElement.scrollHeight));
    }
  }, [showQuoted]);

  return (
    <iframe
      ref={ref}
      title="Message"
      className={`email-frame ${clean.appearance}`}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      style={{ height }}
    />
  );
}
