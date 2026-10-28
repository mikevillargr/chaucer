import { useRef } from "react";
import { clampWidth, PANES, usePanes } from "../lib/panes";

/** Draggable divider on the right edge of a pane. Double-click resets; arrow keys nudge. */
export function Resizer({ pane, label, at }: { pane: "sidebar" | "list"; label: string; at: number }) {
  const { widths, setWidth, reset, setResizing } = usePanes();
  const start = useRef<{ x: number; w: number } | null>(null);
  const other = pane === "sidebar" ? widths.list : widths.sidebar;
  const apply = (w: number) => setWidth(pane, clampWidth(pane, w, other, window.innerWidth));

  return (
    <div
      className="resizer"
      style={{ left: at - 4 }}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={PANES[pane].min}
      aria-valuemax={PANES[pane].max}
      aria-valuenow={widths[pane]}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: widths[pane] };
        setResizing(true);
      }}
      onPointerMove={(e) => {
        if (start.current) apply(start.current.w + e.clientX - start.current.x);
      }}
      onPointerUp={() => {
        start.current = null;
        setResizing(false);
      }}
      onDoubleClick={() => reset(pane)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          e.stopPropagation();
          apply(widths[pane] + (e.key === "ArrowRight" ? 16 : -16));
        }
      }}
    />
  );
}
