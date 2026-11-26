import { useMemo, useSyncExternalStore } from "react";
import { dockFocusKey, dockKey, dockPanel, isMiniPanel, miniPanel, panelIds, readDock, readDockFocus, without, type Dock, type Edge, type LivePanel } from "./liveDock";
import { settingsStorage } from "./settingsStorage";

type Layout = { layout: Dock; focus: LivePanel[] };
const listeners = new Set<() => void>();
function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function focusPanel(state: Layout, id: LivePanel): Layout {
  return { ...state, focus: [id, ...state.focus.filter(panel => panel !== id)] };
}

export function openDockApp(state: Layout, id: string, edge?: Edge): Layout {
  const panel = miniPanel(id);
  if (!isMiniPanel(panel)) throw Error("Invalid mini app ID.");
  const panels = panelIds(state.layout);
  if (!edge && panels.includes(panel)) return focusPanel(state, panel);
  const adjacent = state.focus.find(p => isMiniPanel(p) && panels.includes(p));
  const target = !edge && adjacent ? adjacent : "chat";
  return focusPanel({ ...state, layout: dockPanel(state.layout, panel, target, edge ?? (adjacent ? "center" : "right")) }, panel);
}

export function removeDockApps(state: Layout, ids: LivePanel[]): Layout {
  let layout = state.layout;
  for (const id of ids) if (isMiniPanel(id)) layout = without(layout, id) ?? layout;
  return { layout, focus: state.focus.filter(panel => !isMiniPanel(panel) || !ids.includes(panel)) };
}

export function useSessionDock(owner?: string, workspace?: string, conversation?: string) {
  const key = "nextbrowser.appearance.sessionDock." + JSON.stringify([owner, workspace, conversation]);
  // A session with no mini apps inherits the user's existing Processes layout.
  const snapshot = () => settingsStorage.getItem(key) ?? JSON.stringify([
    settingsStorage.getItem(dockKey), settingsStorage.getItem(dockFocusKey)
  ]);
  const raw = useSyncExternalStore(subscribe, snapshot);
  const decode = (value: string): Layout => {
    let layout = null, focus = null;
    try { const pair = JSON.parse(value); if (Array.isArray(pair)) [layout, focus] = pair; } catch { /* restore defaults */ }
    return { layout: readDock(typeof layout === "string" ? layout : null, settingsStorage.getItem("nextbrowser.appearance.liveBrowserWidthPercent")),
      focus: readDockFocus(typeof focus === "string" ? focus : null) };
  };
  const state = useMemo(() => decode(raw), [raw]);
  function update(change: (s: Layout) => Layout) {
    const previous = decode(snapshot());
    const next = change(previous);
    if (panelIds(next.layout).some(isMiniPanel)) {
      settingsStorage.setItem(key, JSON.stringify([JSON.stringify(next.layout), next.focus.join(",")]));
    } else {
      settingsStorage.removeItem(key);
      if (!panelIds(previous.layout).some(isMiniPanel)) {
        settingsStorage.setItem(dockKey, JSON.stringify(next.layout));
        settingsStorage.setItem(dockFocusKey, next.focus.join(","));
      }
    }
    for (const notify of listeners) notify();
  }
  return { ...state, setLayout: (layout: Dock) => update(s => ({ ...s, layout })),
    focusPanel: (panel: LivePanel) => update(s => focusPanel(s, panel)),
    open: (id: string, edge?: Edge) => update(s => openDockApp(s, id, edge)),
    remove: (ids: LivePanel[]) => update(s => removeDockApps(s, ids)) };
}
