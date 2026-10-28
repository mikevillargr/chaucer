# Changelog

All notable changes to Chaucer. Versions follow [Semantic Versioning](https://semver.org):
**MAJOR** for breaking changes (data migrations that can't be undone, dropped features),
**MINOR** for new features, **PATCH** for fixes. Each GitHub release uses its section below as
its release notes (see [docs/RELEASING.md](https://github.com/mikevillargr/chaucer/blob/main/docs/RELEASING.md)).

## [1.5.0] - 2026-10-28

### Settings
- **Three new themes.** Pick **Kinetic**, **Terminal Green** or **Terminal White** under
  Settings → General → Theme. Kinetic is black with white hairlines, square corners and a
  single mono typeface, with green for actions. The two Terminal themes are a 1980s green-screen
  and a white-phosphor display, with double-line borders, inverse-video selection, scanlines and
  stepped animation. All three are dark-only, and emails are shown in dark colours with the
  usual "Original colours" toggle.

### Smart features
- **Summarize shows progress.** The button now shows a spinner and "Summarizing…" while it
  works, can't be double-clicked, and reads "Summarize again" afterwards.

### Fixes
- Buttons now react to hover, press and keyboard focus consistently.

## [1.4.0] - 2026-10-28

### Smart features
- **Moonshot (Kimi) provider.** Add Kimi under Settings → Smart features. Regular Moonshot keys
  use the international API; Kimi Code keys (`sk-kimi-…`) are routed to the Kimi Code endpoint
  automatically, with the model `kimi-for-coding`. Kimi's reasoning no longer leaves replies empty.

### Layout
- **Smoother reading pane on Mac.** Opening a conversation now slides the reader in without
  the stutter, and the conversation list no longer re-animates every row. Closing the reader
  no longer animates.

## [1.3.0] - 2026-10-28

### Compose
- **@mentions.** Type `@` or `+` and a name in the body of an email to pick a contact, like
  in Gmail. The person is inserted as a highlighted mention (a link to their address in the
  sent email) and added to **To** if they aren't already a recipient. Use ↑/↓ and Enter or
  Tab to choose, Escape to dismiss. Typing an email address doesn't open the menu.

## [1.2.0] - 2026-10-28

### Layout
- **Resizable panes.** Drag the divider beside the sidebar or the conversation list to resize
  it; double-click a divider to reset. Chaucer remembers your widths and always leaves room
  for the reading pane. Dividers also work from the keyboard (focus, then ←/→).

### Motion
- The reading pane slides in and out when you open or close a conversation.
- Menus, dialogs, compose windows, toasts, search suggestions and expanding messages now
  ease in instead of appearing abruptly. Everything stays quick (under a quarter second),
  and all motion switches off when macOS **Reduce motion** is on.

### Dark mode
- **Email bodies now follow dark mode.** Ordinary emails are shown in dark colours, with
  hard-coded dark text recoloured to stay readable. Designed emails (newsletters, receipts)
  keep the sender's colours on a light card so they aren't broken. A **Dark / Original
  colours** switch on each message lets you choose.

### Readability
- The selected inbox category is now navy (azure in dark mode), so it no longer competes with
  the orange **Compose** button.
- Every screen was checked for colour contrast (WCAG AA) in light and dark mode. Fixed: avatar
  initials on some colours, label chips using Gmail colours with low contrast, the drop-files
  hint in compose, and the All inboxes icon in dark mode.

## [1.1.0] - 2026-10-28

### In-app updates
- Chaucer now updates itself. It checks for a new release shortly after launch and every few
  hours; when one is available, a card at the bottom of the sidebar shows the version and
  **What's new**. Click **Restart to update** and Chaucer downloads, verifies and installs it,
  then relaunches. No more downloading DMGs.
- Every update is signed, and Chaucer refuses to install anything whose signature doesn't match.
- **Settings → General** shows the installed version and a **Check for updates** button.
- Updates installed this way don't trigger the macOS "could not verify" warning.

### Fixes
- Trackpad and mouse-wheel scrolling now works in the conversation list and the reading pane.

### Note
- Version 1.0.0 can't update itself: install 1.1.0 from the DMG once. Later versions arrive
  automatically. After an update, macOS may ask to let Chaucer use the Keychain: choose
  **Always Allow**.

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

[1.5.0]: https://github.com/mikevillargr/chaucer/releases/tag/v1.5.0
[1.4.0]: https://github.com/mikevillargr/chaucer/releases/tag/v1.4.0
[1.3.0]: https://github.com/mikevillargr/chaucer/releases/tag/v1.3.0
[1.2.0]: https://github.com/mikevillargr/chaucer/releases/tag/v1.2.0
[1.1.0]: https://github.com/mikevillargr/chaucer/releases/tag/v1.1.0
[1.0.0]: https://github.com/mikevillargr/chaucer/releases/tag/v1.0.0
