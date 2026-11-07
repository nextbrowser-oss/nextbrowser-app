import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type Ref, type RefObject } from "react";
import { createPortal } from "react-dom";
import { tooltipPosition, type TooltipSide } from "../tooltip";
import { glassSurfaceClassName } from "../glass-surface";
import "./popover.css";

type TriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & { ref: Ref<HTMLButtonElement> };

/** Non-modal anchored surface. The caller owns content, state and product actions. */
export function Popover({ label, open, onOpenChange, trigger, children, side = "bottom", align = "center", boundaryRef, className = "" }: {
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: (props: TriggerProps) => ReactNode;
  children: ReactNode;
  side?: TooltipSide;
  align?: "start" | "center" | "end";
  boundaryRef?: RefObject<HTMLElement>;
  className?: string;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const id = useId();
  const [position, setPosition] = useState<{ left: number; top: number; maxWidth: number }>();
  useLayoutEffect(() => {
    if (!open) return;
    let frame: number | undefined;
    const measure = () => {
      if (!anchor.current || !surface.current) return;
      const trigger = anchor.current.getBoundingClientRect(), popup = surface.current.getBoundingClientRect();
      const bounds = boundaryRef?.current?.getBoundingClientRect();
      const left = Math.max(8, (bounds?.left ?? 0) + 8), right = Math.min(innerWidth - 8, (bounds?.right ?? innerWidth) - 8);
      const next = tooltipPosition(trigger, popup, { width: innerWidth, height: innerHeight }, side);
      const x = align === "start" ? trigger.left : align === "end" ? trigger.right - popup.width : next.left;
      setPosition({ left: Math.max(left, Math.min(x, right - Math.min(popup.width, right - left))), top: next.top, maxWidth: Math.max(0, right - left) });
    };
    measure();
    const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(() => { frame = undefined; measure(); }); };
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    if (surface.current) observer?.observe(surface.current);
    if (anchor.current) observer?.observe(anchor.current);
    if (boundaryRef?.current) observer?.observe(boundaryRef.current);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => { observer?.disconnect(); if (frame !== undefined) cancelAnimationFrame(frame); window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule, true); };
  }, [open, side, align, boundaryRef]);
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
      className={`${glassSurfaceClassName} shared-popover ${className}`.trim()} style={{ left: position?.left ?? 0, top: position?.top ?? 0, maxWidth: position?.maxWidth, visibility: position ? "visible" : "hidden" }}>{children}</div>, document.body)}
  </>;
}
