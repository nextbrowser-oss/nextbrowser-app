import { useEffect, useId, useRef, useState } from "react";
import { CommandList } from "../command-list";
import { Glyph } from "../glyph";
import "./select.css";

export interface SelectOption { value: string; label: string }

/** Inline listbox that stays inside its owning glass popover or dialog. */
export function Select({ label, value, options, onChange, disabled = false, autoFocus = false }: {
  label: string; value: string; options: readonly SelectOption[]; onChange: (value: string) => void; disabled?: boolean; autoFocus?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(value);
  const typed = useRef({ text: "", time: 0 });
  const expanded = open && !disabled && options.length > 0;
  const choose = (next: string) => { onChange(next); setOpen(false); };
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [expanded]);
  return <div ref={root} className="shared-select" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <button type="button" className="shared-select-trigger" role="combobox" aria-label={label} aria-expanded={expanded} aria-haspopup="listbox"
      aria-controls={expanded ? id : undefined} aria-activedescendant={expanded ? `${id}-${active}` : undefined}
      data-autofocus={autoFocus || undefined} disabled={disabled || !options.length}
      onClick={() => { setActive(value); setOpen(!expanded); }}
      onKeyDown={event => {
        if (disabled || !options.length || event.nativeEvent.isComposing) return;
        if (event.key === "Escape" && expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
        if (event.key === "Tab") { setOpen(false); return; }
        if ((event.key === "Enter" || event.key === " ") && expanded) { event.preventDefault(); choose(active); return; }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const index = Math.max(0, options.findIndex(option => option.value === (expanded ? active : value)));
          const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : expanded ? (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length : index;
          setActive(options[next].value); setOpen(true); return;
        }
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== " ") {
          event.preventDefault();
          const time = Date.now(), text = (time - typed.current.time < 700 ? typed.current.text : "") + event.key.toLowerCase();
          typed.current = { text, time };
          const match = options.find(option => option.label.toLowerCase().startsWith(text));
          if (match) { setActive(match.value); setOpen(true); }
        }
      }}>
      <span>{options.find(option => option.value === value)?.label ?? "Choose…"}</span><Glyph name="chevron-down" size={14} />
    </button>
    {expanded && <CommandList id={id} label={label} activeId={active} options={options.map(option => ({ id: option.value, title: option.label, description: "" }))} onChoose={choose} />}
  </div>;
}
