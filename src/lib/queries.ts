import { QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./ipc";
import { refKey, useUi, type View } from "./store";
import type { Prefs, ThreadPage, ThreadRef, ThreadSummary } from "./types";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } },
});

export const useStatus = () => useQuery({ queryKey: ["status"], queryFn: api.appStatus });

export function useAccounts() {
  return useStatus().data?.accounts ?? [];
}

export function usePrefs(): Prefs {
  return useQuery({ queryKey: ["prefs"], queryFn: api.getPrefs }).data ?? {};
}

export function useSetPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.setPrefs,
    onSuccess: (prefs) => qc.setQueryData(["prefs"], prefs),
  });
}

export const useLabels = (accountId: string | null) =>
  useQuery({ queryKey: ["labels", accountId], queryFn: () => api.listLabels(accountId) });

export const useSendAs = (accountId: string) =>
  useQuery({ queryKey: ["sendAs", accountId], queryFn: () => api.sendAs(accountId), staleTime: 10 * 60_000 });

export const useThread = (ref: ThreadRef | null) =>
  useQuery({
    queryKey: ["thread", ref?.accountId, ref?.threadId],
    queryFn: () => api.getThread(ref!.accountId, ref!.threadId),
    enabled: !!ref,
  });

export const useProviders = () => useQuery({ queryKey: ["providers"], queryFn: api.llmProviders });

/** Labels a view filters on when talking to Gmail. */
export function viewLabels(v: View): string[] {
  if (v.label === "ALL" || v.label === "SEARCH") return [];
  return v.category ? [v.label, v.category] : [v.label];
}

/** Whether a thread still belongs in a view after its labels changed. */
export function belongs(v: View, t: ThreadSummary): boolean {
  if (v.accountId && t.accountId !== v.accountId) return false;
  if (v.label === "SEARCH") return true;
  const trashed = t.labelIds.includes("TRASH") || t.labelIds.includes("SPAM");
  if (v.label === "ALL") return !trashed;
  if (v.label !== "TRASH" && v.label !== "SPAM" && trashed) return false;
  return viewLabels(v).every((l) => t.labelIds.includes(l));
}

export function useThreadList(view: View) {
  const labels = viewLabels(view);
  const cached = useQuery({
    queryKey: ["cached", view],
    queryFn: () => api.cachedThreads(view.accountId, labels, undefined, 100),
    enabled: view.label !== "SEARCH",
  });
  const remote = useInfiniteQuery({
    queryKey: ["threads", view],
    initialPageParam: null as [string, string][] | null,
    queryFn: ({ pageParam }) =>
      view.label === "SEARCH"
        ? api.search(view.accountId, view.query ?? "", pageParam)
        : api.fetchThreads(view.accountId, labels, pageParam),
    getNextPageParam: (last: ThreadPage) => (last.next.length ? last.next : undefined),
  });
  const fromRemote = remote.data?.pages.flatMap((p) => p.threads);
  const threads = (fromRemote ?? cached.data ?? []).filter((t) => belongs(view, t));
  return {
    threads,
    loading: !fromRemote && !cached.data && (remote.isLoading || cached.isLoading),
    refreshing: remote.isFetching && !remote.isFetchingNextPage,
    error: remote.error && !cached.data ? (remote.error as unknown as string) : null,
    offline: !!remote.error && !!cached.data,
    hasMore: remote.hasNextPage,
    loadMore: () => remote.fetchNextPage(),
    refetch: () => remote.refetch(),
  };
}

