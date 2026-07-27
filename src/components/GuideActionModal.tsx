import { useEffect, useId, useRef } from "react";
import { Icon } from "./Icon";

export interface GuideActionConfirmation {
  title: string;
  confirmLabel: string;
  icon: string;
  tint: string;
}

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function GuideActionModal({
  confirmation,
  onCancel,
  onConfirm,
}: {
  confirmation: GuideActionConfirmation;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    cancelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      const focusable = Array.from(
        dialog?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
      );
      if (!dialog || focusable.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onCancel]);

  return (
    <div
      className="modal-overlay guide-action-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="modal-card guide-action-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="guide-action-modal-heading">
          <span
            className="guide-action-modal-mark"
            style={{ background: confirmation.tint + "22", color: confirmation.tint }}
          >
            <Icon name={confirmation.icon} size={24} strokeWidth={2.15} />
          </span>
          <h3 id={titleId}>{confirmation.title}</h3>
        </div>
        <div className="modal-actions guide-action-modal-actions">
          <button ref={cancelRef} type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={onConfirm}>
            {confirmation.confirmLabel}
            <Icon name="chevron.right" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
