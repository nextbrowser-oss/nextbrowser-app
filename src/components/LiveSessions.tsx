import { useEffect, useMemo, useState } from "react";
import { cancelNextctlRun, nextctlRun, type Envelope } from "../nextctl";
import { liveRuntimeLabel, type LiveSessionOption } from "../lib/liveSessions";
import { multiloginSessionName } from "../lib/liveStreamTarget";
import { Glyph, IconButton, Popover } from "../shared/ui";
import { useStore } from "../store";
import { openProfileActions } from "../lib/profileNavigation";
import { clearMultiloginSelection, setMultiloginSelection } from "../lib/multiloginSelection";
import { Icon } from "./Icon";
import "./liveSessions.css";

export const CREATE_LIVE_PROFILE_EVENT = "nextbrowser:create-live-profile";

const createLiveProfile = () => window.dispatchEvent(new Event(CREATE_LIVE_PROFILE_EVENT));
function ScreenIcon({ session, size }: { session: LiveSessionOption; size: number }) {
  return <Glyph name={session.target.runtime === "multilogin" && session.target.selection.kind === "mobile" ? "phone" : "monitor"} size={size} />;
}

function SessionSearch({ query, onChange }: { query: string; onChange: (query: string) => void }) {
  return <label className="live-session-search">
    <Icon name="magnifyingglass" size={14} />
    <input type="search" aria-label="Search profiles" placeholder="Search profiles" value={query}
      onChange={event => onChange(event.target.value)} />
  </label>;
}

const profileNames = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function useVisibleProfiles(sessions: LiveSessionOption[], query: string) {
  const direction = useStore(s => s.profileNameSort);
  return useMemo(() => {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const visible = sessions.filter(session => {
      const text = `${session.label} ${liveRuntimeLabel(session.target)}`.toLocaleLowerCase();
      return words.every(word => text.includes(word));
    });
    if (direction) {
      const sign = direction === "asc" ? 1 : -1;
      visible.sort((a, b) => sign * profileNames.compare(a.label, b.label));
    }
    return visible;
  }, [sessions, query, direction]);
}

function ProfileListTools({ query, onChange, onCreate, compact = false }: {
  query: string; onChange: (query: string) => void; onCreate: () => void; compact?: boolean;
}) {
  const direction = useStore(s => s.profileNameSort);
  const toggleSort = useStore(s => s.toggleProfileNameSort);
  const nextOrder = direction === "asc" ? "от Я до А" : "от А до Я";
  const sortLabel = direction ? `Сортировать · ${direction === "asc" ? "А → Я" : "Я → А"}` : "Сортировать";
  return <div className="profile-list-tools">
    <div className="live-session-tools">
      <SessionSearch query={query} onChange={onChange} />
      <IconButton label="Create browser profile" text={compact ? undefined : "Create profile"}
        appearance={compact ? "plain" : "glass"} size="small" onClick={onCreate}>
        <Icon name="plus" size={compact ? 15 : 14} />
      </IconButton>
    </div>
    <IconButton className="profile-name-sort" data-direction={direction} label={sortLabel}
      text="Сортировать" hint={`Сортировать по имени ${nextOrder}`}
      size="small" appearance="plain" onClick={toggleSort}>
      <Glyph name="arrow-down" size={12} />
    </IconButton>
  </div>;
}

function SessionRows({ sessions, onOpen }: { sessions: LiveSessionOption[]; onOpen: (key: string) => void }) {
  return <div className="live-session-rows">
    {sessions.map(session => <button type="button" className="live-session-row" key={session.key} onClick={() => onOpen(session.key)}>
      <ScreenIcon session={session} size={15} />
      <span><strong>{session.label}</strong><small>{liveRuntimeLabel(session.target)} · {session.running ? "Running" : "Stopped"}</small></span>
    </button>)}
  </div>;
}

