import { translate } from "../shared/lib/i18n";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type RefCallback } from "react";
import { dockFrames, dockPanel, dropAt, isMiniPanel, limitSplit, miniPanel, panelIds, resizeDock, type Divider, type Dock, type Edge, type LivePanel, type Rect } from "../lib/liveDock";
import type { AppInfo } from "../lib/miniAppLibrary";
import { OpenGuest } from "./MiniAppGuest";
import { MiniAppIcon } from "./MiniAppIcon";
import { MainViewNavigation } from "./MainViewNavigation";
import { AddMiniAppTab } from "./SessionMiniApps";
import { useProjectsPinned } from "../lib/projectsPinned";
import { glassSurfaceClassName, Glyph, IconButton, Tooltip } from "../shared/ui";
import { SessionTitle } from "./SessionTitle";
import "./liveDock.css";

type Drop = NonNullable<ReturnType<typeof dropAt>>;
type Gesture = { id: number; capture: HTMLElement; x: number; y: number } & (
  { kind: "panel"; panel: LivePanel; moved: boolean } | { kind: "size"; divider: Divider }
);
const builtInNames = { live: "Processes", chat: "Chat", projects: "Projects" };
const rectStyle = ({ left, top, width, height }: Rect): CSSProperties => ({ left, top, width, height });

