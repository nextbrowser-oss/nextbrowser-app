import { useLayoutEffect, useRef, type ReactNode } from "react";
import "./overlayScrollArea.css";

/** Scrollable content behind a bottom overlay, with enough inset to reveal the last item. */
export function OverlayScrollArea({ children, overlay, className = "", contentClassName = "", overlayClassName = "" }: {
  children: ReactNode;
  overlay: ReactNode;
  className?: string;
  contentClassName?: string;
  overlayClassName?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const measure = () => {
      if (!root.current || !dock.current) return;
      const scroll = content.current;
      const pinned = !!scroll && scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop <= 2;
      root.current.style.setProperty("--overlay-height", `${dock.current.offsetHeight}px`);
      if (pinned && scroll) scroll.scrollTop = scroll.scrollHeight;
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    if (dock.current) observer?.observe(dock.current);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  return (
    <div ref={root} className={`overlay-scroll-area ${className}`.trim()}>
      <div ref={content} className={`overlay-scroll-area__content ${contentClassName}`.trim()}>{children}</div>
      <div ref={dock} className={`overlay-scroll-area__overlay ${overlayClassName}`.trim()}>{overlay}</div>
    </div>
  );
}