export function LiveSessionsPopover({ sessions, selected, onOverview, onOpen }: {
  sessions: LiveSessionOption[]; selected: boolean; onOverview: () => void; onOpen: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const active = sessions.filter(session => session.running);
  const filtered = useVisibleProfiles(sessions, query);
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };
  const choose = (key: string) => { changeOpen(false); onOpen(key); };
  return <Popover label="Processes" open={open} onOpenChange={changeOpen} openOnHover side="right" align="start"
    className="live-sessions-popover shared-scrollbarless" trigger={props => <button {...props}
      className={`sidebar-destination${selected ? " active" : ""}`}
      aria-current={selected ? "page" : undefined} aria-label="Open Processes"
      onClick={() => { changeOpen(false); onOverview(); }}>
      <Glyph name="activity" />
      {sessions.length > 0 && <span className="sidebar-destination-count" aria-hidden="true">{active.length}/{sessions.length}</span>}
    </button>}>
    <div className="rail-popover-heading">Processes</div>
    <ProfileListTools query={query} onChange={setQuery} compact onCreate={() => { changeOpen(false); createLiveProfile(); }} />
    {filtered.length > 0
        ? <SessionRows sessions={filtered} onOpen={choose} />
        : <p className="live-session-empty">{query.trim() ? "No matching profiles" : "No profiles yet"}</p>}
  </Popover>;
}

const PREVIEW_REFRESH_MS = 8_000;
const PREVIEW_TIMEOUT_MS = 8_000;

function previewArgs(target: LiveSessionOption["target"]) {
  if (target.runtime !== "multilogin") {
    return ["--runtime", target.runtime, ...(target.profile ? ["--profile", target.profile] : []), "screenshot", "--format", "json"];
  }
  const { selection } = target;
  const folder = selection.folderId ? ["--multilogin-folder-id", selection.folderId] : [];
  if (selection.kind === "mobile") {
    return ["--runtime", "multilogin", ...folder, "--format", "json", "mobile", "adb", "shell", selection.id, "--", "screencap -p | base64"];
  }
  return ["--runtime", "multilogin", ...folder, "--profile", multiloginSessionName(selection),
    "--multilogin-profile-id", selection.id, "screenshot", "--format", "json"];
}

type PreviewPayload = { data?: string; mobile_adb?: { output?: string } };

function SessionPreview({ session }: { session: LiveSessionOption }) {
  const [image, setImage] = useState<string>();
  const [failed, setFailed] = useState(false);
  const args = JSON.stringify(previewArgs(session.target));
  useEffect(() => {
    let requestId: string | undefined;
    let timer: number | undefined;
    let disposed = false;
    const capture = async () => {
      if (document.hidden) return;
      requestId = `live-preview-${crypto.randomUUID()}`;
      try {
        const result = await nextctlRun(JSON.parse(args), undefined, { requestId, timeoutMs: PREVIEW_TIMEOUT_MS });
        const envelope = JSON.parse(result.stdout) as Envelope<PreviewPayload>;
        const png = (envelope.data?.data ?? envelope.data?.mobile_adb?.output)?.replace(/\s/g, "");
        if (result.code !== 0 || !envelope.ok || !png?.startsWith("iVBORw0KGgo")) throw new Error("Preview unavailable");
        if (!disposed) { setImage(`data:image/png;base64,${png}`); setFailed(false); }
      } catch {
        if (!disposed) setFailed(true);
      } finally {
        requestId = undefined;
      }
    };
    const refresh = async () => {
      await capture();
      if (!disposed) timer = window.setTimeout(refresh, PREVIEW_REFRESH_MS);
    };
    void refresh();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      if (requestId) void cancelNextctlRun(requestId).catch(() => undefined);
    };
  }, [args]);

  return <div className="live-session-preview">
    {image ? <><img alt="" src={image} draggable={false} />{failed && <small>Last available preview</small>}</> : <span>
      <ScreenIcon session={session} size={26} />
      {failed ? "Preview unavailable" : "Loading preview…"}
    </span>}
  </div>;
}

