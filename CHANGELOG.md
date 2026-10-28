# Changelog

All notable changes to Chaucer. Versions follow [Semantic Versioning](https://semver.org):
**MAJOR** for breaking changes (data migrations that can't be undone, dropped features),
**MINOR** for new features, **PATCH** for fixes. Each GitHub release uses its section below as
its release notes (see [docs/RELEASING.md](https://github.com/mikevillargr/chaucer/blob/main/docs/RELEASING.md)).

## [1.0.0] - 2026-10-28

The first release of Chaucer: a Mac desktop client for Gmail, modelled feature-for-feature on
the Android Gmail app and built on the public Gmail API.

### Mail
- Multiple Google accounts (personal and Workspace) with a unified **All inboxes** view.
- Inbox category filters (Primary, Promotions, Social, Updates, Forums) and inbox types
  (Default, Important first, Unread first, Starred first).
- Threaded conversations with older messages collapsed, safe HTML rendering in a sandboxed
  frame, remote images blocked until you allow them, and quoted text trimmed.
- Attachments: preview images and PDFs, open in the default app, save anywhere.
- Archive, delete, spam, star, important, read/unread, labels and move, multi-select, and
  **Undo** for every action.
- One-click unsubscribe (`List-Unsubscribe`, including RFC 8058 one-click) and block sender.
- Gmail search syntax with recent searches, plus offline search of saved mail.

### Compose
- New, reply, reply all and forward, with the right recipients, threading headers and quoting.
- Drafts that autosave and sync with Gmail; send-as aliases and their signatures.
- Contact autocomplete from your Google contacts and people you've emailed.
- Rich text, links, attachments by picker or drag-and-drop, and pasted inline images.

### Settings
- Labels (create, nest, colour, hide), filters, vacation responder, per-account notifications.
- Theme (system, light, dark), list density, auto-advance, external images, confirmations.

### Smart features (bring your own key)
- Smart Reply suggestions, thread summaries and **Help me write**, using Anthropic, OpenAI,
  Gemini or any OpenAI-compatible endpoint. Keys are stored in the macOS Keychain; everything
  is off until you choose a provider.

### Mac
- Native notifications for new mail, unread count on the Dock icon, `mailto:` links, Gmail
  keyboard shortcuts (press `?`), and print.
- Design based on the Growth Rocket design system: Sora, Geist and Geist Mono type, orange as
  the single accent, light and dark themes. New pen-nib app icon.
- Universal build for Apple Silicon and Intel; ad-hoc signed (not notarized).

### Under the hood
- Requests are paced per account to stay under Gmail's per-user quota, with automatic
  back-off and retry on rate limits.
- Local SQLite cache with full-text search; refresh tokens and API keys in the Keychain.
- Data saved under the app's earlier working name (Letterbox) moves over automatically.

### Known limitations
- Not available because Gmail's public API doesn't support them: undo send, schedule send,
  snooze, nudges, mute, confidential mode. Chat, Spaces and Meet are not included.
- The app isn't notarized: approve it once in System Settings → Privacy & Security.
- You need your own Google Cloud OAuth client; see [docs/google-setup.md](https://github.com/mikevillargr/chaucer/blob/main/docs/google-setup.md).

[1.0.0]: https://github.com/mikevillargr/chaucer/releases/tag/v1.0.0
