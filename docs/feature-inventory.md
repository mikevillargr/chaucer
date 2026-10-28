# Feature inventory

Spec source: Android Gmail v2026.10.19 (`com.google.android.gm`, version code 66123439),
mined from its resource strings (`apk/base-strings.tsv`, string keys quoted below). Only
features the **public** Gmail / People APIs support are in scope. This file doubles as the
parity checklist for testing on the Mac.

Legend: `[ ]` to do · `[x]` done · API = Gmail API v1 unless noted.

## Accounts
- [ ] Add Google account (OAuth PKCE, system browser) — `Add another email account`
- [ ] Multiple accounts, account switcher, unified "All inboxes"
- [ ] Remove account (revoke token, clear cache)

## Mailbox / thread list
- [ ] Inbox category tabs Primary/Social/Promotions/Updates/Forums — `MSG_INBOX_CATEGORIES_TITLE` → labels `CATEGORY_*`
- [ ] Inbox type: Default, Important first, Unread first, Starred first — `MSG_INBOX_TYPE_*` → sections built from `q=is:important|is:unread|is:starred`
- [ ] System labels: Starred, Important, Sent, Drafts, All mail, Spam, Trash → `labelIds`
- [ ] User labels with colours and nesting (`a/b` names) → `users.labels.list`
- [ ] Unread counts per label → `labels.get` (`threadsUnread`)
- [ ] List density Default / Comfortable / Compact — `density_option_*`
- [ ] Refresh — `gmail_shortcut_refresh…` → `history.list` incremental sync
- [ ] Bulk select + select all — `gmail_shortcut_select_all`

## Reading
- [ ] Conversation view (threads grouped like Gmail) → `threads.get`
- [ ] Safe HTML rendering, quoted text collapsed — `show_elided`
- [ ] External images: Ask before displaying / Always display — `MSG_IMAGES_*`
- [ ] Attachments: preview images/PDF, download, save as → `messages.attachments.get`
- [ ] Auto-advance after archive/delete: newer / older / list — `Auto-advance`
- [ ] Unsubscribe via `List-Unsubscribe` header (mailto or RFC 8058 one-click) — `MSG_UNSUBSCRIBE_LABEL`
- [ ] Print — `gmail_shortcut_print`

## Actions (thread and bulk)
- [ ] Archive — `archive` → `threads.modify` remove `INBOX`
- [ ] Delete → `threads.trash`; restore from Trash → `threads.untrash`
- [ ] Report spam / not spam — `MSG_REPORT_SPAM` → add/remove `SPAM`
- [ ] Star / unstar — `add_star` → `STARRED`
- [ ] Mark important / not important — `mark_important` → `IMPORTANT`
- [ ] Mark read / unread — `MSG_MARK_AS_UNREAD_ACTION` → `UNREAD`
- [ ] Move to / change labels → `threads.modify`
- [ ] Block sender → `settings.filters.create` (from → trash)
- [ ] Confirm before archiving / deleting / sending — `Confirm before …`
- [ ] Undo last action (re-apply inverse `modify`; not undo-send) — `gmail_shortcut_undo…`

## Compose
- [ ] New, reply, reply all, forward; default reply action — `default_reply_action_*`
- [ ] Rich text (bold/italic/lists/links), inline images, attachments (drag-drop)
- [ ] @mentions in the body (`@` or `+`), adding the person to To
- [ ] To/Cc/Bcc with contact autocomplete → People API `otherContacts` + `connections`
- [ ] From: send-as aliases → `settings.sendAs.list`
- [ ] Signature per alias → `sendAs.signature` (desktop equivalent of `MSG_MOBILE_SIGNATURE_TITLE`)
- [ ] Drafts autosave + sync → `drafts.create/update/send`
- [ ] Discard draft — `Discard unsaved changes?`
- [ ] Send → `messages.send` (threaded with `threadId`, `In-Reply-To`, `References`)

## Search
- [ ] Search bar with Gmail operators (`from:`, `has:attachment`, `before:` …) — `ag_search_hint` → `threads.list?q=`
- [ ] Recent searches + Clear search history — `Clear search history` (local)
- [ ] Offline search of cached mail (SQLite FTS5)

## Settings
- [ ] Theme: system / light / dark — `Dark`
- [ ] Vacation responder — `MSG_VACATION_RESPONDER_*` → `settings.updateVacation`
- [ ] Filters list / create / delete → `settings.filters`
- [ ] Manage labels — `MSG_MANAGE_LABELS_TITLE` → `labels.create/patch/delete`
- [ ] Notifications per account — `Email notifications`

## Mac integration
- [ ] Native notifications for new Inbox mail (click opens thread)
- [ ] Dock badge with unread Inbox count
- [ ] Default mail app / `mailto:` handler
- [ ] Menu bar commands mirroring the shortcuts below

## Keyboard shortcuts (from `gmail_shortcut_*`, mapped to Gmail web keys)
`c` compose · `r` reply · `a` reply all · `f` forward · `e` archive · `#` delete ·
`!` spam · `s` star · `Shift+i` read · `Shift+u` unread · `j`/`k` next/prev ·
`Enter` open · `/` search · `z` undo · `⌘↩` send · `⌘S` save draft · `Esc` close compose ·
`⌘,` settings · `?` shortcut help · `⌘R` refresh · `⌘P` print · `⌘A` select all

## Smart features (BYOK — your LLM provider, not Google)
- [ ] Provider settings: Anthropic, OpenAI, Gemini, OpenAI-compatible base URL; key in Keychain
- [ ] Smart Reply chips — `smart_feature_…_smart_reply_mail`
- [ ] Thread summary — `smart_feature_…_smart_summaries_mail`
- [ ] Help me write / rewrite — `smart_draft_*`

## Out of scope (no public API, or excluded to keep it simple)
Mute (`MSG_MUTE_BUTTON_LABEL`), undo send, schedule send (`MSG_SCHEDULE_MESSAGE_BUTTON`), snooze (`MSG_LABEL_DISPLAY_NAME_FOR_SNOOZED`),
nudges, confidential mode, dynamic email (AMP), package tracking, AI Inbox, high-priority
notifications, swipe actions (touch-only), Chat, Spaces, Meet, Exchange/IMAP accounts,
offline action queue, Windows/Linux builds. Deferred for simplicity: turning conversation view off,
per-label notifications, configurable days of mail to sync.
