import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { tooltipPosition, type TooltipAnchor, type TooltipSide } from "./tooltipPosition";
import "./tooltip.css";

export function TooltipContent({ anchor, children, side = "top", id, interactive = true, onPointerEnter, onPointerLeave }: {
  anchor: TooltipAnchor;
  children: ReactNode;
  side?: TooltipSide;
  id?: string;
  interactive?: boolean;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}) {
  const generatedId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<ReturnType<typeof tooltipPosition>>();
  useLayoutEffect(() => {
    const measure = () => {
      if (ref.current) setPosition(tooltipPosition(anchor.getBoundingClientRect(), ref.current.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }, side));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [anchor, children, side]);

  if (typeof document === "undefined") return null;
  return createPortal(<div ref={ref} id={id || generatedId} role="tooltip" className="shared-tooltip" data-tooltip-content="" data-side={position?.side}
    style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden", pointerEvents: interactive ? "auto" : "none" }}
    onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>{children}</div>, document.body);
}
