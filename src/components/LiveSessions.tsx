import { useEffect, useState } from "react";
import { cancelNextctlRun, nextctlRun, type Envelope } from "../nextctl";
import { liveRuntimeLabel, type LiveSessionOption } from "../lib/liveSessions";
import { multiloginSessionName } from "../lib/liveStreamTarget";
import { Dialog, Glyph, IconButton, Popover } from "../shared/ui";
import { Icon } from "./Icon";
import "./liveSessions.css";

export const CREATE_LIVE_PROFILE_EVENT = "nextbrowser:create-live-profile";

const createLiveProfile = () => window.dispatchEvent(new Event(CREATE_LIVE_PROFILE_EVENT));
const screenIcon = (session: LiveSessionOption) =>
  session.target.runtime === "multilogin" && session.target.selection.kind === "mobile" ? "iphone" : "display";

function SessionSearch({ query, onChange }: { query: string; onChange: (query: string) => void }) {
  return <label className="live-session-search">
    <Icon name="magnifyingglass" size={14} />
    <input type="search" aria-label="Search Live sessions" placeholder="Search sessions" value={query}
      onChange={event => onChange(event.target.value)} />
  </label>;
}

function matchingSessions(sessions: LiveSessionOption[], query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return sessions.filter(session => {
    const text = `${session.label} ${liveRuntimeLabel(session.target)}`.toLocaleLowerCase();
    return words.every(word => text.includes(word));
  });
}

function SessionRows({ sessions, onOpen }: { sessions: LiveSessionOption[]; onOpen: (key: string) => void }) {
  return <div className="live-session-rows">
    {sessions.map(session => <button type="button" className="live-session-row" key={session.key} onClick={() => onOpen(session.key)}>
      <Icon name={screenIcon(session)} size={15} />
      <span><strong>{session.label}</strong><small>{liveRuntimeLabel(session.target)}</small></span>
    </button>)}
  </div>;
}

function StartSession({ sessions, query, onOpen, onCreate }: {
  sessions: LiveSessionOption[]; query: string; onOpen: (key: string) => void; onCreate: () => void;
}) {
  return <>
    <SessionRows sessions={matchingSessions(sessions.filter(session => !session.running), query)} onOpen={onOpen} />
    <button type="button" className="live-session-row live-create-profile" onClick={onCreate}>
      <Icon name="plus" size={15} /> Create browser profile
    </button>
  </>;
}

export function LiveSessionsPopover({ sessions, selected, onOverview, onOpen }: {
  sessions: LiveSessionOption[]; selected: boolean; onOverview: () => void; onOpen: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [starting, setStarting] = useState(false);
  const active = sessions.filter(session => session.running);
  const filtered = matchingSessions(active, query);
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) { setQuery(""); setStarting(false); }
  };
  const choose = (key: string) => { changeOpen(false); onOpen(key); };
  return <Popover label="Live sessions" open={open} onOpenChange={changeOpen} openOnHover side="right" align="start"
    className="live-sessions-popover shared-scrollbarless" trigger={props => <button {...props}
      className={`sidebar-destination${selected ? " active" : ""}`}
      aria-current={selected ? "page" : undefined} aria-label="Open Live sessions"
      onClick={() => { changeOpen(false); onOverview(); }}>
      <Glyph name="monitor" /><span className="sidebar-destination-label">Live</span>
      {sessions.length > 0 && <span className="sidebar-destination-count" aria-hidden="true">{active.length}/{sessions.length}</span>}
    </button>}>
    <div className="live-session-tools">
      <SessionSearch query={query} onChange={setQuery} />
      <IconButton label={starting ? "Show active sessions" : "New Live session"} appearance="plain" size="small"
        onClick={() => { setQuery(""); setStarting(!starting); }}>
        <Icon name={starting ? "chevron.left" : "plus"} size={15} />
      </IconButton>
    </div>
    {starting
      ? <StartSession sessions={sessions} query={query} onOpen={choose} onCreate={() => { changeOpen(false); createLiveProfile(); }} />
      : filtered.length > 0
        ? <SessionRows sessions={filtered} onOpen={choose} />
        : <p className="live-session-empty">{query.trim() ? "No matching sessions" : "No active sessions"}</p>}
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
      <Icon name={screenIcon(session)} size={26} />
      {failed ? "Preview unavailable" : "Loading preview…"}
    </span>}
  </div>;
}

export function LiveSessionsGrid({ sessions, onOpen }: { sessions: LiveSessionOption[]; onOpen: (key: string) => void }) {
  const [query, setQuery] = useState("");
  const [startQuery, setStartQuery] = useState("");
  const [starting, setStarting] = useState(false);
  const filtered = matchingSessions(sessions.filter(session => session.running), query);
  const openPicker = () => { setStartQuery(""); setStarting(true); };
  return <section className="live-sessions-overview" aria-label="Live sessions">
    <header className="live-sessions-header">
      <h1>Live</h1>
      <div className="live-session-tools">
        <SessionSearch query={query} onChange={setQuery} />
        <IconButton label="New Live session" text="New session" size="small" onClick={openPicker}><Icon name="plus" size={14} /></IconButton>
      </div>
    </header>
    {filtered.length > 0 ? <div className="live-sessions-grid">
      {filtered.map(session => <button key={session.key} type="button" className="live-session-card"
        aria-label={`Open ${session.label}`} onClick={() => onOpen(session.key)}>
        <SessionPreview session={session} />
        <span className="live-session-card-label"><strong>{session.label}</strong><small>{liveRuntimeLabel(session.target)}</small></span>
      </button>)}
    </div> : <p className="live-session-empty">{query.trim() ? "No matching sessions" : "No active sessions"}</p>}
    {starting && <Dialog title="New Live session" className="live-session-picker" onClose={() => setStarting(false)}>
      <SessionSearch query={startQuery} onChange={setStartQuery} />
      <StartSession sessions={sessions} query={startQuery}
        onOpen={key => { setStarting(false); onOpen(key); }}
        onCreate={() => { setStarting(false); createLiveProfile(); }} />
    </Dialog>}
  </section>;
}
