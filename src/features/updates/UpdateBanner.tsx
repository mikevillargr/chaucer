import { useState } from "react";
import { Icon, IconButton } from "../../components/ui";
import { plainNotes, useUpdates } from "./updates";

/** Sidebar card shown when a newer release is available. */
export function UpdateBanner() {
  const { status, version, notes, progress, error, dismissed, install, dismiss } = useUpdates();
  const [open, setOpen] = useState(false);
  const busy = status === "downloading" || status === "installing";
  if (dismissed && !busy) return null;
  if (status !== "available" && !busy && !(status === "error" && version)) return null;

  return (
    <div className="update-card" role="status">
      <div className="update-head">
        <span className="eyebrow">Update available</span>
        {!busy && <IconButton small icon="close" label="Later" onClick={dismiss} />}
      </div>
      <div className="update-title">Chaucer {version}</div>
      {open && (
        <div className="update-notes">
          {plainNotes(notes).map((l, i) =>
            l.startsWith("### ") ? <strong key={i}>{l.slice(4)}</strong>
              : l.startsWith("- ") ? <div key={i} className="bullet">{l.slice(2)}</div>
              : <div key={i}>{l}</div>,
          )}
        </div>
      )}
      {status === "error" && <div className="error-text">{error}</div>}
      {busy ? (
        <div className="update-progress" aria-label="Downloading update">
          <i style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
          <span>{status === "installing" ? "Installing… Chaucer will restart" : `Downloading ${Math.round((progress ?? 0) * 100)}%`}</span>
        </div>
      ) : (
        <div className="row-actions">
          <button className="btn ink" onClick={() => void install()}><Icon name="restart_alt" /> Restart to update</button>
          {notes && <button className="btn text" onClick={() => setOpen(!open)}>{open ? "Hide notes" : "What's new"}</button>}
        </div>
      )}
    </div>
  );
}
