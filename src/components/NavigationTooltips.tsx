import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Render outside the scrolling sidebar so hints never clip or widen the rail. */
export function NavigationTooltips() {
  const id = useId();
  const tooltip = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useEffect(() => {
    let active: HTMLElement | null = null;
    let timer: number | undefined;
    const trigger = (target: EventTarget | null) => target instanceof Element
      ? target.closest<HTMLElement>("[data-nav-tooltip]") : null;
    const dismiss = () => {
      window.clearTimeout(timer);
      active = null;
      setAnchor(null);
    };
    const show = (element: HTMLElement, delay: number) => {
      if (active === element) return;
      dismiss();
      active = element;
      timer = window.setTimeout(() => {
        if (element.isConnected) setAnchor(element);
      }, delay);
    };
    const enter = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const element = trigger(event.target);
      if (element) show(element, 180);
    };
    const leave = (event: PointerEvent) => {
      const element = trigger(event.target);
      if (element && !element.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null)) dismiss();
    };
    const focus = (event: FocusEvent) => {
      const element = trigger(event.target);
      if (element?.matches(":focus-visible")) show(element, 0);
    };
    const blur = (event: FocusEvent) => { if (trigger(event.target)) dismiss(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    document.addEventListener("pointerover", enter);
    document.addEventListener("pointerout", leave);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", blur);
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerover", enter);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", blur);
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, []);

  useLayoutEffect(() => {
    if (!anchor || !tooltip.current) return;
    const rect = anchor.getBoundingClientRect();
    const tip = tooltip.current.getBoundingClientRect();
    const margin = 8;
    const right = rect.right + 10;
    setPosition({
      left: Math.max(margin, Math.min(right + tip.width <= window.innerWidth - margin
        ? right : rect.left - tip.width - 10, window.innerWidth - tip.width - margin)),
      top: Math.max(margin, Math.min(rect.top + (rect.height - tip.height) / 2, window.innerHeight - tip.height - margin)),
    });
    const previous = anchor.getAttribute("aria-describedby");
    anchor.setAttribute("aria-describedby", [previous, id].filter(Boolean).join(" "));
    return () => {
      const remaining = (anchor.getAttribute("aria-describedby") || "").split(/\s+/).filter(value => value && value !== id);
      if (remaining.length) anchor.setAttribute("aria-describedby", remaining.join(" "));
      else anchor.removeAttribute("aria-describedby");
    };
  }, [anchor, id]);

  return anchor && createPortal(
    <div ref={tooltip} id={id} role="tooltip" className="navigation-tooltip" style={position}>
      {anchor.dataset.navTooltip}
    </div>, document.body,
  );
}
