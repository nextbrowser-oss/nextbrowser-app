import { describe, expect, it } from "vitest";
import { dockFrames, dockPanel, miniPanel, panelIds, readDock, readDockFocus, resizeDock } from "./liveDock";
import { openDockApp, removeDockApps } from "./sessionDock";

const base = { layout: readDock(null, "59"), focus: readDockFocus(null) };
const area = { left: 0, top: 0, width: 1009, height: 609 };
const board = miniPanel("kanban");
const music = miniPanel("music-player");

describe("session mini app panels", () => {
  it("opens beside the project at half width and groups the next app in the side pane", () => {
    const first = openDockApp(base, "kanban");
    const second = openDockApp(first, "music-player");
    const frames = dockFrames(second.layout, area, false, second.focus, true);
    expect(frames.groups.map(g => [g.selected, g.width])).toEqual([["chat", 500], [music, 500]]);
    expect(frames.groups[1].tabs).toEqual([board, music]);
    const reopened = openDockApp(second, "kanban");
    expect(reopened.layout).toBe(second.layout);
    expect(reopened.focus[0]).toBe(board);
  });

  it("restores moved tabs, nested dividers and focus; closing the last app reclaims its space", () => {
    let state = openDockApp(openDockApp(base, "kanban", "left"), "music-player", "bottom");
    state.layout = dockPanel(state.layout, board, music, "right");
    const [divider] = dockFrames(state.layout, area, false, state.focus, true).dividers;
    state.layout = resizeDock(state.layout, divider.path, 65);
    expect(readDock(JSON.stringify(state.layout), null)).toEqual(state.layout);
    expect(readDockFocus(state.focus.join(","))).toEqual(state.focus);
    const grouped = openDockApp(state, "kanban", "center");
    expect(dockFrames(grouped.layout, area, false, grouped.focus, true).groups.find(g => g.selected === board)?.tabs).toContain("chat");
    const closed = removeDockApps(grouped, [board, music]);
    expect(panelIds(closed.layout).sort()).toEqual(["chat", "live", "projects"]);
    expect(dockFrames(closed.layout, area, false, closed.focus, true).groups[0].width).toBe(area.width);
  });
});
