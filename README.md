# Chaucer

A Mac desktop client for Gmail, modelled feature-for-feature on the Android Gmail app
(v2026.10.19) and built on the **public Gmail API**. Tauri v2 (Rust) + React + TypeScript.

Not affiliated with Google. App icon artwork generated with Nano Banana 2.1 (via fal) and shaped with `scripts/spec/make-icon.sh`. No Google code or assets are shipped: the APK was only used as a
spec — see [docs/feature-inventory.md](docs/feature-inventory.md) (also the test checklist) and
[docs/design-tokens.md](docs/design-tokens.md).

## Install (unsigned build)

1. Download `Chaucer_*.dmg` from the latest GitHub Actions run (**Actions → Build macOS →
   Chaucer-dmg**) or a draft release.
2. Open the dmg and drag Chaucer to Applications.
3. First launch: macOS blocks apps without an Apple Developer ID. Open **System Settings → Privacy &
   Security**, click **Open Anyway** next to Chaucer, and confirm — or run
   `xattr -dr com.apple.quarantine /Applications/Chaucer.app` once.
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
