import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { RemoteControlClient, type RemoteLiveTab, type RemoteMediaStats, type RemoteStreamInfo } from "../remoteControl";
import { useStore } from "../store";
import { internalError } from "../lib/userFacingError";
import {
  MULTILOGIN_SELECTION_EVENT,
  multiloginSelectionForWorkspace,
  type MultiloginProfileSelection,
} from "../lib/multiloginSelection";
import type { LiveStreamTarget } from "../lib/liveStreamTarget";
import { Icon, Spinner } from "./Icon";
import { UserFacingError } from "./UserFacingError";

type LiveState = "idle" | "connecting" | "live" | "error";
const LIVE_VIEW_BACKGROUND_TTL_MS = 10 * 60 * 1000;

function modifierBits(event: MouseEvent | WheelEvent | KeyboardEvent) {
  return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
}

function buttonName(button: number) {
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return "left";
}

const NAVIGATION_KEYS = new Set([
  "Enter", "Tab", "Escape", " ", "Backspace", "Delete",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Home", "End", "PageUp", "PageDown",
]);

function shouldSendKeyEvent(event: KeyboardEvent) {
  return NAVIGATION_KEYS.has(event.key) ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey;
}

function mergeTabs(current: RemoteLiveTab[], incoming: RemoteLiveTab[]) {
  if (!current.length || incoming.some((tab) => tab.active)) return incoming;
  const next = new Map(current.map((tab) => [tab.target_id, tab]));
  for (const tab of incoming) next.set(tab.target_id, { ...next.get(tab.target_id), ...tab });
  return [...next.values()];
}

function clawbrowserTargetKey(profile?: string) {
  return `clawbrowser:${profile || "__default"}`;
}

function multiloginTargetKey(selection: MultiloginProfileSelection) {
  return `multilogin:${selection.kind}:${selection.id}`;
}

