import { useEffect, useRef } from "react";

export function SkillsNavigation({ items, selected, onSelect }: {
  items: Array<{ id: string; label: string; count: number }>;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const nav = useRef<HTMLDivElement>(null);
  useEffect(() => {
    nav.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected]);
  return (
    <div ref={nav} className="skills-nav" role="tablist" aria-label="Skills sections" onKeyDown={(event) => {
      const index = items.findIndex((item) => item.id === selected);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : event.key === "ArrowRight" ? (index + 1) % items.length
          : event.key === "ArrowLeft" ? (index - 1 + items.length) % items.length : -1;
      if (next < 0) return;
      event.preventDefault();
      onSelect(items[next].id);
      nav.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
    }}>
      {items.map((item) => (
        <button key={item.id} id={`skills-tab-${item.id}`} type="button" role="tab"
          className={"skills-nav-item" + (selected === item.id ? " active" : "")}
          aria-selected={selected === item.id} aria-controls="skills-panel" tabIndex={selected === item.id ? 0 : -1}
          onClick={() => onSelect(item.id)}>
          <span>{item.label}</span><span className="skills-nav-count" aria-hidden="true">{item.count}</span>
        </button>
      ))}
    </div>
  );
}
