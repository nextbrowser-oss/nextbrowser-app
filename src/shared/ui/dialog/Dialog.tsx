import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Glyph } from "../glyph";
import { IconButton } from "../icon-button";
import "./dialog.css";

const focusableSelector = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

/** A modal shell; the caller owns its open state, content and actions. */
export function Dialog({ title, children, onClose, className = "" }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const topModal = () => [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].at(-1);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    if (!dialog) return;
    // A nested editor may already have autofocus; don't steal its focus.
    if (topModal() === dialog) (dialog.querySelector<HTMLElement>('[autofocus], [data-autofocus]') ?? dialog.querySelector<HTMLElement>('button') ?? dialog).focus();
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const activeDialog = topModal();
      if (!activeDialog || !dialog.contains(activeDialog)) return;
      if (event.key === "Escape" && activeDialog === dialog) {
        event.preventDefault(); event.stopPropagation(); closeRef.current(); return;
      }
      if (event.key !== "Tab") return;
      const items = [...activeDialog.querySelectorAll<HTMLElement>(focusableSelector)].filter(element => element.offsetParent !== null);
      const first = items[0], last = items.at(-1), active = document.activeElement;
      if (!first || !last) { event.preventDefault(); activeDialog.focus(); return; }
      if (!activeDialog.contains(active) || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); if (opener?.isConnected) opener.focus(); };
  }, []);
  return createPortal(<div className="modal-overlay shared-dialog-overlay" onMouseDown={event => {
    if (event.target === event.currentTarget && topModal() === ref.current) onClose();
  }}>
    <div ref={ref} className={`shared-dialog ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header className="shared-dialog-header"><h2 id={titleId}>{title}</h2>
        <IconButton size="small" appearance="plain" label={`Close ${title}`} onClick={onClose}><Glyph name="x" size={17} /></IconButton>
      </header>
      <div className="shared-dialog-body">{children}</div>
    </div>
  </div>, document.body);
}
