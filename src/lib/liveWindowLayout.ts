const overlaySelector = [
  ".live-controls-trigger", ".app-titlebar", ".app-live > .sidebar",
  ".shared-popover", "[data-tooltip-content]", ".live-input-warning",
].join(",");

function visibleRect(element: Element) {
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height || getComputedStyle(element).visibility !== "visible") return null;
  return rect;
}

const box = (rect: DOMRect) => ({
  x: rect.left, y: rect.top, width: rect.width, height: rect.height,
});

function overlayRadius(element: Element, rect: DOMRect) {
  const radius = getComputedStyle(element).borderTopLeftRadius;
  const half = Math.min(rect.width, rect.height) / 2;
  const value = Number.parseFloat(radius);
  if (!Number.isFinite(value)) return 0;
  return radius.endsWith("%") ? Math.min(half, half * value / 50) : Math.min(half, value);
}

export function liveWindowLayout(stage: HTMLElement | null, active: boolean) {
  const bounds = active && stage ? visibleRect(stage) : null;
  // A modal owns the entire app surface, including its backdrop.
  if (!bounds || Array.from(document.querySelectorAll(".modal-overlay")).some(visibleRect)) return { hidden: true };
  const holes = Array.from(document.querySelectorAll(overlaySelector)).flatMap(element => {
    const rect = visibleRect(element);
    if (!rect || rect.right <= bounds.left || rect.left >= bounds.right ||
        rect.bottom <= bounds.top || rect.top >= bounds.bottom) return [];
    return [{ ...box(rect), radius: overlayRadius(element, rect) }];
  });
  const fill = bounds.right >= innerWidth - 1 && bounds.bottom >= innerHeight - 1;
  return { bounds: box(bounds), fill, holes };
}
