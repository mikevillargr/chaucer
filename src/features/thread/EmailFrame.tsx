import DOMPurify from "dompurify";
import { useEffect, useMemo, useRef, useState } from "react";

const BASE_CSS = `
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; color: #1f1f1f;
         word-wrap: break-word; overflow-wrap: anywhere; padding: 4px 2px; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  pre { white-space: pre-wrap; }
  a { color: #0b57d0; }
  blockquote { margin: 0 0 0 .8ex; border-left: 1px solid #ccc; padding-left: 1ex; }
  body:not(.show-quoted) .gmail_quote, body:not(.show-quoted) blockquote[type="cite"],
  body:not(.show-quoted) #divRplyFwdMsg, body:not(.show-quoted) #divRplyFwdMsg ~ *,
  body:not(.show-quoted) .yahoo_quoted, body:not(.show-quoted) #appendonsend ~ * { display: none !important; }
`;

const QUOTE_SELECTOR = '.gmail_quote, blockquote[type="cite"], #divRplyFwdMsg, .yahoo_quoted, #appendonsend';
const REMOTE_URL = /url\(\s*(['"]?)(https?:)?\/\/[^)]*\)/gi;
const HAS_REMOTE_URL = /url\(\s*['"]?(https?:)?\/\//i;

export interface Sanitized {
  html: string;
  blocked: number;
  hasQuote: boolean;
}

/** Strips active content; optionally blocks remote images (tracking pixels) until allowed. */
export function sanitizeEmail(html: string, allowRemote: boolean): Sanitized {
  let blocked = 0;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    const el = node as Element;
    if (el.tagName === "A") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }
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
    if (!allowRemote) {
      out = out.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (_m, attrs, css: string) => {
        const cleaned = css.replace(REMOTE_URL, () => (blocked++, "none")).replace(/@import[^;]+;/gi, "");
        return `<style${attrs}>${cleaned}</style>`;
      });
    }
    const hasQuote = new DOMParser().parseFromString(out, "text/html").querySelector(QUOTE_SELECTOR) !== null;
    return { html: out, blocked, hasQuote };
  } finally {
    DOMPurify.removeHook("afterSanitizeAttributes");
  }
}

export function EmailFrame({ html, allowRemote, showQuoted, onLink, onInfo }: {
  html: string;
  allowRemote: boolean;
  showQuoted: boolean;
  onLink: (href: string) => void;
  onInfo?: (info: { blocked: number; hasQuote: boolean }) => void;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(60);
  const clean = useMemo(() => sanitizeEmail(html, allowRemote), [html, allowRemote]);

  useEffect(() => {
    onInfo?.({ blocked: clean.blocked, hasQuote: clean.hasQuote });
  }, [clean, onInfo]);

  const srcDoc = useMemo(() => {
    const style = `<style>${BASE_CSS}</style>`;
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
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      style={{ height }}
    />
  );
}
