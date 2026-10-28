// Mirrors src-tauri/src/model.rs (camelCase JSON).

export interface Account {
  id: string;
  email: string;
  displayName: string | null;
  needsReauth: boolean;
}

export interface Addr {
  name: string;
  email: string;
}

export interface Label {
  accountId: string;
  id: string;
  name: string;
  kind: "system" | "user";
  colorBg: string | null;
  colorText: string | null;
  threadsUnread: number;
  threadsTotal: number;
  hidden: boolean;
}

export interface ThreadSummary {
  accountId: string;
  id: string;
  historyId: string;
  subject: string;
  snippet: string;
  senders: Addr[];
  lastDate: number;
  unread: boolean;
  starred: boolean;
  important: boolean;
  labelIds: string[];
  messageCount: number;
  hasAttachments: boolean;
}

export interface Attachment {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId: string | null;
  inline: boolean;
}

export interface Message {
  id: string;
  threadId: string;
  labelIds: string[];
  date: number;
  from: Addr;
  to: Addr[];
  cc: Addr[];
  bcc: Addr[];
  replyTo: Addr[];
  subject: string;
  snippet: string;
  html: string | null;
  text: string | null;
  attachments: Attachment[];
  messageIdHeader: string | null;
  references: string | null;
  listUnsubscribe: string | null;
  listUnsubscribePost: string | null;
}

export interface ThreadDetail {
  summary: ThreadSummary;
  messages: Message[];
}

/** `next` holds [accountId, pageToken] pairs for the following page. */
export interface ThreadPage {
  threads: ThreadSummary[];
  next: [string, string][];
}

export interface ThreadRef {
  accountId: string;
  threadId: string;
}

export interface SendAs {
  sendAsEmail: string;
  displayName?: string;
  replyToAddress?: string;
  signature?: string;
  isPrimary?: boolean;
  isDefault?: boolean;
}

export type DraftAttachment =
  | { kind: "file"; path: string; filename: string; mimeType?: string }
  | { kind: "gmail"; messageId: string; attachmentId: string; filename: string; mimeType: string }
  | { kind: "inline"; data: string; filename: string; mimeType: string; contentId: string };

export interface Draft {
  accountId: string;
  draftId: string | null;
  threadId: string | null;
  from: Addr;
  to: Addr[];
  cc: Addr[];
  bcc: Addr[];
  subject: string;
  html: string;
  text: string;
  inReplyTo: string | null;
  references: string | null;
  attachments: DraftAttachment[];
}

export interface Provider {
  id: string;
  name: string;
  kind: "anthropic" | "openai" | "gemini" | "moonshot" | "openai_compatible";
  baseUrl?: string | null;
  model: string;
}

export interface ProviderInfo extends Provider {
  hasKey: boolean;
}

export interface Filter {
  id: string;
  criteria: Record<string, unknown>;
  action: { addLabelIds?: string[]; removeLabelIds?: string[]; forward?: string };
}

export interface Vacation {
  enableAutoReply: boolean;
  responseSubject?: string;
  responseBodyHtml?: string;
  responseBodyPlainText?: string;
  restrictToContacts?: boolean;
  restrictToDomain?: boolean;
  startTime?: string;
  endTime?: string;
}

export interface Prefs {
  theme?: "system" | "light" | "dark" | "kinetic" | "terminal-green" | "terminal-white";
  density?: "default" | "comfortable" | "compact";
  conversationView?: boolean;
  externalImages?: "ask" | "always";
  autoAdvance?: "newer" | "older" | "list";
  defaultReply?: "reply" | "replyAll";
  confirmArchive?: boolean;
  confirmDelete?: boolean;
  confirmSend?: boolean;
  inboxType?: "default" | "important" | "unread" | "starred";
  categoryTabs?: string[];
  notifyAccounts?: Record<string, boolean>;
  llmFeatures?: { smartReply?: string; summary?: string; write?: string };
  [key: string]: unknown;
}
