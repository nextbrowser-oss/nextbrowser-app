import { translate } from "../../lib/i18n";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CommandList } from "../command-list";
import { Glyph } from "../glyph";
import "./select.css";

export interface SelectOption { value: string; label: string; decoration?: ReactNode; description?: string }

function optionLabel(option: SelectOption) {
  return option.decoration ? <><span aria-hidden="true">{option.decoration}</span>{option.label}</> : option.label;
}

/** The list stays in the same focus scope in both inline and overlay layouts. */
export function Select({ label, value, options, onChange, disabled = false, autoFocus = false, searchPlaceholder, triggerContent, filterOptions, overlay = false }: {
  label: string; value: string; options: readonly SelectOption[]; onChange: (value: string) => void; disabled?: boolean; autoFocus?: boolean; searchPlaceholder?: string; triggerContent?: ReactNode;
  filterOptions?: (query: string) => readonly SelectOption[];
  overlay?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const flyout = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(value);
  const [query, setQuery] = useState("");
  const typed = useRef({ text: "", time: 0 });
  const expanded = open && !disabled && options.length > 0;
  const selected = options.find(option => option.value === value);
  const term = query.trim().toLowerCase();
  const visible = searchPlaceholder && term ? filterOptions?.(term) ?? options.filter(option =>
    option.label.toLowerCase().includes(term) || option.value.toLowerCase().includes(term)) : options;
  const current = visible.find(option => option.value === active)?.value ?? visible[0]?.value;
  const choose = (next: string) => { onChange(next); setOpen(false); trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (expanded && overlay && flyout.current) {
      flyout.current.popover = "manual";
      flyout.current.showPopover();
    }
  }, [expanded, overlay]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => { if (expanded && searchPlaceholder) search.current?.focus(); }, [expanded, searchPlaceholder]);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [expanded]);
  const activeDescendant = expanded && current ? `${id}-${current}` : undefined;
  const menu = expanded && <>
    {searchPlaceholder && <input ref={search} className="shared-select-search" role="combobox" aria-label={searchPlaceholder}
      aria-expanded="true" aria-controls={id} aria-autocomplete="list" aria-activedescendant={activeDescendant}
      placeholder={searchPlaceholder} value={query} onChange={event => { setQuery(event.target.value); setActive(""); }} />}
    <CommandList id={id} label={label} activeId={current} options={visible.map(option => ({ id: option.value, title: optionLabel(option), description: option.description ?? "" }))} onChoose={choose} />
    {!visible.length && <div className="shared-select-empty" role="status">{translate("No matching options.")}</div>}
  </>;
  return <div ref={root} className={overlay ? "shared-select shared-select-overlay" : "shared-select"} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}
      onKeyDown={event => {
        if (disabled || !options.length || event.nativeEvent.isComposing) return;
        const editing = event.target === search.current;
        if (event.key === "Escape" && expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); return; }
        if (event.key === "Tab") { if (!editing) setOpen(false); return; }
        if ((event.key === "Enter" || (!editing && event.key === " ")) && expanded) {
          event.preventDefault();
          if (current !== undefined) choose(current);
          return;
        }
        if (["ArrowDown", "ArrowUp"].includes(event.key) || (!editing && ["Home", "End"].includes(event.key))) {
          event.preventDefault();
          const choices = expanded ? visible : options;
          if (!choices.length) return;
          const index = Math.max(0, choices.findIndex(option => option.value === (expanded ? current : value)));
          const next = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : expanded ? (index + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length : index;
          if (!expanded) setQuery("");
          setActive(choices[next].value); setOpen(true); return;
        }
        if (!editing && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== " ") {
          event.preventDefault();
          if (searchPlaceholder) { setQuery(event.key); setActive(""); setOpen(true); return; }
          const time = Date.now(), text = (time - typed.current.time < 700 ? typed.current.text : "") + event.key.toLowerCase();
          typed.current = { text, time };
          const match = options.find(option => option.label.toLowerCase().startsWith(text));
          if (match) { setActive(match.value); setOpen(true); }
        }
      }}>
    <button ref={trigger} type="button" className="shared-select-trigger" role={expanded && searchPlaceholder ? undefined : "combobox"}
      aria-label={label} aria-expanded={expanded} aria-haspopup="listbox" aria-controls={expanded ? id : undefined}
      aria-activedescendant={searchPlaceholder ? undefined : activeDescendant}
      data-autofocus={autoFocus || undefined} disabled={disabled || !options.length}
      onClick={() => { setActive(value); setQuery(""); setOpen(!expanded); }}>
      {triggerContent ?? <><span>{selected ? optionLabel(selected) : translate("Choose…")}</span><Glyph name="chevron-down" size={14} /></>}
    </button>
    {expanded && (overlay ? <div ref={flyout} className="shared-select-flyout">{menu}</div> : menu)}
  </div>;
}
