import { Children, cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { TooltipContent } from "./TooltipContent";
import type { TooltipSide } from "./tooltipPosition";

interface Hint { content: ReactNode; side: TooltipSide }
interface ActiveHint extends Hint { id: string; anchor: Element; descriptionTarget: Element }
interface Registry { register: (id: string, hint: Hint) => void; unregister: (id: string) => void }
const TooltipRegistry = createContext<Registry | null>(null);

function hasText(node: ReactNode): boolean {
  return Children.toArray(node).some(child => typeof child === "number" || (typeof child === "string" && /[\p{L}\p{N}]/u.test(child))
    || (isValidElement<{ children?: ReactNode; "aria-hidden"?: boolean }>(child) && !child.props["aria-hidden"] && hasText(child.props.children)));
}

/** A single DOM child keeps its layout, ref and handlers. Mount one provider in app initialization. */
export function Tooltip({ content, side = "top", children }: { content: ReactNode; side?: TooltipSide; children: ReactElement }) {
  const id = useId();
  const registry = useContext(TooltipRegistry);
  const empty = content == null || content === "" || content === false;
  useEffect(() => { if (!empty) registry?.register(id, { content, side }); }, [registry, id, content, side, empty]);
  useEffect(() => () => registry?.unregister(id), [registry, id]);
  useEffect(() => { if (empty) registry?.unregister(id); }, [registry, id, empty]);
  if (empty) return children;
  const child = children as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
  const iconOnly = (child.type === "button" || child.type === "a") && !child.props["aria-label"] && !child.props["aria-labelledby"] && !hasText(child.props.children);
  return cloneElement(child, { "data-tooltip-id": id, ...(iconOnly && typeof content === "string" ? { "aria-label": content } : {}) });
}

export function TooltipProvider({ children, delay = 180 }: { children: ReactNode; delay?: number }) {
  const hints = useRef(new Map<string, Hint>());
  const activeRef = useRef<ActiveHint | null>(null);
  const popupId = useId();
  const [active, setActive] = useState<ActiveHint | null>(null);
  const openTimer = useRef<number>();
  const closeTimer = useRef<number>();
  const dismiss = useCallback(() => {
    window.clearTimeout(openTimer.current); window.clearTimeout(closeTimer.current);
    activeRef.current = null; setActive(null);
  }, []);
  const register = useCallback((id: string, hint: Hint) => {
    hints.current.set(id, hint);
    if (activeRef.current?.id === id) {
      const next = { ...activeRef.current, ...hint };
      activeRef.current = next; setActive(next);
    }
  }, []);
  const unregister = useCallback((id: string) => {
    hints.current.delete(id);
    if (activeRef.current?.id === id) dismiss();
  }, [dismiss]);
  const registry = useMemo(() => ({ register, unregister }), [register, unregister]);

  useEffect(() => {
    let pending: Element | null = null;
    const trigger = (target: EventTarget | null) => target instanceof Element ? target.closest("[data-tooltip-id]") : null;
    const inPopup = (target: EventTarget | null) => target instanceof Element && !!target.closest("[data-tooltip-content]");
    const cancelClose = () => window.clearTimeout(closeTimer.current);
    const close = () => { pending = null; dismiss(); };
    const show = (anchor: Element, wait: number, descriptionTarget = anchor) => {
      cancelClose();
      if (activeRef.current?.anchor === anchor) {
        if (activeRef.current.descriptionTarget !== descriptionTarget) {
          const next = { ...activeRef.current, descriptionTarget };
          activeRef.current = next; setActive(next);
        }
        return;
      }
      if (pending === anchor && wait > 0) return;
      dismiss(); pending = anchor;
      openTimer.current = window.setTimeout(() => {
        pending = null;
        const id = anchor.getAttribute("data-tooltip-id") || "";
        const hint = hints.current.get(id);
        if (!anchor.isConnected || !hint) return;
        const next = { ...hint, id, anchor, descriptionTarget };
        activeRef.current = next; setActive(next);
      }, wait);
    };
    const leave = () => {
      window.clearTimeout(openTimer.current); pending = null;
      closeTimer.current = window.setTimeout(close, 100);
    };
    const enter = (event: PointerEvent) => {
      if (inPopup(event.target)) { cancelClose(); return; }
      if (event.pointerType === "touch") return;
      const anchor = trigger(event.target);
      if (anchor) show(anchor, delay);
    };
    const out = (event: PointerEvent) => {
      const anchor = trigger(event.target);
      if (anchor && !anchor.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null)
        && !inPopup(event.relatedTarget) && !activeRef.current?.descriptionTarget.matches(":focus-visible")) leave();
    };
    const focus = (event: FocusEvent) => {
      const anchor = trigger(event.target);
      if (anchor && event.target instanceof Element && event.target.matches(":focus-visible")) show(anchor, 0, event.target);
    };
    const blur = (event: FocusEvent) => { if (trigger(event.target) && !inPopup(event.relatedTarget)) close(); };
    const pointerDown = (event: PointerEvent) => { if (!inPopup(event.target)) close(); };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (activeRef.current) { event.preventDefault(); event.stopPropagation(); }
      close();
    };
    const scroll = (event: Event) => { if (!inPopup(event.target)) close(); };
    document.addEventListener("pointerover", enter, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", blur);
    document.addEventListener("pointerdown", pointerDown, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.clearTimeout(openTimer.current); window.clearTimeout(closeTimer.current);
      document.removeEventListener("pointerover", enter, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", blur);
      document.removeEventListener("pointerdown", pointerDown, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [delay, dismiss]);

  useEffect(() => {
    if (!active) return;
    const anchor = active.descriptionTarget;
    const previous = anchor.getAttribute("aria-describedby");
    anchor.setAttribute("aria-describedby", [previous, popupId].filter(Boolean).join(" "));
    return () => {
      const remaining = (anchor.getAttribute("aria-describedby") || "").split(/\s+/).filter(value => value && value !== popupId);
      if (remaining.length) anchor.setAttribute("aria-describedby", remaining.join(" "));
      else anchor.removeAttribute("aria-describedby");
    };
  }, [active?.descriptionTarget, popupId]);

  return <TooltipRegistry.Provider value={registry}>{children}{active && <TooltipContent id={popupId} anchor={active.anchor} side={active.side}
    onPointerEnter={() => window.clearTimeout(closeTimer.current)} onPointerLeave={() => { closeTimer.current = window.setTimeout(dismiss, 100); }}>{active.content}</TooltipContent>}</TooltipRegistry.Provider>;
}
