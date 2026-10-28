import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { avatarHue, initials } from "../lib/format";
import { useUi } from "../lib/store";
import type { Addr } from "../lib/types";

export function Icon({ name, fill, className = "" }: { name: string; fill?: boolean; className?: string }) {
  return <span className={`ms ${fill ? "fill" : ""} ${className}`} aria-hidden>{name}</span>;
}

export function IconButton({ icon, label, onClick, fill, small, disabled, className = "" }: {
  icon: string; label: string; onClick?: (e: React.MouseEvent) => void; fill?: boolean; small?: boolean; disabled?: boolean; className?: string;
}) {
  return (
    <button className={`icon-btn ${small ? "sm" : ""} ${className}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}>
      <Icon name={icon} fill={fill} />
    </button>
  );
}

export function Avatar({ addr, small }: { addr: Addr; small?: boolean }) {
  const hue = avatarHue(addr.email);
  return (
    <div className={`avatar ${small ? "sm" : ""}`} style={{ background: `hsl(${hue} 32% 40%)` }} aria-hidden>
      {initials(addr)}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? "on" : ""}`} onClick={() => onChange(!on)} />;
}

/** Popover menu positioned next to an anchor element; closes on outside click or Esc. */
export function Menu({ anchor, onClose, children, align = "left" }: {
  anchor: HTMLElement; onClose: () => void; children: ReactNode; align?: "left" | "right";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 });
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const el = ref.current!;
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = align === "right" ? r.right - w : r.left;
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
    left = Math.min(Math.max(8, left), window.innerWidth - w - 8);
    setPos({ top, left });
  }, [anchor, align]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [anchor, onClose]);
  return <div ref={ref} className="menu" role="menu" style={pos}>{children}</div>;
}

export function Dialog({ title, children, onClose, actions }: {
  title: string; children: ReactNode; onClose: () => void; actions: ReactNode;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
        <div className="actions">{actions}</div>
      </div>
    </div>
  );
}

/** Promise-based confirm dialog for "Confirm before archiving/deleting/sending". */
let confirmResolver: ((v: boolean) => void) | null = null;
let setConfirmState: ((s: { title: string; body: string; ok: string } | null) => void) | null = null;

export function confirmDialog(title: string, body: string, ok = "OK"): Promise<boolean> {
  return new Promise((resolve) => {
    confirmResolver = resolve;
    setConfirmState?.({ title, body, ok });
  });
}

export function ConfirmHost() {
  const [state, setState] = useState<{ title: string; body: string; ok: string } | null>(null);
  setConfirmState = setState;
  if (!state) return null;
  const done = (v: boolean) => {
    setState(null);
    confirmResolver?.(v);
  };
  return (
    <Dialog title={state.title} onClose={() => done(false)} actions={<>
      <button className="btn text" onClick={() => done(false)}>Cancel</button>
      <button className="btn text" autoFocus onClick={() => done(true)}>{state.ok}</button>
    </>}>
      <p className="muted" style={{ margin: 0 }}>{state.body}</p>
    </Dialog>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useUi();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.error ? "error" : ""}`}>
          <span style={{ flex: 1 }}>{t.text}</span>
          {t.undo && (
            <button className="btn text" onClick={() => { t.undo!(); dismissToast(t.id); }}>Undo</button>
          )}
          <IconButton icon="close" label="Dismiss" small onClick={() => dismissToast(t.id)} />
        </div>
      ))}
    </div>
  );
}

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Loading" />;
}
