import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Glyph } from "../glyph";
import { IconButton } from "../icon-button";
import "./overlayScrollArea.css";

/** Scrollable content behind a bottom overlay, with enough inset to reveal the last item. */
export function OverlayScrollArea({ children, overlay, className = "", contentClassName = "", overlayClassName = "", endButtonLabel, autoFollow = false, resetKey }: {
  children: ReactNode;
  overlay: ReactNode;
  className?: string;
  contentClassName?: string;
  overlayClassName?: string;
  endButtonLabel?: string;
  autoFollow?: boolean;
  resetKey?: string | number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const items = useRef<HTMLDivElement>(null);
  const pinned = useRef(autoFollow);
  const jumping = useRef(false);
  const [awayFromEnd, setAwayFromEnd] = useState(false);
  const contentId = useId();
  const updateEndState = useCallback(() => {
    const scroll = content.current;
    if (!scroll?.clientHeight) return;
    const atEnd = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop <= 8;
    if (atEnd) { pinned.current = true; jumping.current = false; }
    else if (!jumping.current) pinned.current = false;
    setAwayFromEnd(!atEnd);
  }, []);
  useLayoutEffect(() => {
    pinned.current = autoFollow;
    jumping.current = false;
    if (autoFollow && content.current) content.current.scrollTop = content.current.scrollHeight;
    updateEndState();
  }, [resetKey, autoFollow, updateEndState]);
  useLayoutEffect(() => {
    let dockHeight: number | undefined;
    let frame: number | undefined;
    const measure = () => {
      if (!root.current || !dock.current) return;
      const scroll = content.current;
      if (!scroll?.clientHeight) return;
      const nextHeight = dock.current.offsetHeight;
      const overlayChanged = nextHeight !== dockHeight;
      dockHeight = nextHeight;
      root.current.style.setProperty("--overlay-height", `${nextHeight}px`);
      if (pinned.current && (autoFollow || overlayChanged)) {
        scroll.scrollTop = scroll.scrollHeight;
        jumping.current = false;
      }
      updateEndState();
    };
    measure();
    // Padding changes the scroll container's content box. Apply observer writes
    // next frame rather than creating a same-frame ResizeObserver feedback loop.
    const scheduleMeasure = () => {
      if (frame !== undefined) return;
      frame = window.requestAnimationFrame(() => { frame = undefined; measure(); });
    };
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(scheduleMeasure);
    if (dock.current) observer?.observe(dock.current);
    if (content.current) observer?.observe(content.current);
    if (items.current) observer?.observe(items.current);
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      observer?.disconnect();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [autoFollow, updateEndState]);
  const scrollToEnd = () => {
    const scroll = content.current;
    if (!scroll) return;
    pinned.current = true;
    jumping.current = true;
    scroll.scrollTo({ top: scroll.scrollHeight, behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    updateEndState();
  };
  const cancelJump = () => { jumping.current = false; };
  return (
    <div ref={root} className={`overlay-scroll-area ${className}`.trim()}>
      <div ref={content} id={contentId} className={`overlay-scroll-area__content ${contentClassName}`.trim()} onScroll={updateEndState}
        onWheel={cancelJump} onTouchStart={cancelJump} onPointerDown={cancelJump}
        onKeyDown={event => { if (["ArrowUp", "PageUp", "Home"].includes(event.key)) cancelJump(); }}>
        <div ref={items} className="overlay-scroll-area__items">{children}</div>
      </div>
      <div ref={dock} className={`overlay-scroll-area__overlay ${overlayClassName}`.trim()}>{overlay}</div>
      {endButtonLabel && awayFromEnd && <div className="overlay-scroll-area__end">
        <IconButton label={endButtonLabel} aria-controls={contentId} onClick={scrollToEnd}><Glyph name="arrow-down" size={18} /></IconButton>
      </div>}
    </div>
  );
}
