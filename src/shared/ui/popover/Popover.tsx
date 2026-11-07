import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { tooltipPosition, type TooltipSide } from "../tooltip";
import "./popover.css";

type TriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & { ref: Ref<HTMLButtonElement> };

/** Non-modal anchored surface. The caller owns content, state and product actions. */
export function Popover({ label, open, onOpenChange, trigger, children, side = "bottom", className = "" }: {
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: (props: TriggerProps) => ReactNode;
  children: ReactNode;
  side?: TooltipSide;
  className?: string;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const id = useId();
  const [position, setPosition] = useState<{ left: number; top: number }>();
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      if (anchor.current && surface.current) setPosition(tooltipPosition(anchor.current.getBoundingClientRect(), surface.current.getBoundingClientRect(), { width: innerWidth, height: innerHeight }, side));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    if (surface.current) observer?.observe(surface.current);
    if (anchor.current) observer?.observe(anchor.current);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [open, side]);
  useEffect(() => {
    if (!open) return;
    const popup = surface.current;
    const button = anchor.current;
    (popup?.querySelector<HTMLElement>("[data-autofocus], input:not(:disabled), textarea:not(:disabled), button:not(:disabled), [tabindex='0']") ?? popup)?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !popup?.contains(event.target) && !button?.contains(event.target)) onOpenChange(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault(); event.stopPropagation(); onOpenChange(false);
    };
    const focus = (event: FocusEvent) => {
      if (event.target instanceof Node && !popup?.contains(event.target) && !button?.contains(event.target)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("focusin", focus);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("focusin", focus);
      if (popup?.contains(document.activeElement) || document.activeElement === document.body) button?.focus();
    };
  }, [open, onOpenChange]);
  return <>
    {trigger({ ref: anchor, type: "button", "aria-haspopup": "dialog", "aria-expanded": open, "aria-controls": open ? id : undefined, onClick: () => onOpenChange(!open) })}
    {open && createPortal(<div ref={surface} id={id} role="dialog" aria-label={label} tabIndex={-1}
      className={`shared-popover ${className}`.trim()} style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden" }}>{children}</div>, document.body)}
  </>;
}
