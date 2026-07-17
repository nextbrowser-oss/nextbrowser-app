import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent } from "react";
import { RemoteControlClient, type RemoteLiveTab, type RemoteMediaStats, type RemoteStreamInfo } from "../remoteControl";
import { useStore } from "../store";
import { Icon, Spinner } from "./Icon";

type LiveState = "idle" | "connecting" | "live" | "error";

function modifierBits(event: MouseEvent | WheelEvent | KeyboardEvent) {
  return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
}

function buttonName(button: number) {
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return "left";
}

function shouldSendKeyEvent(event: KeyboardEvent) {
  return new Set(["Enter", "Tab", "Escape", " ", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]).has(event.key) ||
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

export function LiveView() {
  const s = useStore();
  const [sessionKey, setSessionKey] = useState<string>("");
  const [streamInfo, setStreamInfo] = useState<RemoteStreamInfo | null>(null);
  const [state, setState] = useState<LiveState>("idle");
  const [error, setError] = useState("");
  const [remoteTabs, setRemoteTabs] = useState<RemoteLiveTab[]>([]);
  const [pendingRemoteTab, setPendingRemoteTab] = useState("");
  const [mediaStats, setMediaStats] = useState<RemoteMediaStats>({});
  const [remoteMediaStream, setRemoteMediaStream] = useState<MediaStream | null>(null);
  const remoteClientRef = useRef<RemoteControlClient | null>(null);
  const remoteEmbedRef = useRef<HTMLDivElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const runningProfiles = s.profiles.filter((profile) => s.statuses[profile.name] === "running");
  const defaultRunning = s.defaultSession?.status === "running";
  const profileOptions = [
    ...(defaultRunning ? [{ name: "__default", label: "default", running: true }] : []),
    ...s.profiles.map((profile) => ({
      name: profile.name,
      label: profile.name,
      running: s.statuses[profile.name] === "running",
    })),
  ];
  const launchTarget = sessionKey || (defaultRunning ? "__default" : "") || s.selectedProfile || s.profiles[0]?.name || "";
  const streamUrl = streamInfo?.viewer_url || streamInfo?.dashboard_url || "";
  const nativeViewer = !!streamInfo?.viewer_ws_url;

  const stop = () => {
    remoteClientRef.current?.close();
    remoteClientRef.current = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setRemoteMediaStream(null);
    setStreamInfo(null);
    setState("idle");
    setRemoteTabs([]);
    setPendingRemoteTab("");
    setMediaStats({});
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
        if (next === "error") setState("error");
      },
      onError: (message) => {
        setError(message);
        setState("error");
      },
      onStream: setRemoteMediaStream,
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
      const info = await s.startRemoteStream(requestedKey === "__default" ? undefined : requestedKey || undefined);
      setStreamInfo(info);
      await connectRemoteViewer(info);
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const launchAndStream = async () => {
    if (state === "connecting") return;
    setError("");
    setState("connecting");
    try {
      if (launchTarget) {
        setSessionKey(launchTarget);
        if (launchTarget !== "__default" && s.statuses[launchTarget] !== "running") await s.startProfile(launchTarget);
        if (launchTarget === "__default" && !defaultRunning) await s.startDefaultSession();
        await s.refreshSessions();
        await start(launchTarget);
      } else {
        await s.startDefaultSession();
        await s.refreshSessions();
        await start(undefined);
      }
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : String(e));
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
    const current =
      s.selectedProfile ||
      (s.defaultSession?.status === "running" ? "__default" : "") ||
      s.profiles.find((profile) => s.statuses[profile.name] === "running")?.name ||
      "";
    setSessionKey(current);
    if (current && (current === "__default" || s.statuses[current] === "running")) void start(current);
    return () => remoteClientRef.current?.close();
    // LiveView is mounted afresh on tab selection, matching Swift onAppear.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const video = remoteVideoRef.current;
    if (!video || !remoteMediaStream) return;
    video.srcObject = remoteMediaStream;
    void video.play().catch(() => undefined);
  }, [remoteMediaStream, state]);

  const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    remoteEmbedRef.current?.focus();
    const point = pointForEvent(event.nativeEvent);
    remoteClientRef.current?.sendInput({
      type: "mouse",
      payload: { event: "mousePressed", x: point.x, y: point.y, button: buttonName(event.button), buttons: 1, clickCount: event.detail || 1, modifiers: modifierBits(event.nativeEvent) },
    });
    event.preventDefault();
  };

  const handleMouseUp = (event: ReactMouseEvent<HTMLDivElement>) => {
    const point = pointForEvent(event.nativeEvent);
    remoteClientRef.current?.sendInput({
      type: "mouse",
      payload: { event: "mouseReleased", x: point.x, y: point.y, button: buttonName(event.button), buttons: 0, clickCount: event.detail || 1, modifiers: modifierBits(event.nativeEvent) },
    });
    event.preventDefault();
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
            <option key={p.name} value={p.name}>
              {p.running ? p.label : `${p.label} (stopped)`}
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

      {state === "live" && remoteTabs.length > 0 && (
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
            <p>{error || "Connection failed"}</p>
            <button className="primary live-stream-btn" onClick={() => launchAndStream()}>
              <Icon name="play.fill" size={12} />
              Launch to stream
            </button>
          </div>
        )}
        {state === "idle" && !streamInfo && (
          <div className="live-empty-panel">
            <Icon name="video.fill" size={34} className="muted" />
            <strong>{runningProfiles.length || defaultRunning ? "Stream is off" : "No active profiles"}</strong>
            <p className="muted">
              {runningProfiles.length || defaultRunning
                ? "Start Remote Control for the selected running profile."
                : "Launch a profile and open Remote Control."}
            </p>
            <button
              className="btn-bordered-prominent live-stream-btn"
              onClick={() => launchAndStream()}
              title={runningProfiles.length || defaultRunning ? "Start live view" : "Launch selected profile and open live view"}
            >
              <Icon name="play.fill" size={12} />
              {runningProfiles.length || defaultRunning ? "Stream" : "Launch to stream"}
            </button>
          </div>
        )}
        {streamInfo && state !== "error" && nativeViewer && (
          <div
            ref={remoteEmbedRef}
            className="remote-live-embed"
            tabIndex={0}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
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
          {nativeViewer
            ? "Remote Control is running natively in NextBrowser. Click, scroll, type, or use the tab bar above."
            : "Remote Control is embedded in NextBrowser through the backend dashboard viewer."}
        </div>
      )}
    </div>
  );
}
