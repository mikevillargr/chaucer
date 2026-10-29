# AGENTS.md: Chaucer

Guidance for agents working on this repo. Environment-specific details (server addresses,
SSH, preview URLs, key backup locations) are in `AGENTS.local.md`, which is git-ignored; read
it if it exists. This repo is **public**: never commit secrets, keys, IP addresses, pairing
links, the Android APK, or the Growth Rocket design-system bundle.

## What Chaucer is

A Mac desktop client for Gmail that follows the Android Gmail app feature for feature, built
with Tauri v2 (Rust core) + React/TypeScript, talking to the **public Gmail API** with the
user's own Google OAuth client. Distributed as an ad-hoc signed universal `.dmg` on GitHub
Releases; installed copies update themselves.

## Working agreement

These are the owner's standing instructions. Follow them unless told otherwise.

- **Batch work, don't build every change.** Work on a branch, commit as you go, open a pull
  request, and stop there. CI on the PR runs tests on Linux only. Do **not** tag, build a dmg,
  or release unless the owner says the batch is a release candidate (or agrees to your
  proposal that it is). Never push feature work straight to `main`.
- **Releases use semver with user-facing release notes** in `CHANGELOG.md`
  (MINOR for features, PATCH for fixes, MAJOR for breaking changes). See *Releases* below.
- **Design follows Gmail's layout and behaviour**, styled with the Growth Rocket design system
  (`docs/design-tokens.md`): orange `#f58d49` is the single accent, used for the one primary
  action per view (Compose, Send) and attention marks; never as a selected state or large fill.
- **Scope rule:** if the public Gmail API can't support a feature, leave it out rather than
  emulate it (that's why there is no undo send, schedule send, snooze, nudges, mute or
  confidential mode).
- **Verify before reporting done:** typecheck, unit tests, and the browser checks below for
  anything visible. Report failures plainly.
- **Ask before outward-facing or irreversible actions:** writing repository secrets, deleting
  or moving tags, deleting releases, changing repo visibility, or anything on the owner's Mac.
  The safety classifier blocks these without explicit approval anyway.
- The owner prefers scoped permission allow-rules over repeated prompts for tools they've
  already approved.

## Architecture

| Path | What |
| --- | --- |
| `src-tauri/src/auth.rs` | OAuth 2.0 PKCE via the system browser and a loopback redirect; access-token refresh |
| `src-tauri/src/gmail.rs` | Gmail API v1 + People API client; per-account quota limiter; rate-limit retries |
| `src-tauri/src/sync.rs` | First sync, `history.list` polling (30s and on wake), notifications, dock badge |
| `src-tauri/src/db.rs` | SQLite cache, label index, FTS5 offline search, contacts |
| `src-tauri/src/parse.rs`, `mime.rs` | MIME part tree → model (charsets, inline images); outgoing message builder |
| `src-tauri/src/llm.rs` | Bring-your-own-key AI providers (Anthropic, OpenAI, Gemini, OpenAI-compatible) |
| `src-tauri/src/commands.rs` | Every command the UI can call; keep in sync with `src/lib/ipc.ts` |
| `src-tauri/src/secrets.rs` | macOS Keychain (refresh tokens, AI keys); migrates the old "Letterbox" service name |
| `src/lib/ipc.ts`, `ipc.mock.ts` | Typed command layer; the mock is an in-memory backend for the browser preview and tests |
| `src/lib/queries.ts`, `store.ts` | React Query data hooks, optimistic updates + Undo; Zustand UI state |
| `src/features/…` | mailbox, thread (reader, `EmailFrame` sanitiser), compose (incl. @mentions), settings, updates |
| `src/styles/tokens.css`, `app.css` | Design tokens and all component styles (plain CSS, no framework) |
| `.github/workflows/ci.yml` | Tests on Linux for PRs and `main` |
| `.github/workflows/release.yml` | macOS universal build + signed update feed, version tags only |

Secrets never cross into the webview: tokens and API keys stay in Rust and the Keychain.

## Development

Everything runs in containers on the dev server through `scripts/dev/compose.sh` (a wrapper
around `compose.dev.yml`). Don't install dependencies or run builds in the agent container.

```sh
scripts/dev/compose.sh up -d dev                                   # UI preview, mock data, port 3010
scripts/dev/compose.sh run --rm --no-deps dev npm run typecheck
scripts/dev/compose.sh run --rm --no-deps dev npx vitest run
scripts/dev/compose.sh run --rm --no-deps -w /app/src-tauri dev cargo test
```

macOS apps can't be built on Linux. The dmg is built only by `release.yml` on GitHub's macOS
runners (or locally on a Mac with `npm run tauri build`).

