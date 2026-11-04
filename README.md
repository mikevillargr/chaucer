# Chaucer

A desktop client for Gmail, for macOS and Windows. Chaucer follows the Android Gmail app feature for feature —
multiple accounts, inbox categories, threaded conversations, labels, filters, search, drafts,
aliases and signatures — on the **public Gmail API**, with offline search, native notifications
and bring-your-own-key AI (Smart Reply, summaries, Help me write). Built with Tauri v2 (Rust) +
React + TypeScript; styled on the Growth Rocket design system.

**Download:** the latest `.dmg` (macOS, universal: Apple Silicon and Intel) and `-setup.exe` (Windows 10/11,
64-bit) are on the [Releases page](https://github.com/mikevillargr/chaucer/releases/latest).
After the first install, Chaucer updates itself.
What changed in each version: [CHANGELOG.md](CHANGELOG.md).

Not affiliated with Google. No Google code or assets are shipped: the Android APK was only used
as a spec — see [docs/feature-inventory.md](docs/feature-inventory.md) (also the test checklist)
and [docs/design-tokens.md](docs/design-tokens.md). App icon artwork generated with Nano Banana 2.1
(via fal) and shaped with `scripts/spec/make-icon.sh`.

## Install

### macOS

1. Download `Chaucer_X.Y.Z_universal.dmg` from [Releases](https://github.com/mikevillargr/chaucer/releases/latest).
2. Open the dmg and drag Chaucer to Applications.
3. First launch: macOS blocks apps without an Apple Developer ID. Open **System Settings → Privacy &
   Security**, click **Open Anyway** next to Chaucer, and confirm — or run
   `xattr -dr com.apple.quarantine /Applications/Chaucer.app` once.
4. Follow [docs/google-setup.md](docs/google-setup.md) to connect your own Google Cloud OAuth client.

### Windows

1. Download `Chaucer_X.Y.Z_x64-setup.exe` from [Releases](https://github.com/mikevillargr/chaucer/releases/latest).
2. Run it. It installs for your user only (no administrator rights needed) and adds a Start menu entry.
3. First launch: the installer is not code-signed, so Windows SmartScreen may say "Windows protected
   your PC". Click **More info → Run anyway**.
4. Follow [docs/google-setup.md](docs/google-setup.md) to connect your own Google Cloud OAuth client.

Needs the Microsoft Edge WebView2 runtime, which is already part of Windows 11 and current Windows 10.

## Layout

| Path | What |
| --- | --- |
| `src-tauri/src/auth.rs` | OAuth PKCE via system browser + loopback; token refresh |
| `src-tauri/src/gmail.rs` | Gmail API v1 / People API client |
| `src-tauri/src/sync.rs` | First sync, `history.list` polling, notifications, dock badge / taskbar dot |
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

On Windows, develop natively (no containers): install Rust (MSVC toolchain), the Visual Studio Build
Tools "Desktop development with C++" workload and Node, then `npm ci`, `npm run tauri dev` /
`npm run tauri build`. `src-tauri/tauri.windows.conf.json` is merged over `tauri.conf.json` there
(NSIS installer, frameless window with our own title bar). In a browser preview, add
`?platform=windows` to the URL to see the Windows layout.

Pull requests and `main` are tested on Linux and Windows by `.github/workflows/ci.yml`. The macOS
`.dmg` and the Windows installer are built only for release tags by `.github/workflows/release.yml`; changes are batched into releases
(semver, see [docs/RELEASING.md](docs/RELEASING.md)). Agents: start with [AGENTS.md](AGENTS.md).

## Scope

In: everything in the inventory that the public API supports. Out (no public API, or excluded to
keep it simple): undo send, schedule send, snooze, nudges, mute, confidential mode, Chat/Meet,
Linux.
