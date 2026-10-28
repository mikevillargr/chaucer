// Colour parsing and WCAG contrast, used to make email text legible in dark mode.

export type Rgb = [number, number, number];

const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", gray: "#808080", grey: "#808080", silver: "#c0c0c0",
  red: "#ff0000", maroon: "#800000", green: "#008000", navy: "#000080", blue: "#0000ff",
  purple: "#800080", teal: "#008080", olive: "#808000", darkgray: "#a9a9a9", dimgray: "#696969",
};

export function parseColor(input: string): Rgb | null {
  const c = input.trim().toLowerCase().replace(/\s*!important$/, "");
  const hex = (NAMED[c] ?? c).match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
  }
  const rgb = c.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (rgb) {
    if (rgb[4] !== undefined && parseFloat(rgb[4]) === 0) return null; // fully transparent
    return [+rgb[1], +rgb[2], +rgb[3]];
  }
  return null;
}

export function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const toHex = (c: Rgb) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** Lightens a text colour toward white just enough to read on `bg` (keeps its hue). */
export function legibleOn(color: Rgb, bg: Rgb, min = 4.5): string {
  if (contrast(color, bg) >= min) return toHex(color);
  for (let t = 0.1; t <= 1; t += 0.05) {
    const mixed = color.map((v) => v + (255 - v) * t) as Rgb;
    if (contrast(mixed, bg) >= min) return toHex(mixed);
  }
  return "#ffffff";
}

/** Near-white backgrounds (what most plain emails set) count as "no background". */
export const isLightBackground = (c: Rgb) => luminance(c) > 0.85;

function hslToRgb(h: number, s: number, l: number): Rgb {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

/** A muted avatar colour for `hue` dark enough that white initials pass WCAG AA. */
export function avatarBackground(hue: number): string {
  for (let l = 0.42; l > 0.15; l -= 0.02) {
    const c = hslToRgb(hue, 0.32, l);
    if (contrast(c, [255, 255, 255]) >= 4.6) return toHex(c);
  }
  return "#3c4f5e";
}

/** Keeps a label's own background but swaps its text to black or white when it would be unreadable. */
export function readableOn(bg: string, preferred?: string | null): string {
  const b = parseColor(bg);
  if (!b) return preferred ?? "#000000";
  const p = preferred ? parseColor(preferred) : null;
  if (p && contrast(p, b) >= 4.5) return preferred!;
  return contrast([255, 255, 255], b) >= contrast([0, 0, 0], b) ? "#ffffff" : "#000000";
}

/**
 * Text colour for an email shown in dark mode: neutral greys map onto the app's own text
 * tones (dark → primary, mid → muted) so body copy reads like the rest of Chaucer; coloured
 * text keeps its hue and is lightened just enough to pass on `bg`.
 */
export function darkModeText(c: Rgb, bg: Rgb): string {
  const neutral = Math.max(...c) - Math.min(...c) < 40;
  if (neutral) {
    const l = luminance(c);
    if (l < 0.12) return "#e9eef3";
    if (l < 0.4) return "#b4c2cd";
  }
  return legibleOn(c, bg);
}