### Browser checks (Playwright container, against the preview)

Run them with the Playwright image (`mcr.microsoft.com/playwright:v1.56.0-noble`); copy the
script into `/tmp` inside the container first, because ESM resolves `playwright` relative to the
script's own folder.

| Script | Checks |
| --- | --- |
| `scripts/dev/scroll-test.mjs` | List and reader panes scroll in a short window |
| `scripts/dev/contrast-audit.mjs` | axe WCAG AA colour contrast in light and dark, plus a pane-resize drag (needs `@axe-core/playwright`) |
| `scripts/dev/mention-test.mjs` | @/+ mentions: menu, insert, adds to To, Escape, no trigger inside email addresses |
| `scripts/dev/swipe-test.mjs` | Trackpad swipe on rows: follows fingers, springs back below threshold, ignores vertical scroll, commits archive on release |
| `scripts/dev/screenshots.mjs` | Screenshots of inbox, reader, compose, settings, dark mode |

The mock (`src/lib/ipc.mock.ts`) includes test fixtures: a simple email with hard-coded dark
text and a designed newsletter (for dark-mode rendering).

## Releases

Full steps are in `docs/RELEASING.md`. In short, once the owner calls a release candidate:

1. Merge the PR; CI must be green on `main`.
2. Add `## [X.Y.Z] - date` to `CHANGELOG.md` and bump the version in `package.json`,
   `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`; refresh both lockfiles.
   **Verify all five versions and the changelog section before committing.** Do these as
   separate, checked steps, never one long `;`-chained command (a failed step once let a
   release tag go out without its version bump).
3. Commit `Release vX.Y.Z`, tag, push. `release.yml` refuses a tag that doesn't match the
   manifests or has no changelog section, and fails if the updater signing key is missing.
4. Before publishing the draft: check the dmg and update archive are named `X.Y.Z`, and that
   `latest.json` reports `X.Y.Z` and is signed by the key ID in `tauri.conf.json`. Publish, mark
   **Latest**, then confirm `releases/latest/download/latest.json` serves the new version.
   Don't request asset URLs while the release is a draft: GitHub caches the 404 for minutes.

The updater private key and password are the repo secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; a backup lives outside the repo (see `AGENTS.local.md`).
Losing it means installed copies can't update until users hand-install a release with a new key.

## Lessons learned

- **Layout:** the main grid needs `grid-template-rows: minmax(0, 1fr)` and `min-height: 0` on
  panes, or panes grow to their content and nothing scrolls.
- **Gmail quota** is 15,000 units per user per minute (thread get = 10, send = 100). All
  requests for an account share one token bucket (`gmail::Limiter`, 12k/min); 403s with
  `rateLimitExceeded` / "Quota exceeded" are retried with back-off.
- **Email rendering:** bodies are sanitised (DOMPurify) and shown in an iframe sandboxed
  *without* scripts; links are intercepted and opened in the browser. Remote images are blocked
  until allowed. In dark mode, simple emails are recoloured (`lib/color.ts`), designed ones keep
  their colours on a white card, with a per-message toggle.
- **Accessibility tooling:** axe can hang on the script-less email frames once other UI is
  layered on top; exclude `iframe` in later checks and keep a hard timeout.
- **WKWebView** (the macOS webview) has no `window.prompt`; build inline UI instead.
- **Motion:** with View Transitions, don't also give the transitioning element a mount
  animation (it slides twice). Respect `prefers-reduced-motion`.
- **TipTap:** keys the editor consumes (e.g. Escape closing the mention menu) arrive at React
  handlers with `defaultPrevented`; check that instead of tracking menu state.
- **Crates:** `keyring` is pinned to v3 (v4 changed the API); `reqwest` 0.13 names its TLS feature
  `rustls`.
- **CI:** macOS runners queue, sometimes for many minutes, and occasionally never start a job
  (re-run it). `hdiutil` sometimes fails with "Resource busy"; the build step retries.
- **Signing:** builds are ad-hoc signed, not notarized. Manual installs need *Open Anyway*;
  in-app updates don't, but macOS may ask to allow Keychain access after each update.
- **Shell:** `node -e '…'` inside single quotes breaks on apostrophes in the embedded text.
  Write a temp script file or use the editor tool for edits containing prose.
- **Naming:** the app was called Letterbox before 1.0. Data and Keychain entries under the old
  identifier are migrated on first launch; keep that code until a MAJOR release.

## Docs

`README.md` (install, layout), `CHANGELOG.md`, `docs/RELEASING.md`, `docs/google-setup.md`
(the owner's OAuth client setup), `docs/design-tokens.md`, `docs/feature-inventory.md` (feature
spec from the Android app, doubles as the manual test checklist).
