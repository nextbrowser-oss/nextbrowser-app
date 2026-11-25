import { describe, expect, it } from "vitest";
import { dockFrames, dockPanel, dropAt, livePanels, readDock, readDockFocus, resizeDock } from "./liveDock";

const initial = readDock(null, "59");
const bounds = { left: 0, top: 0, width: 1209, height: 809 };
const focus = [...livePanels];

describe("Live workspace layout", () => {
  it("restores the selected tab in each group and rejects corrupt focus settings", () => {
    const focus = readDockFocus("projects,live,chat");
    expect(dockFrames(initial, bounds, true, focus).groups.map(g => g.selected)).toEqual(["live", "projects"]);
    expect(readDockFocus("projects,projects,chat")).toEqual(readDockFocus(null));
  });
  it("migrates the old divider and falls back from corrupt or incomplete layouts", () => {
    expect(initial).toMatchObject({ percent: 59 });
    for (const invalid of ["{}", "null", "bad", '{"tabs":["live","chat","chat"]}', '{"tabs":["projects"]}']) {
      expect(readDock(invalid, "59")).toEqual(initial);
    }
  });
  it("preserves all three panels after repeated moves and restoration", () => {
    let layout = initial;
    for (const edge of ["left", "right", "top", "bottom", "center"] as const) {
      for (const from of livePanels) {
        for (const to of livePanels) {
          layout = dockPanel(layout, from, to, edge);
          expect(readDock(JSON.stringify(layout), null)).toEqual(layout);
          const frames = dockFrames(layout, bounds, true, focus);
          expect(frames.groups.flatMap(g => g.tabs).sort()).toEqual([...livePanels].sort());
        }
      }
    }
  });
  it("keeps a nested divider adjustable with the browser hidden", () => {
    const layout = dockPanel(initial, "projects", "chat", "bottom");
    const hidden = dockFrames(layout, bounds, false, focus);
    expect(hidden.dividers).toHaveLength(1);
    const adjusted = resizeDock(layout, hidden.dividers[0].path, 60);
    const restored = dockFrames(adjusted, bounds, true, focus);
    expect(restored.dividers.map(d => d.percent)).toEqual([59, 60]);
    expect(restored.groups.at(-1)).toMatchObject({ top: 489, height: 320 });
  });
  it("reclaims the space of a pinned Projects panel and restores its previous split", () => {
    const layout = dockPanel(initial, "projects", "live", "bottom");
    const before = dockFrames(layout, bounds, true, focus);
    const pinned = dockFrames(layout, bounds, true, focus, true);
    expect(pinned.groups.map(group => group.tabs)).toEqual([["live"], ["chat"]]);
    expect(pinned.dividers).toHaveLength(1);
    const hidden = dockFrames(layout, bounds, false, focus, true);
    expect(hidden.dividers).toEqual([]);
    expect(hidden.groups).toEqual([{ ...bounds, tabs: ["chat"], selected: "chat" }]);
    expect(dockFrames(layout, bounds, true, focus, false)).toEqual(before);
  });
  it("drops at edges or in the central tab group and excludes dividers and outside drops", () => {
    const { groups } = dockFrames(initial, bounds, true, ["projects", "chat", "live"]);
    expect(dropAt(groups, "chat", 0, 400)).toEqual({ target: "live", edge: "left" });
    expect(dropAt(groups, "chat", 350, 800)).toEqual({ target: "live", edge: "bottom" });
    expect(dropAt(groups, "live", 1000, 400)).toEqual({ target: "projects", edge: "center" });
    expect(dropAt(groups, "chat", 900, 400)).toEqual({ target: "projects", edge: "left" });
    expect(dropAt(groups, "live", 710, 1)).toBeUndefined();
    expect(dropAt(groups, "chat", -1, 100)).toBeUndefined();
  });
});