export function ChatLiveWorkspace({ visible, live, browserOpen, onToggle, focus, onFocusPanel, projectsRef, chat, children, layout, setLayout, apps, owner, onCloseApp, onGuestReady }: {
  visible: boolean; live: boolean; browserOpen: boolean; onToggle: () => void;
  focus: LivePanel[]; onFocusPanel: (panel: LivePanel) => void; projectsRef: RefCallback<HTMLDivElement>;
  chat: ReactNode; children: ReactNode; layout: Dock; setLayout: (next: Dock) => void;
  apps: readonly (AppInfo & { generation: string })[]; owner?: string; onCloseApp: (panel: LivePanel) => void;
  onGuestReady?: (id: string) => void;
}) {
  const area = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [heights, setHeights] = useState<Record<string, number>>({});
  const appByPanel = new Map(apps.map(app => [miniPanel(app.id), app]));
  const opened = panelIds(layout).filter(isMiniPanel).filter(panel => appByPanel.has(panel));
  const docked = live || opened.length > 0;
  const name = (panel: LivePanel) => isMiniPanel(panel) ? appByPanel.get(panel)?.name ?? panel.slice(5) : builtInNames[panel];
  const [resizing, setResizing] = useState<Dock>();
  const [dragging, setDragging] = useState<LivePanel>();
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [drop, setDrop] = useState<Drop>();
  const gesture = useRef<Gesture>();
  const suppressClick = useRef(false);

  const projectsPinned = useProjectsPinned();
  const { groups, dividers } = dockFrames(resizing ?? layout, bounds, browserOpen, focus, projectsPinned || !live, tab => !isMiniPanel(tab) || appByPanel.has(tab));
  const membership = groups.map(group => group.tabs.join("|")).join("/");
  useLayoutEffect(() => {
    const workspace = area.current;
    if (!docked || !visible || !workspace) return;
    const bars = Array.from(workspace.querySelectorAll<HTMLElement>(".live-side-toolbar"));
    const measure = () => {
      const width = workspace.clientWidth, height = workspace.clientHeight;
      setBounds(prev => prev.width === width && prev.height === height ? prev : { left: 0, top: 0, width, height });
      const measured = Object.fromEntries(bars.map(bar => [bar.dataset.group!, bar.offsetHeight]));
      setHeights(prev => Object.keys(prev).length === bars.length && bars.every(bar => prev[bar.dataset.group!] === bar.offsetHeight) ? prev : measured);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    bars.forEach(bar => observer.observe(bar));
    return () => observer.disconnect();
  }, [docked, visible, membership]);
  const groupOf = (panel: LivePanel) => groups.find(group => group.selected === panel);
  const shownBrowser = Boolean(groupOf("live"));
  function contentStyle(panel: LivePanel) {
    const group = groupOf(panel);
    if (!docked || !group) return;
    const inset = heights[group.tabs.join("|")] ?? 0;
    return rectStyle({ ...group, top: group.top + inset, height: Math.max(0, group.height - inset) });
  }

  function place(panel: LivePanel, dest: Drop) {
    setLayout(dockPanel(layout, panel, dest.target, dest.edge));
    if (panel === "live" && !browserOpen) onToggle();
    onFocusPanel(panel);
  }
  function cancel() {
    const current = gesture.current;
    gesture.current = undefined;
    if (current?.capture.hasPointerCapture(current.id)) current.capture.releasePointerCapture(current.id);
    setDragging(undefined);
    setDrop(undefined);
    setResizing(undefined);
  }
  useEffect(() => {
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && gesture.current) { event.preventDefault(); cancel(); }
    };
    window.addEventListener("keydown", escape, true);
    window.addEventListener("blur", cancel);
    return () => { window.removeEventListener("keydown", escape, true); window.removeEventListener("blur", cancel); };
  }, []);
  useEffect(() => { if (!docked || !visible) cancel(); }, [docked, visible]);

  function point(event: PointerEvent) {
    const box = area.current!.getBoundingClientRect();
    return { x: (event.clientX - box.left) * bounds.width / (box.width || 1),
      y: (event.clientY - box.top) * bounds.height / (box.height || 1) };
  }
  function begin(event: PointerEvent<HTMLElement>, panel: LivePanel | Divider) {
    if (!event.isPrimary || event.button !== 0 || gesture.current) return;
    const capture = event.currentTarget;
    capture.setPointerCapture(event.pointerId);
    const start = { id: event.pointerId, capture, ...point(event) };
    if (typeof panel === "string") gesture.current = { ...start, kind: "panel", panel, moved: false };
    else {
      event.preventDefault();
      capture.focus();
      gesture.current = { ...start, kind: "size", divider: panel };
      setResizing(layout);
    }
  }
  function move(event: PointerEvent<HTMLDivElement>, finish = false) {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    const { x, y } = point(event);
    if (start.kind === "size") {
      const { axis, path, percent, span } = start.divider;
      const delta = axis === "x" ? x - start.x : y - start.y;
      const next = resizeDock(layout, path, percent + 100 * delta / Math.max(1, span));
      if (finish) setLayout(next); else setResizing(next);
    } else if (start.moved || Math.hypot(x - start.x, y - start.y) >= 5) {
      start.moved = true;
      suppressClick.current = true;
      const dest = dropAt(groups, start.panel, x, y);
      if (dest) {
        const targetGroup = groups.find(group => group.tabs.includes(dest.target));
        const bar = Array.from(area.current!.querySelectorAll<HTMLElement>(".live-side-toolbar"))
          .find(bar => bar.dataset.group === targetGroup?.tabs.join("|"));
        const pill = bar?.querySelector(".live-workspace-pill")?.getBoundingClientRect();
        if (pill && event.clientX >= pill.left && event.clientX <= pill.right && event.clientY >= pill.top && event.clientY <= pill.bottom) dest.edge = "center";
      }
      if (finish && dest) place(start.panel, dest);
      else { setDragging(start.panel); setPointer({ x, y }); setDrop(dest); }
    }
    if (finish) cancel();
  }
  function dockShortcut(event: KeyboardEvent, panel: LivePanel) {
    if (!event.altKey || !event.shiftKey) return false;
    const edge = ({ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "top", ArrowDown: "bottom", Enter: "center" } as Record<string, Edge>)[event.key];
    const target = groups.find(group => !group.tabs.includes(panel))?.selected ?? groups.flatMap(group => group.tabs).find(tab => tab !== panel);
    if (!edge || !target) return false;
    event.preventDefault();
    place(panel, { target, edge });
    requestAnimationFrame(() => document.getElementById("live-tab-" + panel)?.focus());
    return true;
  }
  const preview = dragging && drop ? dockFrames(dockPanel(layout, dragging, drop.target, drop.edge), bounds, browserOpen || dragging === "live",
    [dragging, ...focus], projectsPinned || !live, tab => !isMiniPanel(tab) || appByPanel.has(tab)).groups.find(group => group.selected === dragging) : undefined;
  return <div ref={area} className="chat-live-workspace" hidden={!visible} data-live={docked || undefined}
    data-dock-dragging={dragging} data-dock-resizing={resizing ? true : undefined}
    onPointerDownCapture={() => { suppressClick.current = false; }} onPointerMove={event => move(event)}
    onPointerUp={event => move(event, true)} onPointerCancel={cancel}
    onLostPointerCapture={event => { if (gesture.current?.id === event.pointerId) cancel(); }}
    onClickCapture={event => {
      if (event.detail && suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; }
    }}>
    <section id="live-browser-pane" aria-label={translate("Live browser")} className="live-browser-pane" style={contentStyle("live")} hidden={!live || !shownBrowser}>{children}</section>
    {docked && dividers.map(divider => {
      const vertical = divider.axis === "x";
      return <div key={divider.path} role="separator" aria-label={divider.path || !live ? translate("Resize workspace panels") : translate("Resize Live browser")}
        aria-orientation={vertical ? "vertical" : "horizontal"} aria-valuemin={20} aria-valuemax={80}
        aria-valuenow={divider.percent} aria-valuetext={divider.percent + "%"} style={rectStyle(divider)}
        tabIndex={0} className="live-splitter" data-resizing={resizing && gesture.current?.kind === "size" && gesture.current.divider.path === divider.path || undefined}
        onPointerDown={event => begin(event, divider)}
        onKeyDown={event => {
          const less = vertical ? "ArrowLeft" : "ArrowUp", more = vertical ? "ArrowRight" : "ArrowDown";
          if (![less, more, "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? 20 : event.key === "End" ? 80 : limitSplit(divider.percent + (event.key === less ? -2 : 2));
          setLayout(resizeDock(layout, divider.path, next));
        }} />;
    })}
    <div className="live-side-pane">
      {docked && groups.map(group => <header key={group.tabs.join("|")} data-group={group.tabs.join("|")} className="live-side-toolbar" style={{ left: group.left, top: group.top, width: group.width }}>
        <div className={glassSurfaceClassName + " live-workspace-pill"}>
          {!live && group.tabs.includes("chat") && <MainViewNavigation onSelectPrimary={() => onFocusPanel("chat")} primaryActive={group.selected === "chat"} />}
          <div className="live-workspace-tabs" role="tablist" aria-label={group.tabs.map(name).join(" / ") + " panels"}>
          {group.tabs.map((tab, i) => (!live && tab === "chat") ? null : <Tooltip key={tab} content={translate("Drag %1 to move panel", name(tab))}>
            <button type="button" role="tab" id={"live-tab-" + tab} aria-controls={tab === "live" ? "live-browser-pane" : "live-side-" + tab}
              data-lifted={dragging === tab || undefined} aria-selected={group.selected === tab} tabIndex={group.selected === tab || (!live && group.selected === "chat" && tab === group.tabs.find(isMiniPanel)) ? 0 : -1} onClick={() => onFocusPanel(tab)}
              onPointerDown={event => begin(event, tab)}
              onKeyDown={event => {
                if (dockShortcut(event, tab) || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const tabs = group.tabs;
                const next = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[tabs.length - 1]
                  : tabs[(i + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
                onFocusPanel(next);
                (document.getElementById("live-tab-" + next) ?? area.current?.querySelector<HTMLElement>('[aria-label="Open Project"]'))?.focus();
              }}>{tab === "live" && <Glyph name="activity" size={14} />}{isMiniPanel(tab) && <MiniAppIcon app={appByPanel.get(tab)!} />}{name(tab)}</button></Tooltip>)}
          </div>
          {live && group.tabs.includes("chat") && <><SessionTitle /><AddMiniAppTab /></>}
          {isMiniPanel(group.selected) && <IconButton label={"Close " + name(group.selected)} appearance="plain" size="small" onClick={() => onCloseApp(group.selected)}><Glyph name="x" size={14} /></IconButton>}
          {live && ((group.selected === "live") || (!browserOpen && group.tabs.includes("chat"))) &&
            <IconButton label={browserOpen ? translate("Hide browser") : translate("Show browser")} appearance="plain" size="small"
              onClick={() => { onToggle(); if (!browserOpen) onFocusPanel("live"); }}><Glyph name={browserOpen ? "minus" : "activity"} size={14} /></IconButton>}
        </div>
      </header>)}
      <div id="live-side-chat" className="live-side-chat" role={live ? "tabpanel" : undefined} style={contentStyle("chat")}
        aria-labelledby={live ? "live-tab-chat" : undefined} hidden={docked && !groupOf("chat")}>{chat}</div>
      {live && <div ref={projectsRef} id="live-side-projects" className={glassSurfaceClassName + " projects-dock live-side-projects"}
        style={contentStyle("projects")} role="tabpanel" aria-labelledby="live-tab-projects" hidden={!groupOf("projects")} />}
    </div>
    {visible && owner && opened.map(panel => {
      const app = appByPanel.get(panel)!;
      const selected = !!groupOf(panel);
      return <section key={owner + "/" + app.generation} className="live-mini-pane" id={"live-side-" + panel}
        role="tabpanel" aria-labelledby={"live-tab-" + panel} style={contentStyle(panel)} hidden={!selected}>
        <OpenGuest owner={owner} id={app.id} name={app.name} onReady={selected ? onGuestReady : undefined} />
      </section>;
    })}
    {dragging && <div className="live-dock-shield" aria-hidden="true">
      <span className={glassSurfaceClassName + " live-dock-chip"} style={{ left: pointer.x, top: pointer.y }}>{name(dragging)}</span>
      {preview && drop && <div className="live-dock-preview" style={rectStyle(preview)}>
        <span>{drop.edge === "center" ? translate("Group %1 with %2", name(dragging), name(drop.target)) : translate("Move %1 %2", name(dragging), drop.edge)}</span>
      </div>}
    </div>}
  </div>;
}
