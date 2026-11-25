export const livePanels = ["live", "chat", "projects"] as const;
export type LivePanel = typeof livePanels[number];
export type Edge = "left" | "right" | "top" | "bottom" | "center";
type Axis = "x" | "y";
export type Dock = { tabs: LivePanel[] } | { axis: Axis; percent: number; first: Dock; second: Dock };
export interface Rect { left: number; top: number; width: number; height: number }
export interface Group extends Rect { tabs: LivePanel[]; selected: LivePanel }
export interface Divider extends Rect { path: string; axis: Axis; span: number; percent: number }
export const dockKey = "nextbrowser.appearance.liveDock.v1";
export const dockFocusKey = "nextbrowser.appearance.liveDockFocus.v1";
export function readDockFocus(saved: string | null): LivePanel[] {
  const panels = saved?.split(",");
  if (panels?.length === livePanels.length && livePanels.every(panel => panels.includes(panel))) return panels as LivePanel[];
  return ["chat", "projects", "live"];
}
export const limitSplit = (percent: number) => Math.min(80, Math.max(20, Math.round(percent)));

export function readDock(saved: string | null, legacyWidth: string | null): Dock {
  const seen = new Set<LivePanel>();
  function valid(node: Dock | null, depth: number): boolean {
    if (!node || typeof node !== "object" || depth > 2) return false;
    if ("tabs" in node) return Array.isArray(node.tabs) && node.tabs.length > 0 && node.tabs.every(tab => {
      if (!livePanels.includes(tab) || seen.has(tab)) return false;
      seen.add(tab);
      return true;
    });
    return (node.axis === "x" || node.axis === "y") && Number.isInteger(node.percent)
      && node.percent >= 20 && node.percent <= 80 && valid(node.first, depth + 1) && valid(node.second, depth + 1);
  }
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (valid(parsed, 0) && seen.size === livePanels.length) return parsed;
    } catch { /* Fall back to the original workspace layout. */ }
  }
  const width = Number(legacyWidth);
  return { axis: "x", percent: width >= 30 && width <= 65 ? Math.round(width) : 52,
    first: { tabs: ["live"] }, second: { tabs: ["chat", "projects"] } };
}

function without(node: Dock, panel: LivePanel): Dock | null {
  if ("tabs" in node) {
    const tabs = node.tabs.filter(tab => tab !== panel);
    return tabs.length ? { tabs } : null;
  }
  const first = without(node.first, panel), second = without(node.second, panel);
  return first && second ? { ...node, first, second } : first ?? second;
}

export function dockPanel(layout: Dock, panel: LivePanel, target: LivePanel, edge: Edge): Dock {
  if (panel === target) return layout;
  function insert(node: Dock): Dock {
    if (!("tabs" in node)) return { ...node, first: insert(node.first), second: insert(node.second) };
    if (!node.tabs.includes(target)) return node;
    if (edge === "center") return { tabs: [...node.tabs, panel] };
    const before = edge === "left" || edge === "top";
    const own = { tabs: [panel] };
    return { axis: edge === "left" || edge === "right" ? "x" : "y", percent: 50,
      first: before ? own : node, second: before ? node : own };
  }
  const rest = without(layout, panel);
  return rest ? insert(rest) : layout;
}

export function resizeDock(node: Dock, path: string, percent: number): Dock {
  if ("tabs" in node) return node;
  if (!path) return { ...node, percent: limitSplit(percent) };
  const child = path[0] === "0" ? "first" : "second";
  return { ...node, [child]: resizeDock(node[child], path.slice(1), percent) };
}

export function dockFrames(layout: Dock, bounds: Rect, browserOpen: boolean, focus: LivePanel[], projectsPinned = false) {
  const groups: Group[] = [], dividers: Divider[] = [];
  const shown = (tab: LivePanel) => (tab !== "live" || browserOpen) && (tab !== "projects" || !projectsPinned);
  const visible = (node: Dock): boolean => "tabs" in node ? node.tabs.some(shown) : visible(node.first) || visible(node.second);
  function visit(node: Dock, rect: Rect, path: string) {
    if ("tabs" in node) {
      const tabs = node.tabs.filter(shown);
      const selected = focus.find(tab => tabs.includes(tab)) ?? tabs[0];
      if (selected) groups.push({ ...rect, tabs, selected });
      return;
    }
    if (!visible(node.first)) return visit(node.second, rect, path + "1");
    if (!visible(node.second)) return visit(node.first, rect, path + "0");
    const [size, start] = node.axis === "x" ? ["width", "left"] as const : ["height", "top"] as const;
    const gap = Math.min(9, rect[size]), span = rect[size] - gap;
    const first = Math.round(span * node.percent / 100);
    visit(node.first, { ...rect, [size]: first }, path + "0");
    dividers.push({ ...rect, [start]: rect[start] + first, [size]: gap, path, axis: node.axis, span, percent: node.percent });
    visit(node.second, { ...rect, [start]: rect[start] + first + gap, [size]: span - first }, path + "1");
  }
  visit(layout, bounds, "");
  return { groups, dividers };
}

export function dropAt(groups: Group[], panel: LivePanel, x: number, y: number) {
  const group = groups.find(g => x >= g.left && y >= g.top && x < g.left + g.width && y < g.top + g.height);
  if (!group) return;
  const target = group.selected !== panel ? group.selected : group.tabs.find(tab => tab !== panel);
  if (!target) return;
  const dx = (x - group.left) / group.width, dy = (y - group.top) / group.height;
  const distance = Math.min(dx, 1 - dx, dy, 1 - dy);
  let edge: Edge = "center";
  if (group.tabs.includes(panel) || distance < 0.28) {
    if (distance === dx) edge = "left";
    else if (distance === 1 - dx) edge = "right";
    else edge = distance === dy ? "top" : "bottom";
  }
  return { target, edge };
}
