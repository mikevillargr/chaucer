# Design tokens

Chaucer's look is built on the **Growth Rocket Design System** (the reference bundle lives
locally in `design/gr-design-system/`, which is git-ignored: it's Growth Rocket's internal
library, not part of this repo). Values below are implemented in `src/styles/tokens.css`.
Layout and behaviour still follow the Android Gmail app (see `feature-inventory.md`).

## Colour roles

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--accent` | `#f58d49` | `#f58d49` | The one accent: the single primary button per view (Compose, Send), unread dots, stars, focus rings, selected-row marker, active category chip. Never a large fill. |
| `--navy` | `#00233b` | — | Brand surfaces: compose window header, toasts, "ink" buttons |
| `--on-surface` | `#0a1b28` (ink) | `#e9eef3` (star) | Body text |
| `--on-surface-variant` | `#3c4f5e` | `#b4c2cd` | Muted text (GR spec) |
| `--surface` | `#ffffff` | `#071622` (space-1) | Content panes |
| `--surface-container-low` | `#f3f5f7` (paper) | `#040c14` (space-0) | Window chrome |
| `--outline-variant` | `rgba(10,27,40,.14)` | `rgba(233,238,243,.12)` | Hairlines (GR spec) |
| `--primary` | `#00233b` | `#62d7de` (azure) | Links, selection tint; azure appears only in dark mode |

## Type

| Role | Font | Notes |
| --- | --- | --- |
| Headings (thread subject, settings, dialogs) | Sora 650 | letter-spacing −0.02 to −0.04em |
| Interface and body | Geist | 13–14px in the app (the website uses 17px) |
| Labels, timestamps, counts | Geist Mono | uppercase + 0.12–0.14em tracking for labels |

Fonts ship in `src/assets/fonts/` (SIL OFL 1.1, see the LICENSE there). Message bodies keep the
sender's own fonts inside the sandboxed frame.

## Shape, depth, motion

- Pills (999px) for buttons, chips, search and toasts; 22px card radius for dialogs and cards; 10px nav items.
- Card shadow `0 30px 50px -40px rgba(0,35,59,.5)`; floating layers use `--shadow-3`.
- Easing `cubic-bezier(.16,1,.3,1)`; primary buttons lift 1px with an orange glow on hover.
- Signature details: GR **Eyebrow** labels (mono caps with a short orange rule) for section headings, GR
  **filter chips** for inbox categories, and the GR **grid-paper** texture on empty states only.

## Icons

Material Symbols Rounded (Apache 2.0). App icon: `assets/icon.png` (pen nib forming an envelope).
