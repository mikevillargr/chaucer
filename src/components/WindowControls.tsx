import { useEffect, useState } from "react";
import { isTauri } from "../lib/ipc";
import { isWindows } from "../lib/platform";
import { Icon } from "./ui";

type Win = Awaited<ReturnType<typeof load>>;
async function load() {
  return (await import("@tauri-apps/api/window")).getCurrentWindow();
}

/**
 * Minimise / maximise-restore / close for the frameless Windows window (the native frame is
 * off there). Renders nothing on other platforms. In the browser preview (`?platform=windows`)
 * the buttons only toggle local state so the layout can be checked.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isWindows || !isTauri) return;
    let off: (() => void) | undefined;
    let dead = false;
    void load().then(async (w) => {
      const sync = async () => !dead && setMaximized(await w.isMaximized());
      await sync();
      const un = await w.onResized(() => void sync());
      if (dead) un(); else off = un;
    });
    return () => { dead = true; off?.(); };
  }, []);

  if (!isWindows) return null;
  const act = (fn: (w: Win) => Promise<unknown>) => () => { if (isTauri) void load().then(fn); };

  return (
    <div className="win-controls" role="group" aria-label="Window controls">
      <button title="Minimize" aria-label="Minimize" onClick={act((w) => w.minimize())}><Icon name="remove" /></button>
      <button
        title={maximized ? "Restore" : "Maximize"}
        aria-label={maximized ? "Restore" : "Maximize"}
        onClick={isTauri ? act((w) => w.toggleMaximize()) : () => setMaximized((m) => !m)}
      >
        <Icon name={maximized ? "filter_none" : "crop_square"} />
      </button>
      <button className="close" title="Close" aria-label="Close" onClick={act((w) => w.close())}><Icon name="close" /></button>
    </div>
  );
}