export function LiveView({ active }: { active: boolean }) {
  const s = useStore();
  const [sessionKey, setSessionKey] = useState<string>("");
  const [streamInfo, setStreamInfo] = useState<RemoteStreamInfo | null>(null);
  const [state, setState] = useState<LiveState>("idle");
  const [error, setError] = useState("");
  const [inputWarning, setInputWarning] = useState("");
  const [remoteTabs, setRemoteTabs] = useState<RemoteLiveTab[]>([]);
  const [pendingRemoteTab, setPendingRemoteTab] = useState("");
  const [mediaStats, setMediaStats] = useState<RemoteMediaStats>({});
  const [remoteMediaStream, setRemoteMediaStream] = useState<MediaStream | null>(null);
  const activeWorkspaceID = s.activeConversation()?.workspaceId;
  const [multiloginSelection, setMultiloginSelection] = useState<MultiloginProfileSelection | undefined>(
    () => multiloginSelectionForWorkspace(activeWorkspaceID),
  );
  const remoteClientRef = useRef<RemoteControlClient | null>(null);
  const remoteEmbedRef = useRef<HTMLDivElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const inactiveTimerRef = useRef<number | null>(null);
  const inputWarningTimerRef = useRef<number | null>(null);
  const pointerDragRef = useRef<{ pointerId: number; button: string; buttons: number; x: number; y: number } | null>(null);
  const runningProfiles = s.profiles.filter((profile) => s.statuses[profile.name] === "running");
  const defaultRunning = s.defaultSession?.status === "running";
  const profileOptions = [
    ...(multiloginSelection ? [{
      key: multiloginTargetKey(multiloginSelection),
      label: `${multiloginSelection.name} · Multilogin ${multiloginSelection.kind === "mobile" ? "phone" : "browser"}`,
      running: undefined,
      target: { runtime: "multilogin", selection: multiloginSelection } as LiveStreamTarget,
    }] : []),
    ...(defaultRunning ? [{
      key: clawbrowserTargetKey(),
      label: "default",
      running: true,
      target: { runtime: "clawbrowser" } as LiveStreamTarget,
    }] : []),
    ...s.profiles.map((profile) => ({
      key: clawbrowserTargetKey(profile.name),
      label: profile.name,
      running: s.statuses[profile.name] === "running",
      target: { runtime: "clawbrowser", profile: profile.name } as LiveStreamTarget,
    })),
  ];
  const launchTarget = sessionKey
    || (multiloginSelection ? multiloginTargetKey(multiloginSelection) : "")
    || (defaultRunning ? clawbrowserTargetKey() : "")
    || (s.selectedProfile ? clawbrowserTargetKey(s.selectedProfile) : "")
    || (s.profiles[0]?.name ? clawbrowserTargetKey(s.profiles[0].name) : "");
  const streamUrl = streamInfo?.viewer_url || streamInfo?.dashboard_url || "";
  const nativeViewer = !!streamInfo?.viewer_ws_url;

  const stop = () => {
    if (inactiveTimerRef.current !== null) {
      window.clearTimeout(inactiveTimerRef.current);
      inactiveTimerRef.current = null;
    }
    remoteClientRef.current?.close();
    remoteClientRef.current = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setRemoteMediaStream(null);
    setStreamInfo(null);
    setState("idle");
    setRemoteTabs([]);
    setPendingRemoteTab("");
    setMediaStats({});
    setInputWarning("");
  };

  const connectRemoteViewer = async (info: RemoteStreamInfo) => {
    if (!info.viewer_ws_url) {
      setState("live");
      return;
    }
    remoteClientRef.current?.close();
    const client = new RemoteControlClient(info, {
      onState: (next) => {
        if (next === "connected") setState("live");
        if (next === "error") {
          setError(internalError("We couldn't connect Live View.", "LIVE_VIEW_CONNECT_FAILED"));
          setState("error");
        }
      },
      onError: () => {
        setError(internalError("We couldn't connect Live View.", "LIVE_VIEW_CONNECT_FAILED"));
        setState("error");
      },
      onStream: (stream) => {
        setRemoteMediaStream(stream);
        setState("live");
      },
      onTabs: (tabs) => {
        setRemoteTabs((current) => mergeTabs(current, tabs));
        setPendingRemoteTab((pending) =>
          pending && tabs.some((tab) => tab.active && tab.target_id === pending) ? "" : pending,
        );
      },
      onTabSelected: (targetID) => {
        setPendingRemoteTab("");
        setRemoteTabs((tabs) => tabs.map((tab) => ({ ...tab, active: tab.target_id === targetID })));
      },
      onMediaStats: setMediaStats,
      onInputError: () => {
        setInputWarning("Input was not applied. Try again.");
        if (inputWarningTimerRef.current !== null) window.clearTimeout(inputWarningTimerRef.current);
        inputWarningTimerRef.current = window.setTimeout(() => {
          inputWarningTimerRef.current = null;
          setInputWarning("");
        }, 3000);
      },
    });
    remoteClientRef.current = client;
    await client.start();
  };

  const start = async (requestedKey = sessionKey) => {
    if (state === "connecting") return;
    setError("");
    setRemoteTabs([]);
    setPendingRemoteTab("");
    setState("connecting");
    try {
      const target = profileOptions.find((option) => option.key === requestedKey)?.target
        || ({ runtime: "clawbrowser" } as LiveStreamTarget);
      const info = await s.startRemoteStream(target);
      setStreamInfo(info);
      await connectRemoteViewer(info);
    } catch {
      setState("error");
      setError(internalError("We couldn't start Live View.", "LIVE_VIEW_START_FAILED"));
    }
  };

  const launchAndStream = async () => {
    if (state === "connecting") return;
    setError("");
    setState("connecting");
    try {
      const option = profileOptions.find((candidate) => candidate.key === launchTarget);
      if (option?.target.runtime === "multilogin") {
        setSessionKey(launchTarget);
        await start(launchTarget);
      } else if (option?.target.runtime === "clawbrowser") {
        setSessionKey(launchTarget);
        const profile = option.target.profile;
        if (profile && s.statuses[profile] !== "running") await s.startProfile(profile);
        if (!profile && !defaultRunning) await s.startDefaultSession();
        await s.refreshSessions();
        await start(launchTarget);
      } else {
        await s.startDefaultSession();
        await s.refreshSessions();
        await start(clawbrowserTargetKey());
      }
    } catch {
      setState("error");
      setError(internalError("We couldn't launch the remote session.", "REMOTE_SESSION_LAUNCH_FAILED"));
    }
  };

  const selectRemoteTab = (targetID: string) => {
    if (!targetID || !remoteClientRef.current) return;
    setPendingRemoteTab(targetID);
    remoteClientRef.current.selectTab(targetID);
  };

  const pointForEvent = (event: MouseEvent | WheelEvent) => {
    const embed = remoteEmbedRef.current;
    const video = remoteVideoRef.current;
    if (!embed || !video) return { x: 0, y: 0 };
    const rect = embed.getBoundingClientRect();
    const videoWidth = mediaStats.viewport_width || mediaStats.device_width || video.videoWidth || 1;
    const videoHeight = mediaStats.viewport_height || mediaStats.device_height || video.videoHeight || 1;
    const renderedScale = Math.min(rect.width / Math.max(1, video.videoWidth || videoWidth), rect.height / Math.max(1, video.videoHeight || videoHeight));
    const renderedWidth = Math.max(1, (video.videoWidth || videoWidth) * renderedScale);
    const renderedHeight = Math.max(1, (video.videoHeight || videoHeight) * renderedScale);
    const left = rect.left + (rect.width - renderedWidth) / 2;
    const top = rect.top + (rect.height - renderedHeight) / 2;
    const x = Math.round((event.clientX - left) * videoWidth / renderedWidth);
    const y = Math.round((event.clientY - top) * videoHeight / renderedHeight);
    return {
      x: Math.max(0, Math.min(videoWidth, x)),
      y: Math.max(0, Math.min(videoHeight, y)),
    };
  };

  useEffect(() => {
    const refreshSelection = () => setMultiloginSelection(multiloginSelectionForWorkspace(activeWorkspaceID));
    refreshSelection();
    window.addEventListener(MULTILOGIN_SELECTION_EVENT, refreshSelection);
    return () => window.removeEventListener(MULTILOGIN_SELECTION_EVENT, refreshSelection);
  }, [activeWorkspaceID]);

  useEffect(() => {
    if (!active) return;
    const runningProfile = s.profiles.find((profile) => s.statuses[profile.name] === "running")?.name;
    const current =
      (multiloginSelection ? multiloginTargetKey(multiloginSelection) : "") ||
      (s.selectedProfile ? clawbrowserTargetKey(s.selectedProfile) : "") ||
      (s.defaultSession?.status === "running" ? clawbrowserTargetKey() : "") ||
      (runningProfile ? clawbrowserTargetKey(runningProfile) : "") ||
      "";
    const targetChanged = !!current && current !== sessionKey;
    if (targetChanged && (remoteClientRef.current || streamInfo)) stop();
    setSessionKey(current);
    if (
      !remoteClientRef.current &&
      state !== "connecting" &&
      (!streamInfo || targetChanged) &&
      current &&
      (current.startsWith("multilogin:")
        || current === clawbrowserTargetKey()
        || s.statuses[current.replace(/^clawbrowser:/, "")] === "running")
    ) {
      void start(current);
    }
    // The component stays mounted while another app tab is active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, multiloginSelection]);

  useEffect(() => {
    if (active) {
      if (inactiveTimerRef.current !== null) {
        window.clearTimeout(inactiveTimerRef.current);
        inactiveTimerRef.current = null;
      }
      return;
    }
    if (!remoteClientRef.current && !streamInfo) return;
    inactiveTimerRef.current = window.setTimeout(() => {
      inactiveTimerRef.current = null;
      stop();
    }, LIVE_VIEW_BACKGROUND_TTL_MS);
    return () => {
      if (inactiveTimerRef.current !== null) {
        window.clearTimeout(inactiveTimerRef.current);
        inactiveTimerRef.current = null;
      }
    };
    // Only transitions between app tabs should reset the grace period.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => () => {
    if (inactiveTimerRef.current !== null) window.clearTimeout(inactiveTimerRef.current);
    if (inputWarningTimerRef.current !== null) window.clearTimeout(inputWarningTimerRef.current);
    remoteClientRef.current?.close();
  }, []);

  useEffect(() => {
    const video = remoteVideoRef.current;
    if (!video || !remoteMediaStream) return;
    video.srcObject = remoteMediaStream;
    void video.play().catch(() => undefined);
  }, [remoteMediaStream, state]);

  const releasePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = pointForEvent(event.nativeEvent);
    remoteClientRef.current?.sendInput({
      type: "mouse",
      payload: { event: "mouseReleased", x: point.x, y: point.y, button: drag.button, buttons: 0, clickCount: event.detail || 1, modifiers: modifierBits(event.nativeEvent) },
    });
    pointerDragRef.current = null;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button < 0) return;
    remoteEmbedRef.current?.focus();
    const point = pointForEvent(event.nativeEvent);
    const button = buttonName(event.button);
    const buttons = event.buttons || 1;
    remoteClientRef.current?.sendInput({
      type: "mouse",
      payload: { event: "mousePressed", x: point.x, y: point.y, button, buttons, clickCount: event.detail || 1, modifiers: modifierBits(event.nativeEvent) },
    });
    pointerDragRef.current = { pointerId: event.pointerId, button, buttons, x: point.x, y: point.y };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = pointForEvent(event.nativeEvent);
    drag.x = point.x;
    drag.y = point.y;
    if (event.buttons === 0) {
      releasePointer(event);
      return;
    }
    remoteClientRef.current?.sendInput({
      type: "mouse",
      payload: { event: "mouseMoved", x: point.x, y: point.y, button: drag.button, buttons: event.buttons || drag.buttons, modifiers: modifierBits(event.nativeEvent) },
    });
    event.preventDefault();
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    releasePointer(event);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.preventDefault();
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    releasePointer(event);
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const point = pointForEvent(event.nativeEvent);
    remoteClientRef.current?.sendInput({
      type: "wheel",
      payload: { x: point.x, y: point.y, deltaX: event.deltaX, deltaY: event.deltaY, modifiers: modifierBits(event.nativeEvent) },
    });
    event.preventDefault();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!shouldSendKeyEvent(event.nativeEvent)) {
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        remoteClientRef.current?.sendInput({ type: "text", payload: { text: event.key } });
        event.preventDefault();
      }
      return;
    }
    remoteClientRef.current?.sendInput({
      type: "key",
      payload: {
        event: event.type,
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        repeat: event.repeat,
      },
    });
    event.preventDefault();
  };

  const handleKeyUp = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!shouldSendKeyEvent(event.nativeEvent)) return;
    remoteClientRef.current?.sendInput({
      type: "key",
      payload: {
        event: event.type,
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        repeat: event.repeat,
      },
    });
    event.preventDefault();
  };

  return (
    <div className="live">
      <div className="live-controls">
        <Icon name="video.fill" size={18} className="accent-icon" />
        <select
          className="live-session-select"
          value={sessionKey}
          title="Choose profile to stream"
          onChange={(e) => {
            stop();
            setSessionKey(e.target.value);
          }}
        >
          <option value="">Select profile</option>
          {profileOptions.map((p) => (
            <option key={p.key} value={p.key}>
              {p.running === false ? `${p.label} (stopped)` : p.label}
            </option>
          ))}
        </select>
        <span className={"live-pill " + state}>
          {state === "live" ? "live" : state}
        </span>
        <span className="muted small">
          {streamInfo && !nativeViewer
            ? "Dashboard Remote Control viewer is embedded for this stream."
            : "Native Remote Control viewer is used when supported."}
        </span>
        <span className="spacer" />
        {streamUrl && (
          <a className="btn-bordered" href={streamUrl} target="_blank" rel="noreferrer" title="Open Remote Control in your browser">
            <Icon name="arrow.up.forward.app" size={14} />
            Open link
          </a>
        )}
        {state === "live" && (
          <button className="btn-bordered live-stop-btn" onClick={stop}>
            <Icon name="stop.fill" size={14} className="error" />
            Stop
          </button>
        )}
      </div>
      <hr className="divider" />

      {remoteTabs.length > 0 && (
        <div className="remote-tabs-bar" aria-label="Remote browser tabs">
          {remoteTabs.map((tab) => {
            const active = tab.active || tab.target_id === pendingRemoteTab;
            const title = tab.title || tab.url || "Untitled";
            return (
              <button
                key={tab.target_id}
                className={"remote-tab-chip" + (active ? " active" : "")}
                onClick={() => selectRemoteTab(tab.target_id)}
                disabled={active || !!pendingRemoteTab}
                title={tab.url || title}
              >
                <span className="remote-tab-title">{title}</span>
                {tab.loading && <span className="remote-tab-dot" />}
              </button>
            );
          })}
        </div>
      )}

      <div className="live-stage remote-live-stage">
        {state === "connecting" && (
          <div className="live-empty-panel">
            <Spinner size={18} />
            <strong>Starting live view...</strong>
            <p className="muted small">Creating a Remote Control session through nextctl.</p>
          </div>
        )}
        {state === "error" && (
          <div className="live-error">
            <Icon name="exclamationmark.triangle.fill" size={32} className="warn" />
            <p>
              <UserFacingError
                message={error || internalError("We couldn't connect Live View.", "LIVE_VIEW_CONNECT_FAILED")}
                surface="live_view"
              />
            </p>
            <button className="primary live-stream-btn" onClick={() => launchAndStream()}>
              <Icon name="play.fill" size={12} />
              Launch to stream
            </button>
          </div>
        )}
        {state === "idle" && !streamInfo && (
          <div className="live-empty-panel">
            <Icon name="video.fill" size={34} className="muted" />
            <strong>{runningProfiles.length || defaultRunning || multiloginSelection ? "Stream is off" : "No active profiles"}</strong>
            <p className="muted">
              {runningProfiles.length || defaultRunning || multiloginSelection
                ? "Start Remote Control for the selected running profile."
                : "Launch a profile and open Remote Control."}
            </p>
            <button
              className="btn-bordered-prominent live-stream-btn"
              onClick={() => launchAndStream()}
              title={runningProfiles.length || defaultRunning || multiloginSelection ? "Start live view" : "Launch selected profile and open live view"}
            >
              <Icon name="play.fill" size={12} />
              {runningProfiles.length || defaultRunning || multiloginSelection ? "Stream" : "Launch to stream"}
            </button>
          </div>
        )}
        {streamInfo && state !== "error" && nativeViewer && (
          <div
            ref={remoteEmbedRef}
            className="remote-live-embed"
            tabIndex={0}
            onPointerCancel={handlePointerCancel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onWheel={handleWheel}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
          >
            <video ref={remoteVideoRef} className="remote-live-video" autoPlay muted playsInline />
          </div>
        )}
        {streamInfo && state !== "error" && !nativeViewer && streamUrl && (
          <webview
            className="remote-live-webview"
            src={streamUrl}
          />
        )}
      </div>
      {state === "live" && (
        <div className="live-hint muted small">
          {inputWarning || (nativeViewer
            ? "Remote Control is running natively in NextBrowser. Click, scroll, type, or use the tab bar above."
            : "Remote Control is embedded in NextBrowser through the backend dashboard viewer.")}
        </div>
      )}
    </div>
  );
}