/** Replaces updated threads in every cached list, dropping ones that left the view. */
export function patchLists(qc: QueryClient, updated: ThreadSummary[]) {
  const byKey = new Map(updated.map((t) => [refKey({ accountId: t.accountId, threadId: t.id }), t]));
  const patch = (view: View, list: ThreadSummary[]) =>
    list
      .map((t) => byKey.get(refKey({ accountId: t.accountId, threadId: t.id })) ?? t)
      .filter((t) => belongs(view, t));
  for (const [key, data] of qc.getQueriesData<{ pages: ThreadPage[]; pageParams: unknown[] }>({ queryKey: ["threads"] })) {
    if (!data) continue;
    const view = key[1] as View;
    qc.setQueryData(key, { ...data, pages: data.pages.map((p) => ({ ...p, threads: patch(view, p.threads) })) });
  }
  for (const [key, data] of qc.getQueriesData<ThreadSummary[]>({ queryKey: ["cached"] })) {
    if (data) qc.setQueryData(key, patch(key[1] as View, data));
  }
  for (const t of updated) {
    qc.setQueryData(["thread", t.accountId, t.id], (old: { summary: ThreadSummary } | undefined) =>
      old ? { ...old, summary: t } : old,
    );
  }
}

export function refreshMail(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["threads"] });
  qc.invalidateQueries({ queryKey: ["cached"] });
  qc.invalidateQueries({ queryKey: ["labels"] });
  qc.invalidateQueries({ queryKey: ["thread"] });
  qc.invalidateQueries({ queryKey: ["status"] });
}

export type Action =
  | "archive" | "unarchive" | "trash" | "untrash" | "spam" | "notSpam" | "star" | "unstar"
  | "important" | "notImportant" | "read" | "unread";

const ACTIONS: Record<Action, { op: "modify" | "trash" | "untrash"; add?: string[]; remove?: string[]; done?: string; undo?: Action }> = {
  archive: { op: "modify", remove: ["INBOX"], done: "Archived", undo: "unarchive" },
  unarchive: { op: "modify", add: ["INBOX"], done: "Moved to Inbox" },
  trash: { op: "trash", done: "Moved to Trash", undo: "untrash" },
  untrash: { op: "untrash", done: "Restored" },
  spam: { op: "modify", add: ["SPAM"], remove: ["INBOX"], done: "Reported as spam", undo: "notSpam" },
  notSpam: { op: "modify", add: ["INBOX"], remove: ["SPAM"], done: "Moved to Inbox" },
  star: { op: "modify", add: ["STARRED"], undo: "unstar" },
  unstar: { op: "modify", remove: ["STARRED"], undo: "star" },
  important: { op: "modify", add: ["IMPORTANT"], done: "Marked as important", undo: "notImportant" },
  notImportant: { op: "modify", remove: ["IMPORTANT"], done: "Marked as not important", undo: "important" },
  read: { op: "modify", remove: ["UNREAD"], undo: "unread" },
  unread: { op: "modify", add: ["UNREAD"], undo: "read" },
};

/** Last undoable action, for the `z` shortcut. */
let lastUndo: (() => void) | null = null;
export const undoLast = () => lastUndo?.();

export function useActions() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);

  async function run(action: Action, refs: ThreadRef[], opts: { quiet?: boolean } = {}): Promise<boolean> {
    if (!refs.length) return false;
    const a = ACTIONS[action];
    try {
      const updated = await api.act(refs, a.op, a.add, a.remove);
      patchLists(qc, updated);
      qc.invalidateQueries({ queryKey: ["labels"] });
      const undo = a.undo ? () => void run(a.undo!, refs, { quiet: true }) : undefined;
      if (undo) lastUndo = undo;
      if (a.done && !opts.quiet) {
        const n = refs.length;
        toast({ text: n > 1 ? `${n} conversations: ${a.done.toLowerCase()}` : a.done, undo });
      }
      return true;
    } catch (e) {
      toast({ text: String(e), error: true });
      return false;
    }
  }

  async function setLabels(refs: ThreadRef[], add: string[], remove: string[]) {
    try {
      patchLists(qc, await api.act(refs, "modify", add, remove));
      qc.invalidateQueries({ queryKey: ["labels"] });
      lastUndo = () => void api.act(refs, "modify", remove, add).then((u) => patchLists(qc, u));
      toast({ text: "Labels updated", undo: lastUndo });
    } catch (e) {
      toast({ text: String(e), error: true });
    }
  }

  return { run, setLabels };
}
