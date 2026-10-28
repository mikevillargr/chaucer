import { confirmDialog } from "../../components/ui";
import { useActions, usePrefs } from "../../lib/queries";
import type { ThreadRef } from "../../lib/types";

/** Archive / delete honouring "Confirm before archiving/deleting" (Android Gmail settings). */
export function useConfirmed() {
  const prefs = usePrefs();
  const { run } = useActions();
  const plural = (n: number) => (n === 1 ? "this conversation" : `these ${n} conversations`);
  return {
    async archive(refs: ThreadRef[]) {
      if (prefs.confirmArchive && !(await confirmDialog("Archive?", `Archive ${plural(refs.length)}?`, "Archive"))) return false;
      return run("archive", refs);
    },
    async trash(refs: ThreadRef[]) {
      if (prefs.confirmDelete && !(await confirmDialog("Delete?", `Move ${plural(refs.length)} to Trash?`, "Delete"))) return false;
      return run("trash", refs);
    },
  };
}
