import type { liveWindowLayout } from "./liveWindowLayout";

type Layout = ReturnType<typeof liveWindowLayout>;
type Box = { x: number; y: number; width: number; height: number; radius?: number };
export type LiveWindowFrame = { x: number; y: number; width: number; height: number };

// Corner radius of a macOS 26 browser window, in points.
const BROWSER_CORNER_RADIUS = 20;

const round = (value: number) => Math.round(value * 100) / 100;

// Clockwise rounded rectangle; with `reverse` it runs counter-clockwise and,
// under the nonzero rule, cuts a hole into the clockwise shapes around it.
function roundedRect({ x, y, width, height }: Box, radius: number, reverse = false) {
  const r = round(Math.max(0, Math.min(radius, width / 2, height / 2)));
  const [left, top, right, bottom] = [x, y, x + width, y + height].map(round);
  if (reverse) {
    return `M${left + r} ${top} A${r} ${r} 0 0 0 ${left} ${top + r} V${bottom - r} A${r} ${r} 0 0 0 ${left + r} ${bottom} ` +
      `H${right - r} A${r} ${r} 0 0 0 ${right} ${bottom - r} V${top + r} A${r} ${r} 0 0 0 ${right - r} ${top} Z`;
  }
  return `M${left + r} ${top} H${right - r} A${r} ${r} 0 0 1 ${right} ${top + r} V${bottom - r} A${r} ${r} 0 0 1 ${right - r} ${bottom} ` +
    `H${left + r} A${r} ${r} 0 0 1 ${left} ${bottom - r} V${top + r} A${r} ${r} 0 0 1 ${left + r} ${top} Z`;
}

function intersect(a: Box, b: Box) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/**
 * The clip path that removes the panel from the app surface but keeps its
 * controls. `browser` is the browser window's real frame when macOS kept it
 * smaller than the panel; only that part becomes transparent.
 */
export function liveWindowHolePath(layout: Layout, surface: Box, zoom: number, browser?: LiveWindowFrame | null) {
  if (!("bounds" in layout) || !layout.bounds) return null;
  const panel = browser ? intersect(layout.bounds, browser) : layout.bounds;
  if (!panel) return null;
  const local = (box: Box) => ({ ...box, x: box.x - surface.x, y: box.y - surface.y });
  return `path(nonzero, "${[
    roundedRect({ x: 0, y: 0, width: surface.width, height: surface.height }, 0),
    roundedRect(local(panel), BROWSER_CORNER_RADIUS / zoom, true),
    ...layout.holes.map(hole => roundedRect(local(hole), hole.radius)),
  ].join(" ")}")`;
}

/**
 * macOS: the app window is transparent, and the local browser window lies
 * directly below it. Cut the Processes panel out of the app surface so the
 * browser shows through, as the Windows helper does with a window region.
 */
export function setLiveWindowHole(layout: Layout | null, browser?: LiveWindowFrame | null) {
  const root = document.documentElement;
  const surface = document.querySelector<HTMLElement>(".desktop-shell");
  const box = surface?.getBoundingClientRect();
  // The page zoom: CSS pixels to window points.
  const zoom = window.outerWidth > 0 && window.innerWidth > 0 ? window.outerWidth / window.innerWidth : 1;
  const path = layout && box ? liveWindowHolePath(layout, box, zoom, browser) : null;
  if (!path) {
    delete root.dataset.liveHole;
    root.style.removeProperty("--live-hole");
    return;
  }
  root.style.setProperty("--live-hole", path);
  root.dataset.liveHole = "";
}
