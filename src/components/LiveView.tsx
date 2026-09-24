import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { RemoteControlClient, type InputEnvelope, type RemoteLiveTab, type RemoteMediaStats, type RemoteStreamInfo } from "../remoteControl";
import { invoke } from "../electronBridge";
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
type CamoufoxFrame = { data: string; width: number; height: number; tabs?: Array<{ id: string; title?: string; url?: string; active?: boolean }> };

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
  const [localViewerId, setLocalViewerId] = useState("");
  const [localFrame, setLocalFrame] = useState("");
  const activeWorkspaceID = s.activeWorkspaceId;
  const workspace = s.workspaces.find((item) => item.id === activeWorkspaceID);
  const workspaceProfiles = s.profiles.filter((profile) => workspace?.profileNames.includes(profile.name));
  const [multiloginSelection, setMultiloginSelection] = useState<MultiloginProfileSelection | undefined>(
    () => multiloginSelectionForWorkspace(activeWorkspaceID),
  );
  const remoteClientRef = useRef<RemoteControlClient | null>(null);
  const remoteEmbedRef = useRef<HTMLDivElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localImageRef = useRef<HTMLImageElement | null>(null);
  const keyboardSinkRef = useRef<HTMLTextAreaElement | null>(null);
  const localViewerIdRef = useRef("");
  const localFrameTimerRef = useRef<number | null>(null);
  const localInputTailRef = useRef<Promise<unknown>>(Promise.resolve());
  const streamGeneration = useRef(0);
  const inactiveTimerRef = useRef<number | null>(null);
  const inputWarningTimerRef = useRef<number | null>(null);
  const pointerDragRef = useRef<{ pointerId: number; button: string; buttons: number; x: number; y: number } | null>(null);
  const runningProfiles = workspaceProfiles.filter((profile) => s.statuses[profile.name] === "running");
  const profileOptions = [
    ...(multiloginSelection ? [{
      key: multiloginTargetKey(multiloginSelection),
      label: `${multiloginSelection.name} · Multilogin ${multiloginSelection.kind === "mobile" ? "phone" : "browser"}`,
      running: undefined,
      target: { runtime: "multilogin", selection: multiloginSelection } as LiveStreamTarget,
    }] : []),
    ...workspaceProfiles.map((profile) => ({
      key: clawbrowserTargetKey(profile.name),
      label: profile.name,
      running: s.statuses[profile.name] === "running",
      target: { runtime: workspace?.profileToolsets[profile.name] ?? "clawbrowser", profile: profile.name } as LiveStreamTarget,
    })),
  ];
  const launchTarget = sessionKey
    || (multiloginSelection ? multiloginTargetKey(multiloginSelection) : "")
    || (workspaceProfiles.some((profile) => profile.name === s.selectedProfile) ? clawbrowserTargetKey(s.selectedProfile) : "")
    || (workspaceProfiles[0]?.name ? clawbrowserTargetKey(workspaceProfiles[0].name) : "");
  const streamUrl = streamInfo?.viewer_url || streamInfo?.dashboard_url || "";
  const nativeViewer = !!streamInfo?.viewer_ws_url;

  const stop = () => {
    streamGeneration.current += 1;
    if (inactiveTimerRef.current !== null) {
      window.clearTimeout(inactiveTimerRef.current);
      inactiveTimerRef.current = null;
    }
    remoteClientRef.current?.close();
    remoteClientRef.current = null;
    if (localFrameTimerRef.current !== null) window.clearTimeout(localFrameTimerRef.current);
    localFrameTimerRef.current = null;
    if (localViewerIdRef.current) void invoke("camoufox_live_close", { id: localViewerIdRef.current }).catch(() => undefined);
    localViewerIdRef.current = "";
    setLocalViewerId("");
    setLocalFrame("");
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setRemoteMediaStream(null);
    setStreamInfo(null);
    setState("idle");
    setRemoteTabs([]);
    setPendingRemoteTab("");
    setMediaStats({});
    setInputWarning("");
    pointerDragRef.current = null;
  };

  const sendLiveInput = (message: InputEnvelope) => {
    const id = localViewerIdRef.current;
    if (!id) return remoteClientRef.current?.sendInput(message);
    localInputTailRef.current = localInputTailRef.current.catch(() => undefined)
      .then(() => invoke("camoufox_live_input", { id, message }))
      .catch(() => { setInputWarning("Input was not applied. Try again."); });
  };

  const pollCamoufoxFrame = async (id: string, generation: number) => {
    if (generation !== streamGeneration.current || localViewerIdRef.current !== id) return;
    try {
      const frame = await invoke<CamoufoxFrame>("camoufox_live_frame", { id });
      if (generation !== streamGeneration.current || localViewerIdRef.current !== id) return;
      setLocalFrame(`data:image/png;base64,${frame.data}`);
      setMediaStats({ viewport_width: frame.width, viewport_height: frame.height });
      setRemoteTabs((frame.tabs || []).map((tab) => ({ target_id: tab.id, title: tab.title, url: tab.url, active: tab.active })));
      setState("live");
      localFrameTimerRef.current = window.setTimeout(() => void pollCamoufoxFrame(id, generation), 350);
    } catch {
      if (generation !== streamGeneration.current || localViewerIdRef.current !== id) return;
      localViewerIdRef.current = "";
      setLocalViewerId("");
      setLocalFrame("");
      void invoke("camoufox_live_close", { id }).catch(() => undefined);
      setError(internalError("We couldn't connect Live View.", "LIVE_VIEW_CONNECT_FAILED"));
      setState("error");
    }
  };

  const connectRemoteViewer = async (info: RemoteStreamInfo) => {
    const generation = streamGeneration.current;
    const current = () => generation === streamGeneration.current && useStore.getState().activeWorkspaceId === activeWorkspaceID;
    if (!info.viewer_ws_url) {
      setState("live");
      return;
    }
    remoteClientRef.current?.close();
    const client = new RemoteControlClient(info, {
      onState: (next) => {
        if (!current()) return;
        if (next === "connected") setState("live");
        if (next === "error") {
          setError(internalError("We couldn't connect Live View.", "LIVE_VIEW_CONNECT_FAILED"));
          setState("error");
        }
      },
      onError: () => {
        if (!current()) return;
        setError(internalError("We couldn't connect Live View.", "LIVE_VIEW_CONNECT_FAILED"));
        setState("error");
      },
      onStream: (stream) => {
        if (!current()) return;
        setRemoteMediaStream(stream);
        setState("live");
      },
      onTabs: (tabs) => {
        if (!current()) return;
        setRemoteTabs((current) => mergeTabs(current, tabs));
        setPendingRemoteTab((pending) =>
          pending && tabs.some((tab) => tab.active && tab.target_id === pending) ? "" : pending,
        );
      },
      onTabSelected: (targetID) => {
        if (!current()) return;
        setPendingRemoteTab("");
        setRemoteTabs((tabs) => tabs.map((tab) => ({ ...tab, active: tab.target_id === targetID })));
      },
      onMediaStats: (stats) => { if (current()) setMediaStats(stats); },
      onInputError: () => {
        if (!current()) return;
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

  useEffect(() => {
    const target = profileOptions.find((option) => option.key === sessionKey)?.target;
    if ((streamInfo || localViewerId) && target && target.runtime !== "multilogin" && target.profile &&
        ["stopping", "stopped"].includes(s.statuses[target.profile])) stop();
    // A deliberate profile stop also ends its viewer, without a connection error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.statuses, sessionKey, streamInfo, localViewerId]);

  const start = async (requestedKey = sessionKey) => {
    if (state === "connecting") return;
    const generation = ++streamGeneration.current;
    const workspaceId = activeWorkspaceID;
    setError("");
    setRemoteTabs([]);
    setPendingRemoteTab("");
    setState("connecting");
    try {
      const target = profileOptions.find((option) => option.key === requestedKey)?.target;
      if (!target) throw new Error("Select a profile in this workspace first.");
      if (target.runtime === "camoufox") {
        if (!target.profile) throw new Error("Select a Camoufox profile first.");
        const viewer = await invoke<{ id: string }>("camoufox_live_open", { profile: target.profile });
        if (generation !== streamGeneration.current || useStore.getState().activeWorkspaceId !== workspaceId) {
          void invoke("camoufox_live_close", { id: viewer.id }).catch(() => undefined);
          return;
        }
        localViewerIdRef.current = viewer.id;
        setLocalViewerId(viewer.id);
        await pollCamoufoxFrame(viewer.id, generation);
        return;
      }
      const info = await s.startRemoteStream(target);
      if (generation !== streamGeneration.current || useStore.getState().activeWorkspaceId !== workspaceId) return;
      setStreamInfo(info);
      await connectRemoteViewer(info);
    } catch {
      if (generation !== streamGeneration.current || useStore.getState().activeWorkspaceId !== workspaceId) return;
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
      } else if (option) {
        setSessionKey(launchTarget);
        const profile = option.target.profile;
        if (profile && s.statuses[profile] !== "running") await s.startProfile(profile);
        if (!profile) throw new Error("Select a profile in this workspace first.");
        await s.refreshSessions();
        await start(launchTarget);
      } else {
        throw new Error("Select a profile in this workspace first.");
      }
    } catch {
      setState("error");
      setError(internalError("We couldn't launch the remote session.", "REMOTE_SESSION_LAUNCH_FAILED"));
    }
  };

  const selectRemoteTab = (targetID: string) => {
    if (!targetID) return;
    setPendingRemoteTab(targetID);
    if (localViewerIdRef.current) {
      void invoke("camoufox_live_tab", { id: localViewerIdRef.current, targetId: targetID })
        .then(() => setPendingRemoteTab(""))
        .catch(() => setInputWarning("Could not switch tabs. Try again."));
      return;
    }
    if (!remoteClientRef.current) return;
    remoteClientRef.current.selectTab(targetID);
  };

  const pointForEvent = (event: MouseEvent | WheelEvent) => {
    const embed = remoteEmbedRef.current;
    const video = remoteVideoRef.current;
    const image = localImageRef.current;
    if (!embed || (!video && !image)) return { x: 0, y: 0 };
    const rect = embed.getBoundingClientRect();
    const sourceWidth = image?.naturalWidth || video?.videoWidth || 1;
    const sourceHeight = image?.naturalHeight || video?.videoHeight || 1;
    const videoWidth = mediaStats.viewport_width || mediaStats.device_width || sourceWidth;
    const videoHeight = mediaStats.viewport_height || mediaStats.device_height || sourceHeight;
    const renderedScale = Math.min(rect.width / Math.max(1, sourceWidth), rect.height / Math.max(1, sourceHeight));
    const renderedWidth = Math.max(1, sourceWidth * renderedScale);
    const renderedHeight = Math.max(1, sourceHeight * renderedScale);
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
    const runningProfile = runningProfiles[0]?.name;
    const current =
      (multiloginSelection ? multiloginTargetKey(multiloginSelection) : "") ||
      (workspaceProfiles.some((profile) => profile.name === s.selectedProfile) ? clawbrowserTargetKey(s.selectedProfile) : "") ||
      (runningProfile ? clawbrowserTargetKey(runningProfile) : "") ||
      "";
    const targetChanged = current !== sessionKey;
    if (targetChanged && (remoteClientRef.current || localViewerIdRef.current || streamInfo || state === "connecting")) stop();
    setSessionKey(current);
    if (
      !remoteClientRef.current && !localViewerIdRef.current &&
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
  }, [active, multiloginSelection, activeWorkspaceID]);

  useEffect(() => {
    if (active) {
      if (inactiveTimerRef.current !== null) {
        window.clearTimeout(inactiveTimerRef.current);
        inactiveTimerRef.current = null;
      }
      return;
    }
    if (!remoteClientRef.current && !localViewerIdRef.current && !streamInfo) return;
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
    if (localFrameTimerRef.current !== null) window.clearTimeout(localFrameTimerRef.current);
    if (localViewerIdRef.current) void invoke("camoufox_live_close", { id: localViewerIdRef.current }).catch(() => undefined);
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
    // A quick drag may reach pointerup without an intermediate pointermove.
    // Apply its final position while the button is still held, before release.
    if (point.x !== drag.x || point.y !== drag.y) {
      sendLiveInput({
        type: "mouse",
        payload: { event: "mouseMoved", x: point.x, y: point.y, button: drag.button, buttons: drag.buttons, modifiers: modifierBits(event.nativeEvent) },
      });
    }
    sendLiveInput({
      type: "mouse",
      payload: { event: "mouseReleased", x: point.x, y: point.y, button: drag.button, buttons: 0, clickCount: event.detail || 1, modifiers: modifierBits(event.nativeEvent) },
    });
    pointerDragRef.current = null;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button < 0) return;
    keyboardSinkRef.current?.focus({ preventScroll: true });
    const point = pointForEvent(event.nativeEvent);
    const button = buttonName(event.button);
    const buttons = event.buttons || 1;
    sendLiveInput({
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
    sendLiveInput({
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
    sendLiveInput({
      type: "wheel",
      payload: { x: point.x, y: point.y, deltaX: event.deltaX, deltaY: event.deltaY, modifiers: modifierBits(event.nativeEvent) },
    });
    event.preventDefault();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target === keyboardSinkRef.current && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
      // Let the local textarea receive the clipboard, then forward its input
      // as text. A remote Cmd/Ctrl+V has no access to the local clipboard.
      return;
    }
    if (!shouldSendKeyEvent(event.nativeEvent)) {
      // The focused textarea receives native input/composition/paste events.
      // Sending keydown too would type every ordinary character twice.
      if (event.target !== keyboardSinkRef.current && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        sendLiveInput({ type: "text", payload: { text: event.key } });
        event.preventDefault();
      }
      return;
    }
    sendLiveInput({
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

  const flushKeyboardText = () => {
    const sink = keyboardSinkRef.current;
    if (!sink || !sink.value) return;
    sendLiveInput({ type: "text", payload: { text: sink.value } });
    sink.value = "";
  };

  const handleKeyUp = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!shouldSendKeyEvent(event.nativeEvent)) return;
    sendLiveInput({
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
          {localViewerId ? "Camoufox Live is connected to the local browser."
            : streamInfo && !nativeViewer
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
            <p className="muted small">Connecting to the selected browser profile.</p>
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
            <button className="primary live-stream-btn" disabled={!launchTarget} onClick={() => launchAndStream()}>
              <Icon name="play.fill" size={12} />
              Launch to stream
            </button>
          </div>
        )}
        {state === "idle" && !streamInfo && !localViewerId && (
          <div className="live-empty-panel">
            <Icon name="video.fill" size={34} className="muted" />
            <strong>{runningProfiles.length || multiloginSelection ? "Stream is off" : "No active profiles"}</strong>
            <p className="muted">
              {runningProfiles.length || multiloginSelection
                ? "Start Remote Control for the selected running profile."
                : "Launch a profile and open Remote Control."}
            </p>
            <button
              className="btn-bordered-prominent live-stream-btn"
              disabled={!launchTarget}
              onClick={() => launchAndStream()}
              title={runningProfiles.length || multiloginSelection ? "Start live view" : "Launch selected profile and open live view"}
            >
              <Icon name="play.fill" size={12} />
              {runningProfiles.length || multiloginSelection ? "Stream" : "Launch to stream"}
            </button>
          </div>
        )}
        {(streamInfo || localViewerId) && state !== "error" && (nativeViewer || localViewerId) && (
          <div
            ref={remoteEmbedRef}
            className="remote-live-embed"
            tabIndex={0}
            onPointerCancel={handlePointerCancel}
            onLostPointerCapture={handlePointerCancel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onDragStart={(event) => event.preventDefault()}
            onWheel={handleWheel}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
          >
            {nativeViewer && <video ref={remoteVideoRef} className="remote-live-video" autoPlay muted playsInline draggable={false} />}
            {localViewerId && localFrame && <img ref={localImageRef} className="remote-live-video" src={localFrame} alt="Camoufox browser Live frame" draggable={false} />}
            <textarea
              ref={keyboardSinkRef}
              className="remote-live-keyboard-sink"
              aria-label="Type in remote browser"
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              onInput={(event) => { if (!(event.nativeEvent instanceof InputEvent) || !event.nativeEvent.isComposing) flushKeyboardText(); }}
              onCompositionEnd={flushKeyboardText}
            />
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
          {inputWarning || (localViewerId
            ? "Camoufox Live is showing the running local profile. Click, scroll, or type in the browser view."
            : nativeViewer
            ? "Remote Control is running natively in Nextbrowser. Click, scroll, type, or use the tab bar above."
            : "Remote Control is embedded in Nextbrowser through the backend dashboard viewer.")}
        </div>
      )}
    </div>
  );
}
