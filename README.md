# Letterbox

A Mac desktop client for Gmail, modelled feature-for-feature on the Android Gmail app
(v2026.10.19) and built on the **public Gmail API**. Tauri v2 (Rust) + React + TypeScript.

Not affiliated with Google. No Google code or assets are shipped: the APK was only used as a
spec — see [docs/feature-inventory.md](docs/feature-inventory.md) (also the test checklist) and
[docs/design-tokens.md](docs/design-tokens.md).

## Install (unsigned build)

1. Download `Letterbox_*.dmg` from the latest GitHub Actions run (**Actions → Build macOS →
   Letterbox-dmg**) or a draft release.
2. Open the dmg and drag Letterbox to Applications.
3. First launch: **right-click Letterbox → Open → Open** (the app isn't signed with an Apple
   Developer ID yet). If macOS still refuses: System Settings → Privacy & Security → *Open Anyway*.
4. Follow [docs/google-setup.md](docs/google-setup.md) to connect your Google Cloud OAuth client.

## Layout

| Path | What |
| --- | --- |
| `src-tauri/src/auth.rs` | OAuth PKCE via system browser + loopback; token refresh |
| `src-tauri/src/gmail.rs` | Gmail API v1 / People API client |
| `src-tauri/src/sync.rs` | First sync, `history.list` polling, notifications, dock badge |
| `src-tauri/src/db.rs` | SQLite cache + FTS5 offline search |
| `src-tauri/src/parse.rs`, `mime.rs` | MIME tree → model; outgoing message builder |
| `src-tauri/src/llm.rs` | Bring-your-own-key providers for smart features |
| `src-tauri/src/commands.rs` | Every command the UI can call (mirrors `src/lib/ipc.ts`) |
| `src/` | React UI; `src/lib/ipc.mock.ts` is an in-memory backend for browser previews |

## Develop

Everything runs in containers on the VPS (`scripts/dev/compose.sh` wraps `compose.dev.yml`):

```sh
scripts/dev/compose.sh up -d dev                       # UI preview with mock data on :3010
scripts/dev/compose.sh run --rm dev npm test           # frontend tests
scripts/dev/compose.sh run --rm -w /app/src-tauri dev cargo test
```

The macOS `.dmg` is built by `.github/workflows/build-macos.yml` (universal binary) on every push
to `main`; pushing a `v*` tag also creates a draft release.

## Scope

In: everything in the inventory that the public API supports. Out (no public API, or excluded to
keep it simple): undo send, schedule send, snooze, nudges, mute, confidential mode, Chat/Meet,
Windows/Linux.
