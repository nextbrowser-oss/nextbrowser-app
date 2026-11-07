import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tooltipPosition } from "../tooltip";
import { glassSurfaceClassName } from "../glass-surface";
import "./commandList.css";

export function CommandList({ id, label, options, activeId, onChoose, anchor }: {
  id: string;
  label: string;
  options: { id: string; title: string; description: string }[];
  activeId?: string;
  onChoose: (id: string) => void;
  anchor?: HTMLElement | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; room: number }>();
  useLayoutEffect(() => {
    if (!anchor) return;
    let frame: number | undefined;
    const measure = () => {
      if (!root.current) return;
      const bounds = anchor.getBoundingClientRect();
      const popup = root.current.getBoundingClientRect();
      const next = tooltipPosition(bounds, popup, { width: innerWidth, height: innerHeight }, "top");
      setPosition({ left: Math.max(8, Math.min(bounds.left, innerWidth - popup.width - 8)), top: next.top, width: bounds.width, room: Math.max(40, bounds.top - 18) });
    };
    const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(() => { frame = undefined; measure(); }); };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    observer?.observe(anchor); if (root.current) observer?.observe(root.current);
    window.addEventListener("resize", schedule); window.addEventListener("scroll", schedule, true);
    return () => { observer?.disconnect(); if (frame !== undefined) cancelAnimationFrame(frame); window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule, true); };
  }, [anchor]);
  useEffect(() => { root.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" }); }, [activeId]);
  const list = <div ref={root} id={id} className={`${glassSurfaceClassName} shared-command-list shared-scrollbarless`} role="listbox" aria-label={label}
    style={anchor ? { position: "fixed", left: position?.left ?? 0, top: position?.top ?? 0, bottom: "auto", width: `min(420px, ${position?.width ?? 420}px, calc(100vw - 16px))`, maxHeight: Math.min(300, position?.room ?? 300), visibility: position ? "visible" : "hidden" } : undefined}>
    {options.map(option => <div key={option.id} id={`${id}-${option.id}`} role="option" aria-selected={option.id === activeId}
      className="shared-command-list__option" onPointerDown={event => event.preventDefault()} onClick={() => onChoose(option.id)}>
      <strong>{option.title}</strong>{" "}<span>{option.description}</span>
    </div>)}
  </div>;
  return anchor ? createPortal(list, document.body) : list;
}