export function LiveSessionsGrid({ sessions, onOpen }: { sessions: LiveSessionOption[]; onOpen: (key: string) => void }) {
  const [query, setQuery] = useState("");
  const filtered = useVisibleProfiles(sessions, query);
  return <section className="live-sessions-overview" aria-label="Processes">
    <header className="live-sessions-header">
      <h1>Processes</h1>
      <ProfileListTools query={query} onChange={setQuery} onCreate={createLiveProfile} />
    </header>
    {filtered.length > 0 ? <div className="live-sessions-grid">
      {filtered.map(session => <ProfileCard key={session.key} session={session} onOpen={onOpen} />)}
    </div> : <p className="live-session-empty">{query.trim() ? "No matching profiles" : "No profiles yet. Create a browser profile to get started."}</p>}
  </section>;
}

function ProfileCard({ session, onOpen }: { session: LiveSessionOption; onOpen: (key: string) => void }) {
  const name = session.target.runtime === "multilogin" ? undefined : session.target.profile || "__default";
  const profile = useStore(s => s.profiles.find(profile => profile.name === name));
  const selected = useStore(s => name && s.selectedProfile === name);
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [error, setError] = useState<string>();
  const settings = (element: HTMLElement) => {
    if (name) openProfileActions(name, element);
    else { setAnchor(element); setMenuOpen(true); }
  };
  const connection = profile?.proxy_mode === "manual" ? "Personal proxy" : profile?.proxy_mode === "direct" ? "No proxy" : profile ? "Managed proxy" : "";
  return <article className="live-session-card" onContextMenu={event => {
    event.preventDefault(); settings(event.currentTarget.querySelector<HTMLButtonElement>(".live-session-open")!);
  }} onKeyDown={event => {
    if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
      event.preventDefault(); settings(event.currentTarget.querySelector<HTMLButtonElement>(".live-session-open")!);
    }
  }}>
    <button type="button" className="live-session-open" data-profile-key={session.key} aria-label={`Open ${session.label}`} onClick={() => onOpen(session.key)}>
      {session.running ? <SessionPreview session={session} /> : <div className="live-session-preview"><span><ScreenIcon session={session} size={26} />Stopped · Click to open</span></div>}
      <span className="live-session-card-label"><strong>{session.label}</strong><small>{liveRuntimeLabel(session.target)} · {session.running ? "Running" : "Stopped"}{selected ? " · Selected for chat" : ""}</small>
        {connection && <small>{connection}{profile?.country ? ` · ${profile.country.toUpperCase()}` : ""}</small>}
      </span>
    </button>
    <IconButton label={`Settings for ${session.label}`} appearance="plain" size="small" className="profile-card-settings" onClick={event => settings(event.currentTarget)}><Glyph name="sliders" size={17} /></IconButton>
    {session.target.runtime === "multilogin" && <Popover label={`Profile actions for ${session.label}`} open={menuOpen} onOpenChange={setMenuOpen}
      anchorElement={anchor} trigger={() => null} className="profile-actions-popover" side="bottom" align="end">
      <strong>{session.label}</strong>
      <button className="live-session-row" onClick={() => {
        if (session.target.runtime !== "multilogin") return;
        const workspaceId = useStore.getState().activeWorkspaceId;
        if (!workspaceId) return;
        useStore.getState().selectProfile(undefined);
        setMultiloginSelection(workspaceId, { ...session.target.selection, active: true });
        setMenuOpen(false);
      }}>Use in chat</button>
      <button className="live-session-row" onClick={() => { setMenuOpen(false); useStore.getState().setTab("connectors"); }}>Connection settings</button>
      {session.running && <button className="live-session-row" onClick={async () => {
        if (session.target.runtime !== "multilogin") return;
        try { await useStore.getState().setMultiloginRunning(session.target.selection, false); setMenuOpen(false); }
        catch { setError("Could not stop this profile. Try again."); }
      }}>Stop profile</button>}
      {!session.running && <button className="live-session-row" onClick={() => { clearMultiloginSelection(useStore.getState().activeWorkspaceId); setMenuOpen(false); }}>Remove from workspace</button>}
      {error && <p role="alert">{error}</p>}
    </Popover>}
  </article>;
}
