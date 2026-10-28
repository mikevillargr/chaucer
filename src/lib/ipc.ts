// Typed wrapper over the Rust commands in src-tauri/src/commands.rs. In a plain browser
// (the VPS preview, `npm run dev:web`) calls go to an in-memory mock instead.
import type {
  Account, Addr, Draft, Filter, Label, Prefs, Provider, ProviderInfo, SendAs, ThreadDetail,
  ThreadPage, ThreadRef, ThreadSummary, Vacation,
} from "./types";

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type Listen = (event: string, cb: (payload: unknown) => void) => Promise<() => void>;

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let backend: Promise<{ invoke: Invoke; listen: Listen }> | null = null;

function load() {
  backend ??= (async () => {
    if (isTauri && !__MOCK__) {
      const core = await import("@tauri-apps/api/core");
      const ev = await import("@tauri-apps/api/event");
      return {
        invoke: core.invoke as Invoke,
        listen: (event: string, cb: (p: unknown) => void) => ev.listen(event, (e) => cb(e.payload)),
      };
    }
    const mock = await import("./ipc.mock");
    return { invoke: mock.invoke as Invoke, listen: mock.listen };
  })();
  return backend;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await load();
  return invoke<T>(cmd, args);
}

export async function on(event: "mail-changed" | "open-mailto", cb: (payload: unknown) => void) {
  const { listen } = await load();
  return listen(event, cb);
}

export const api = {
  appStatus: () => call<{ hasClient: boolean; accounts: Account[] }>("app_status"),
  setGoogleClient: (clientId: string, clientSecret: string) => call<void>("set_google_client", { clientId, clientSecret }),
  addAccount: (loginHint?: string) => call<Account>("add_account", { loginHint }),
  removeAccount: (accountId: string) => call<void>("remove_account", { accountId }),
  syncNow: () => call<void>("sync_now"),
  getPrefs: () => call<Prefs>("get_prefs"),
  setPrefs: (patch: Partial<Prefs> | Record<string, unknown>) => call<Prefs>("set_prefs", { patch }),

  listLabels: (accountId: string | null) => call<Label[]>("list_labels", { accountId }),
  cachedThreads: (accountId: string | null, labels: string[], before?: number, limit?: number) =>
    call<ThreadSummary[]>("cached_threads", { accountId, labels, before, limit }),
  fetchThreads: (accountId: string | null, labels: string[], page?: [string, string][] | null) =>
    call<ThreadPage>("fetch_threads", { accountId, labels, page }),
  search: (accountId: string | null, query: string, page?: [string, string][] | null) =>
    call<ThreadPage>("search", { accountId, query, page }),
  recentSearches: () => call<string[]>("recent_searches"),
  clearRecentSearches: () => call<void>("clear_recent_searches"),
  getThread: (accountId: string, threadId: string) => call<ThreadDetail>("get_thread", { accountId, threadId }),

  act: (threads: ThreadRef[], op: "modify" | "trash" | "untrash", add: string[] = [], remove: string[] = []) =>
    call<ThreadSummary[]>("act_on_threads", { threads, op, add, remove }),
  blockSender: (accountId: string, email: string) => call<void>("block_sender", { accountId, email }),
  unsubscribe: (accountId: string, threadId: string, messageId: string) =>
    call<string | null>("unsubscribe", { accountId, threadId, messageId }),

  attachmentData: (accountId: string, messageId: string, attachmentId: string) =>
    call<string>("attachment_data", { accountId, messageId, attachmentId }),
  saveAttachment: (accountId: string, messageId: string, attachmentId: string, path: string) =>
    call<void>("save_attachment", { accountId, messageId, attachmentId, path }),
  openAttachment: (accountId: string, messageId: string, attachmentId: string, filename: string) =>
    call<void>("open_attachment", { accountId, messageId, attachmentId, filename }),

  sendMessage: (draft: Draft) => call<void>("send_message", { draft }),
  saveDraft: (draft: Draft) => call<{ draftId: string; messageId: string; threadId: string }>("save_draft", { draft }),
  deleteDraft: (accountId: string, draftId: string, threadId?: string | null) =>
    call<void>("delete_draft", { accountId, draftId, threadId }),
  draftForMessage: (accountId: string, messageId: string) => call<string | null>("draft_for_message", { accountId, messageId }),
  searchContacts: (accountId: string | null, query: string) => call<Addr[]>("search_contacts", { accountId, query }),

  sendAs: (accountId: string) => call<SendAs[]>("send_as", { accountId }),
  getVacation: (accountId: string) => call<Vacation>("get_vacation", { accountId }),
  setVacation: (accountId: string, settings: Vacation) => call<Vacation>("set_vacation", { accountId, settings }),
  listFilters: (accountId: string) => call<Filter[] | null>("list_filters", { accountId }),
  createFilter: (accountId: string, filter: Omit<Filter, "id">) => call<Filter>("create_filter", { accountId, filter }),
  deleteFilter: (accountId: string, filterId: string) => call<void>("delete_filter", { accountId, filterId }),
  createLabel: (accountId: string, label: Record<string, unknown>) => call<Label[]>("create_label", { accountId, label }),
  updateLabel: (accountId: string, labelId: string, patch: Record<string, unknown>) =>
    call<Label[]>("update_label", { accountId, labelId, patch }),
  deleteLabel: (accountId: string, labelId: string) => call<Label[]>("delete_label", { accountId, labelId }),

  llmProviders: () => call<ProviderInfo[]>("llm_providers"),
  llmSaveProvider: (provider: Provider, apiKey?: string) => call<void>("llm_save_provider", { provider, apiKey }),
  llmDeleteProvider: (providerId: string) => call<void>("llm_delete_provider", { providerId }),
  llmTest: (providerId: string) => call<string>("llm_test", { providerId }),
  smartReplies: (accountId: string, threadId: string) => call<string[]>("smart_replies", { accountId, threadId }),
  summarizeThread: (accountId: string, threadId: string) => call<string>("summarize_thread", { accountId, threadId }),
  helpWrite: (instruction: string, draft: string, accountId?: string | null, threadId?: string | null) =>
    call<string>("help_write", { instruction, draft, accountId, threadId }),
};

/** Native helpers that only exist inside the app; harmless no-ops in the browser preview. */
export const native = {
  async openUrl(url: string) {
    if (isTauri) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } else {
      window.open(url, "_blank", "noopener");
    }
  },
  async pickFiles(): Promise<string[]> {
    if (!isTauri) return [];
    const { open } = await import("@tauri-apps/plugin-dialog");
    const res = await open({ multiple: true, directory: false });
    return res ? (Array.isArray(res) ? res : [res]) : [];
  },
  async savePath(defaultPath: string): Promise<string | null> {
    if (!isTauri) return null;
    const { save } = await import("@tauri-apps/plugin-dialog");
    return save({ defaultPath });
  },
  async onFileDrop(cb: (paths: string[]) => void): Promise<() => void> {
    if (!isTauri) return () => {};
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    return getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "drop") cb(e.payload.paths);
    });
  },
};
