import { translate } from "../shared/lib/i18n";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { glassSurfaceClassName, Glyph, Tooltip } from "../shared/ui";
import { settingsStorage } from "../lib/settingsStorage";
import { useStore } from "../store";
import { useLiveSessions } from "../lib/useLiveSessions";
import { chatLiveSession } from "../lib/profileNavigation";
import { AddMiniAppTab } from "./SessionMiniApps";
import "./mainViewNavigation.css";

const views = [
  { id: "chat", get label() { return translate("Project"); }, icon: "folder" },
  { id: "live", get label() { return translate("Processes"); }, icon: "activity" },
  { id: "automation", get label() { return translate("Automation"); }, icon: "branch" },
] as const;

type ViewId = typeof views[number]["id"];
type Position = { x: number; y: number };
type Group = { tabs: ViewId[]; position?: Position };
const storageKey = "nextbrowser.appearance.mainViewPills.v1";
const initial = (): Group[] => [{ tabs: views.map(view => view.id) }];
function restore(): Group[] {
  try {
    const saved: Group[] = JSON.parse(settingsStorage.getItem(storageKey) ?? "null");
    if (!Array.isArray(saved) || !saved.length || saved.length > views.length + 1 ||
      saved.some((g, i) => !Array.isArray(g?.tabs) || (i === 0 ? g.position !== undefined :
        !g.tabs.length || !g.position || ![g.position.x, g.position.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)))) return initial();
    const tabs = saved.flatMap(g => g.tabs);
    return tabs.length === views.length && views.every(v => tabs.includes(v.id)) ? saved : initial();
  } catch { return initial(); }
}
function positionStyle({ x, y }: Position): CSSProperties {
  return { left: x * 100 + "%", top: y * 100 + "%", transform: `translate(${-x * 100}%, ${-y * 100}%)` };
}

export function MainViewNavigation({ onSelectPrimary, primaryActive = true }: { onSelectPrimary?: () => void; primaryActive?: boolean } = {}) {
  const tab = useStore(state => state.tab);
  const select = useStore(state => state.setTab);
  const sessions = useLiveSessions();
  const [groups, setGroups] = useState(restore);
  const [surface, setSurface] = useState<HTMLElement | null>(null);
  const anchor = useCallback((node: HTMLDivElement | null) => setSurface(node?.closest<HTMLElement>(".chat, .tab-content") ?? null), []);
  const gesture = useRef<{ pointer: number; tab: ViewId; startX: number; startY: number; offsetX: number; offsetY: number; width: number; height: number; moved: boolean }>();
  const [drag, setDrag] = useState<{ tab: ViewId; position: Position; target?: number }>();
  const suppressClick = useRef(false);
  function cancel() { gesture.current = undefined; setDrag(undefined); }
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape" && gesture.current) cancel(); };
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", cancel);
    return () => { window.removeEventListener("keydown", escape); window.removeEventListener("blur", cancel); };
  }, []);
  function start(e: PointerEvent<HTMLButtonElement>, id: ViewId) {
    if (!e.isPrimary || e.button !== 0 || !surface) return;
    const box = e.currentTarget.getBoundingClientRect();
    suppressClick.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { pointer: e.pointerId, tab: id, startX: e.clientX, startY: e.clientY,
      offsetX: e.clientX - box.left, offsetY: e.clientY - box.top, width: box.width, height: box.height, moved: false };
  }
  function move(e: PointerEvent<HTMLButtonElement>, finish: boolean) {
    const g = gesture.current;
    if (!g || !surface || g.pointer !== e.pointerId) return;
    if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < 5) {
      if (finish) cancel();
      return;
    }
    g.moved = suppressClick.current = true;
    const box = surface.getBoundingClientRect();
    const fraction = (offset: number, span: number) => Math.min(1, Math.max(0, offset / Math.max(1, span)));
    const position = { x: fraction(e.clientX - box.left - g.offsetX, box.width - g.width),
      y: fraction(e.clientY - box.top - g.offsetY, box.height - g.height) };
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-main-pill]");
    const target = hit && surface.contains(hit) ? Number(hit.dataset.mainPill) : undefined;
    if (!finish) { setDrag({ tab: g.tab, position, target }); return; }
    if (target === undefined || !groups[target]?.tabs.includes(g.tab)) {
      const next = groups.map(group => ({ ...group, tabs: group.tabs.filter(t => t !== g.tab) }));
      if (target === undefined) next.push({ tabs: [g.tab], position });
      else next[target].tabs.push(g.tab);
      const kept = next.filter((group, i) => i === 0 || group.tabs.length);
      setGroups(kept);
      settingsStorage.setItem(storageKey, JSON.stringify(kept));
    }
    cancel();
  }
  const openBrowser = () => {
    const state = useStore.getState();
    const session = chatLiveSession(sessions, state.activeConversation(), state.profileChatOwners, state.selectedProfile);
    if (session) {
      const conversation = state.activeConversation();
      if (conversation && session.target.runtime !== 'multilogin') state.rememberConversationProfile(conversation.id, session.target.profile || '__default', session.target.runtime);
      state.openLiveSession(session.key);
    }
    else state.openLiveSession();
  };
  function pill(group: Group, i: number) {
    return <div key={i} className={`${glassSurfaceClassName} main-view-navigation`} data-main-pill={i}
      data-drop={drag?.target === i || undefined} hidden={i !== 0 && !group.tabs.length && !drag}
      style={group.position && positionStyle(group.position)} role="tablist" aria-label={i === 0 ? translate("Main views") : translate("Detached views")}>
      {group.tabs.map(id => {
        const view = views.find(v => v.id === id)!;
        return <Tooltip key={id} content={translate("%1 · Drag to detach or group", view.label)}><button type="button" role="tab"
          aria-label={translate("Open %1", view.label)} aria-selected={primaryActive && tab === id} data-moving={drag?.tab === id || undefined}
          onPointerDown={e => start(e, id)} onPointerMove={e => move(e, false)} onPointerUp={e => move(e, true)}
          onPointerCancel={cancel} onLostPointerCapture={() => { if (gesture.current) cancel(); }}
          onClick={e => { if (e.detail && suppressClick.current) return; onSelectPrimary?.(); id === "live" ? openBrowser() : select(id); }}>
          <Glyph name={view.icon} size={14} /><span>{view.label}</span>
        </button></Tooltip>;
      })}
      {i === 0 && <AddMiniAppTab />}
    </div>;
  }
  const moving = views.find(v => v.id === drag?.tab);
  return <div ref={anchor} className="main-view-anchor">
    {pill(groups[0], 0)}
    {surface && createPortal(<div className="main-view-floats">
      {groups.slice(1).map((group, i) => pill(group, i + 1))}
      {drag && moving && <div aria-hidden="true" className={`${glassSurfaceClassName} main-view-ghost`} style={positionStyle(drag.position)}>
        <Glyph name={moving.icon} size={14} /><span>{moving.label}</span>
      </div>}
    </div>, surface)}
  </div>;
}
