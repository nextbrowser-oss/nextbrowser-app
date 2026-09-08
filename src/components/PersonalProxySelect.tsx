import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

export interface PersonalProxyOption {
  id: string;
  name: string;
  scheme: string;
  host: string;
  port: number;
}

interface PersonalProxySelectProps {
  value: string;
  proxies: PersonalProxyOption[];
  disabled?: boolean;
  ariaLabel?: string;
  onChange: (id: string) => void;
  onAdd: () => void;
}

export function PersonalProxySelect({ value, proxies, disabled = false, ariaLabel = "Personal proxy", onChange, onAdd }: PersonalProxySelectProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>();
  const selected = proxies.find((proxy) => proxy.id === value);

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const position = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const padding = 8;
    const gap = 6;
    const availableBelow = window.innerHeight - rect.bottom - padding - gap;
    const availableAbove = rect.top - padding - gap;
    const above = availableBelow < 200 && availableAbove > availableBelow;
    const height = Math.max(132, Math.min(280, above ? availableAbove : availableBelow));
    setStyle({
      left: Math.max(padding, Math.min(rect.left, window.innerWidth - rect.width - padding)),
      top: above ? Math.max(padding, rect.top - height - gap) : rect.bottom + gap,
      width: rect.width,
      maxHeight: height,
    });
  };
  const show = () => {
    if (disabled) return;
    position();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !dropdownRef.current?.contains(target)) close();
    };
    const reposition = () => position();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      show();
    }
    if (event.key === "Escape") close(true);
  };

  return (
    <div className="personal-proxy-select" ref={rootRef}>
      <button ref={triggerRef} type="button" className={`personal-proxy-select-trigger${open ? " is-open" : ""}`} disabled={disabled} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-listbox`} onClick={() => open ? close() : show()} onKeyDown={onKeyDown}>
        <span className="personal-proxy-select-copy">{selected ? <><strong>{selected.name}</strong><small>{selected.scheme.toUpperCase()} · {selected.host}:{selected.port}</small></> : <span>Choose a proxy</span>}</span>
        <Icon name="chevron.down" size={14} className="personal-proxy-select-chevron" />
      </button>
      {open && createPortal(
        <div ref={dropdownRef} className="personal-proxy-select-menu" style={style} onMouseDown={(event) => event.stopPropagation()}>
          <div id={`${id}-listbox`} className="personal-proxy-select-options" role="listbox" aria-label={ariaLabel}>
            {proxies.map((proxy) => {
              const isSelected = proxy.id === value;
              return <button key={proxy.id} type="button" role="option" aria-selected={isSelected} className={`personal-proxy-select-option${isSelected ? " is-selected" : ""}`} onClick={() => { onChange(proxy.id); close(true); }}>
                <span><strong>{proxy.name}</strong><small>{proxy.scheme.toUpperCase()} · {proxy.host}:{proxy.port}</small></span>
                {isSelected && <Icon name="checkmark" size={14} />}
              </button>;
            })}
          </div>
          <button type="button" className="personal-proxy-select-add" onClick={() => { close(); onAdd(); }}><Icon name="plus" size={13} /> Add proxy</button>
        </div>,
        document.body,
      )}
    </div>
  );
}
