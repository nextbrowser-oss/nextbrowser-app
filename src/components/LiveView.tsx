import { Glyph, IconButton, Select } from "../shared/ui";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { RemoteControlClient, type InputEnvelope, type LiveBrowserAction, type RemoteLiveTab, type RemoteMediaStats, type RemoteStreamInfo } from "../remoteControl";
import { useStore } from "../store";
import { actionFailureMessage, internalError } from "../lib/userFacingError";
import { nextLiveClick, type LiveClick } from "../lib/liveClickCount";
import { invoke } from "../electronBridge";
import { liveRuntimeLabel, type LiveSessionOption } from "../lib/liveSessions";
import { showLiveStartPage } from "../lib/liveStartPage";
import { liveWindowLayout } from "../lib/liveWindowLayout";
import {
  createLiveStartTurns,
} from "../lib/liveProfileSwitch";
import { Icon, Spinner } from "./Icon";
import { UserFacingError } from "./UserFacingError";
import { LiveControls } from "./LiveControls";
import { LiveBrowserToolbar } from "./LiveBrowserToolbar";
import { MainViewNavigation } from "./MainViewNavigation";
import "./liveView.css";

type LiveState = "idle" | "needs-download" | "needs-native-restart" | "connecting" | "live" | "error";
type LiveWindowSession = { id: string; attached: boolean };
const runtimeNames = { clawbrowser: "ClawBrowser", dasbrowser: "DasBrowser", camoufox: "Camoufox" };
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

// Hover moves are sent at most this often while no button is pressed.
const LIVE_HOVER_INTERVAL_MS = 50;

export function LiveView({ active, requestedKey, profileOptions, controlsOpen, onControlsChange, controlsAccessory, onOverview }: {
  active: boolean;
  requestedKey: string;
  profileOptions: LiveSessionOption[];
  controlsOpen: boolean;
  onControlsChange: (open: boolean) => void;
  controlsAccessory?: ReactNode;
  onOverview: () => void;
}) {
  const s = useStore();
  const [sessionKey, setSessionKey] = useState<string>("");
  const [streamInfo, setStreamInfo] = useState<RemoteStreamInfo | null>(null);
  const [liveWindow, setLiveWindow] = useState<LiveWindowSession | null>(null);
  const liveWindowRef = useRef<LiveWindowSession | null>(null);
  const nativeStage = useRef<HTMLDivElement>(null);
  const nativeLayoutActive = useRef(active);
  nativeLayoutActive.current = active;
  const [state, setState] = useState<LiveState>("idle");
  const [error, setError] = useState("");
  // Made once: every Ref names one incident, so a render must not mint a new one.
  const [connectFailure] = useState(() => internalError("We couldn't connect Live View.", "LIVE_VIEW_CONNECT_FAILED"));
  const [inputWarning, setInputWarning] = useState("");
  const [remoteTabs, setRemoteTabs] = useState<RemoteLiveTab[]>([]);
  const [pendingRemoteTab, setPendingRemoteTab] = useState("");
  const [browserControls, setBrowserControls] = useState(false);
  const [browserAction, setBrowserAction] = useState<number>();
  const browserActionRef = useRef<number>();
  const [mediaStats, setMediaStats] = useState<RemoteMediaStats>({});
  const [remoteMediaStream, setRemoteMediaStream] = useState<MediaStream | null>(null);
  const [viewerWindow, setViewerWindow] = useState<Window | null>(null);
  const viewerWindowRef = useRef<Window | null>(null);
  const activeWorkspaceID = s.activeWorkspaceId;
  const remoteClientRef = useRef<RemoteControlClient | null>(null);
  const activeRemoteSessionRef = useRef<RemoteStreamInfo | null>(null);
  const remoteCloseRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRemoteCloseIDsRef = useRef<Set<string>>(new Set());
  const remoteEmbedRef = useRef<HTMLDivElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const keyboardSinkRef = useRef<HTMLTextAreaElement | null>(null);
  const streamGeneration = useRef(0);
  const startTurnsRef = useRef(createLiveStartTurns());
  const liveSelection = useRef<{ workspaceId?: string }>();
  const autoStarted = useRef("");
  const nativeRestart = useRef(false);
  const inactiveTimerRef = useRef<number | null>(null);
  const inputWarningTimerRef = useRef<number | null>(null);
  const pointerDragRef = useRef<{ pointerId: number; button: string; buttons: number; x: number; y: number; clickCount: number } | null>(null);
  const lastClickRef = useRef<LiveClick | undefined>(undefined);
  const lastHoverSentRef = useRef(0);
  const defaultStatus = s.defaultSession?.status;
  const launchTarget = sessionKey || requestedKey;
  const chosenOption = profileOptions.find(option => option.key === launchTarget);
  const chosenTarget = chosenOption?.target;
  const chosenStatus = chosenTarget && chosenTarget.runtime !== "multilogin"
    ? chosenTarget.profile ? s.statuses[chosenTarget.profile] : defaultStatus
    : undefined;
  const streamUrl = streamInfo?.viewer_url || streamInfo?.dashboard_url || "";
  const nativeViewer = !!streamInfo?.viewer_ws_url;
  const mobileViewer = chosenTarget?.runtime === "multilogin" && chosenTarget.selection.kind === "mobile";

  const closeViewerWindow = () => {
    viewerWindowRef.current?.close();
    viewerWindowRef.current = null;
    setViewerWindow(null);
  };

  const openViewerWindow = () => {
    if (viewerWindowRef.current && !viewerWindowRef.current.closed) {
      viewerWindowRef.current.focus();
      return;
    }
    const viewer = window.open("about:blank", "nextbrowser-live-viewer", "popup,width=1100,height=720");
    if (!viewer) {
      setInputWarning("The Live window could not be opened. Try again.");
      return;
    }
    viewer.document.title = "Nextbrowser Live";
    viewer.document.documentElement.dataset.theme = document.documentElement.dataset.theme;
    for (const stylesheet of document.querySelectorAll("link[rel='stylesheet'], style")) {
      viewer.document.head.appendChild(stylesheet.cloneNode(true));
    }
    viewer.document.body.className = "live-detached-body";
    viewerWindowRef.current = viewer;
    setViewerWindow(viewer);
    viewer.addEventListener("pagehide", () => {
      if (viewerWindowRef.current !== viewer) return;
      viewerWindowRef.current = null;
      setViewerWindow(null);
    }, { once: true });
  };

  const closeRemoteSession = async (id: string) => {
    const result = await invoke<{ code: number }>("nextctl_run", {
      args: ["remote", "close", id], timeoutMs: 15_000,
    });
    if (result.code !== 0) throw new Error("The previous Live session could not be closed. Update nextctl and retry.");
    pendingRemoteCloseIDsRef.current.delete(id);
  };

  const releaseRemoteSession = (info: RemoteStreamInfo | null) => {
    if (!info?.id) return;
    pendingRemoteCloseIDsRef.current.add(info.id);
    remoteCloseRef.current = remoteCloseRef.current.catch(() => undefined).then(async () => {
      await closeRemoteSession(info.id);
    });
    // Stop may be triggered by a tab switch or component cleanup, without a
    // following start() to observe the rejection.
    void remoteCloseRef.current.catch(() => undefined);
  };

  const releaseLiveWindow = () => {
    const session = liveWindowRef.current;
    liveWindowRef.current = null;
    if (session) void invoke("live_window", { operation: "release", id: session.id }).catch(() => undefined);
  };

  const updateLiveWindow = (session: LiveWindowSession | null) => {
    liveWindowRef.current = session;
    setLiveWindow(session);
  };

  const stop = () => {
    streamGeneration.current += 1;
    releaseLiveWindow();
    setLiveWindow(null);
    closeViewerWindow();
    releaseRemoteSession(activeRemoteSessionRef.current);
    activeRemoteSessionRef.current = null;
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
    setBrowserControls(false);
    browserActionRef.current = undefined;
    setBrowserAction(undefined);
    setMediaStats({});
    setInputWarning("");
    pointerDragRef.current = null;
  };

  const sendLiveInput = (message: InputEnvelope) => {
    remoteClientRef.current?.sendInput(message);
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
      // The client words its own failures (connect, session closed, tab
      // switch), so the screen and the report name the one that happened.
      onError: (message) => {
        if (!current()) return;
        setError(message);
        setState("error");
      },
      onStream: (stream) => {
        if (!current()) return;
        setRemoteMediaStream(stream);
        setState("live");
      },
      onTabs: (tabs, removed) => {
        if (!current()) return;
        setRemoteTabs(previous => {
          if (!removed) {
            const incoming = new Map(tabs.map(tab => [tab.target_id, tab]));
            const ordered: RemoteLiveTab[] = [];
            for (const tab of previous) {
              const update = incoming.get(tab.target_id);
              if (update) ordered.push(update);
              incoming.delete(tab.target_id);
            }
            return [...ordered, ...incoming.values()];
          }
          const selected = tabs.find(tab => tab.active);
          const next = new Map(previous.filter(tab => !removed.includes(tab.target_id)).map(tab => [
            tab.target_id, selected ? { ...tab, active: tab.target_id === selected.target_id } : tab,
          ]));
          for (const tab of tabs) next.set(tab.target_id, { ...next.get(tab.target_id), ...tab });
          return [...next.values()];
        });
        setPendingRemoteTab((pending) =>
          pending && tabs.some((tab) => tab.active && tab.target_id === pending) ? "" : pending,
        );
      },
      onBrowserControls: available => {
        if (!current()) return;
        setBrowserControls(available);
        if (!available) {
          browserActionRef.current = undefined;
          setBrowserAction(undefined);
          setPendingRemoteTab("");
        }
      },
      onBrowserResult: (seq, message) => {
        if (!current() || browserActionRef.current !== seq) return;
        browserActionRef.current = undefined;
        setBrowserAction(undefined);
        setInputWarning(message ?? "");
      },
      onTabError: message => {
        if (!current()) return;
        setPendingRemoteTab("");
        setInputWarning(message);
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
    if ((streamInfo || liveWindow) && target && target.runtime !== "multilogin") {
      const status = target.profile ? s.statuses[target.profile] : defaultStatus;
      if (status === "stopping" || status === "stopped") stop();
    }
    // A deliberate profile stop also ends its viewer, without a connection error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.statuses, defaultStatus, sessionKey, streamInfo, liveWindow]);

  const start = async (requestedKey: string, native: boolean, alreadyRunning: boolean) => {
    const generation = ++streamGeneration.current;
    const workspaceId = activeWorkspaceID;
    const current = () => generation === streamGeneration.current && useStore.getState().activeWorkspaceId === workspaceId;
    const turn = startTurnsRef.current();
    setError("");
    setRemoteTabs([]);
    setPendingRemoteTab("");
    setState("connecting");
    try {
      await turn.ready;
      await remoteCloseRef.current.catch(() => undefined);
      // A transient close failure is retried when the user tries Live again.
      // Never spend another backend slot while an older one may remain open.
      for (const id of pendingRemoteCloseIDsRef.current) await closeRemoteSession(id);
      if (generation !== streamGeneration.current || useStore.getState().activeWorkspaceId !== workspaceId) return;
      const target = profileOptions.find((option) => option.key === requestedKey)?.target;
      if (!target) throw new Error("Select a profile in this workspace first.");
      if (native && target.runtime !== "multilogin") {
        const session = await invoke<LiveWindowSession | null>("live_window", {
          operation: "start", profile: target.profile, runtime: target.runtime,
          layout: liveWindowLayout(nativeStage.current, nativeLayoutActive.current),
        }).catch(() => null);
        if (generation !== streamGeneration.current || useStore.getState().activeWorkspaceId !== workspaceId) {
          if (session) void invoke("live_window", { operation: "release", id: session.id }).catch(() => undefined);
          return;
        }
        if (session) {
          updateLiveWindow(session);
          setState("live");
          await showLiveStartPage(target, current).catch(error => console.warn("[live-start-page]", error));
          return;
        }
        if (alreadyRunning) {
          setState("needs-native-restart");
          return;
        }
        throw new Error("Nextbrowser could not attach the local browser window.");
      }
      if (target.runtime !== "multilogin") {
        await showLiveStartPage(target, current).catch(error => console.warn("[live-start-page]", error));
        if (!current()) return;
      }
      const info = await s.startRemoteStream(target);
      if (generation !== streamGeneration.current || useStore.getState().activeWorkspaceId !== workspaceId) {
        releaseRemoteSession(info);
        return;
      }
      activeRemoteSessionRef.current = info;
      // stop() releases the session from here on; the viewer may still connect.
      turn.done();
      setStreamInfo(info);
      await connectRemoteViewer(info);
    } catch (error) {
      if (generation !== streamGeneration.current || useStore.getState().activeWorkspaceId !== workspaceId) return;
      remoteClientRef.current?.close();
      remoteClientRef.current = null;
      releaseRemoteSession(activeRemoteSessionRef.current);
      activeRemoteSessionRef.current = null;
      setState("error");
      setError(actionFailureMessage("We couldn't start Live View.", "LIVE_VIEW_START_FAILED", error));
    } finally {
      turn.done();
    }
  };

  const switchProfile = (key: string) => {
    if (key !== requestedKey) s.openLiveSession(key);
  };

  const launchAndStream = async (key = launchTarget, downloadConfirmed = false, restart = false) => {
    // A profile switch or Stop while the profile launches takes precedence.
    const generation = streamGeneration.current;
    setError("");
    setState("connecting");
    try {
      const option = profileOptions.find(candidate => candidate.key === key);
      if (!option) throw new Error("Select a profile in this workspace first.");
      const native = option.target.runtime !== "multilogin" && window.nextbrowser?.platform === "win32";
      if (native && !(await invoke<boolean>("live_window_available", { runtime: option.target.runtime }))) {
        throw new Error("The Windows Live window helper is unavailable.");
      }
      if (generation !== streamGeneration.current || useStore.getState().activeWorkspaceId !== activeWorkspaceID) return;
      if (option.target.runtime !== "multilogin" && (!option.running || restart)) {
        const { runtime, profile } = option.target;
        const available = await invoke<boolean>("browser_runtime_available", { runtime });
        if (generation !== streamGeneration.current || useStore.getState().activeWorkspaceId !== activeWorkspaceID) return;
        if (useStore.getState().tab !== "live") {
          setState("idle");
          return;
        }
        if (!available && !downloadConfirmed) {
          setState("needs-download");
          return;
        }
        if (profile) await s.startProfile(profile, { forLive: true, liveWindow: native });
        else await s.startDefaultSession({ forLive: true, liveWindow: native });
      }
      if (generation !== streamGeneration.current || useStore.getState().activeWorkspaceId !== activeWorkspaceID) return;
      await start(key, native, Boolean(option.running) && !restart);
    } catch (error) {
      if (generation !== streamGeneration.current) return;
      setState("error");
      setError(actionFailureMessage("We couldn't launch the browser session.", "REMOTE_SESSION_LAUNCH_FAILED", error));
    }
  };

  const restartInNativeWindow = async () => {
    if (!chosenTarget || chosenTarget.runtime === "multilogin" || nativeRestart.current) return;
    nativeRestart.current = true;
    stop();
    setState("connecting");
    const generation = streamGeneration.current;
    try {
      await remoteCloseRef.current;
      if (generation !== streamGeneration.current || useStore.getState().activeWorkspaceId !== activeWorkspaceID) return;
      if (chosenTarget.profile) await s.stopProfile(chosenTarget.profile);
      else await s.stopDefaultSession();
      if (generation !== streamGeneration.current || useStore.getState().activeWorkspaceId !== activeWorkspaceID) return;
      await launchAndStream(launchTarget, false, true);
    } catch (error) {
      if (generation !== streamGeneration.current) return;
      setError(actionFailureMessage("We couldn't restart the browser in a native window.", "LIVE_WINDOW_RESTART_FAILED", error));
      setState("error");
    } finally {
      nativeRestart.current = false;
    }
  };

  const selectRemoteTab = (targetID: string) => {
    if (!remoteClientRef.current || remoteTabs.some(tab => tab.active && tab.target_id === targetID)) return;
    setInputWarning("");
    setPendingRemoteTab(targetID);
    remoteClientRef.current.selectTab(targetID);
  };

  const runBrowserAction = (action: LiveBrowserAction, targetID?: string, url?: string) => {
    if (browserActionRef.current !== undefined || pendingRemoteTab || !browserControls) return false;
    const seq = remoteClientRef.current?.runBrowserAction(action, targetID, url);
    if (seq === undefined) return false;
    setInputWarning("");
    browserActionRef.current = seq;
    setBrowserAction(seq);
    return true;
  };

  useEffect(() => {
    if (browserAction === undefined && !pendingRemoteTab) return;
    const timeout = window.setTimeout(() => {
      browserActionRef.current = undefined;
      setBrowserAction(undefined);
      setPendingRemoteTab("");
      setInputWarning("The browser did not respond in time.");
    }, 10_000);
    return () => window.clearTimeout(timeout);
  }, [browserAction, pendingRemoteTab]);

  const pointForEvent = (event: MouseEvent | WheelEvent) => {
    const embed = remoteEmbedRef.current;
    const video = remoteVideoRef.current;
    if (!embed || !video) return { x: 0, y: 0 };
    const rect = embed.getBoundingClientRect();
    const sourceWidth = video.videoWidth || 1;
    const sourceHeight = video.videoHeight || 1;
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
    if (!active) {
      autoStarted.current = "";
      onControlsChange(false);
      return;
    }
    const previous = liveSelection.current;
    const key = requestedKey;
    if (sessionKey !== key || previous?.workspaceId !== activeWorkspaceID) {
      liveSelection.current = { workspaceId: activeWorkspaceID };
      stop();
      setSessionKey(key);
      autoStarted.current = "";
      return;
    }
    if (!chosenOption || streamInfo || liveWindow || state !== "idle" || autoStarted.current === key ||
        ["starting", "stopping", "rotating"].includes(chosenStatus || "")) return;
    autoStarted.current = key;
    void launchAndStream(key);
    // The stream actions use the current render; rerun only when its target or readiness changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeWorkspaceID, requestedKey, sessionKey, chosenOption?.key, chosenStatus, state, streamInfo, liveWindow, onControlsChange]);

  const changeLiveWindow = async (operation: "detach" | "embed") => {
    const session = liveWindowRef.current;
    if (!session) return;
    try {
      const next = await invoke<LiveWindowSession | null>("live_window", {
        operation, id: session.id, layout: liveWindowLayout(nativeStage.current, active),
      });
      if (liveWindowRef.current !== session) return;
      if (!next) stop();
      else {
        updateLiveWindow(next);
        setInputWarning("");
      }
    } catch {
      if (liveWindowRef.current === session) setInputWarning("Couldn't move the browser window. Try again.");
    }
  };

  useEffect(() => {
    if (!liveWindow) return;
    let disposed = false;
    let frame = 0;
    let pending = false;
    let dirty = false;
    let lastLayout = "";
    const sync = async (checkStatus = false) => {
      if (disposed) return;
      if (pending) { dirty = true; return; }
      const layout = liveWindowLayout(nativeStage.current, active);
      const serialized = JSON.stringify(layout);
      const changed = liveWindow.attached && serialized !== lastLayout;
      if (!changed && !checkStatus) return;
      lastLayout = serialized;
      pending = true;
      try {
        const result = await invoke<LiveWindowSession | null>("live_window", {
          operation: changed ? "layout" : "status", id: liveWindow.id, layout,
        });
        if (!disposed && liveWindowRef.current === liveWindow && !result) stop();
      } catch {
        if (!disposed && liveWindowRef.current === liveWindow) {
          stop();
          setError(internalError("We couldn't display the native browser window.", "LIVE_WINDOW_LAYOUT_FAILED"));
          setState("error");
        }
      } finally {
        pending = false;
        if (dirty) { dirty = false; schedule(); }
      }
    };
    const schedule = () => {
      if (!disposed && !frame) frame = requestAnimationFrame(() => { frame = 0; void sync(); });
    };
    const resize = new ResizeObserver(schedule);
    if (nativeStage.current) resize.observe(nativeStage.current);
    const mutation = new MutationObserver(schedule);
    mutation.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "hidden", "aria-modal"] });
    window.addEventListener("resize", schedule);
    void sync(true);
    const timer = window.setInterval(() => void sync(true), 1000);
    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      clearInterval(timer);
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", schedule);
    };
    // Native bounds follow DOM layout and the window owned by this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, liveWindow]);

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
    // Only transitions out of a focused viewer should reset the grace period.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => () => {
    releaseLiveWindow();
    streamGeneration.current += 1;
    viewerWindowRef.current?.close();
    if (inactiveTimerRef.current !== null) window.clearTimeout(inactiveTimerRef.current);
    if (inputWarningTimerRef.current !== null) window.clearTimeout(inputWarningTimerRef.current);
    remoteClientRef.current?.close();
    releaseRemoteSession(activeRemoteSessionRef.current);
    activeRemoteSessionRef.current = null;
  }, []);

  useEffect(() => {
    const video = remoteVideoRef.current;
    if (!video || !remoteMediaStream) return;
    video.srcObject = remoteMediaStream;
    void video.play().catch(() => undefined);
  }, [remoteMediaStream, state, viewerWindow]);

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
      payload: { event: "mouseReleased", x: point.x, y: point.y, button: drag.button, buttons: 0, clickCount: drag.clickCount, modifiers: modifierBits(event.nativeEvent) },
    });
    pointerDragRef.current = null;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button < 0) return;
    keyboardSinkRef.current?.focus({ preventScroll: true });
    const point = pointForEvent(event.nativeEvent);
    const button = buttonName(event.button);
    const buttons = event.buttons || 1;
    const click = nextLiveClick(lastClickRef.current, { time: event.timeStamp, x: event.clientX, y: event.clientY, button });
    lastClickRef.current = click;
    sendLiveInput({
      type: "mouse",
      payload: { event: "mousePressed", x: point.x, y: point.y, button, buttons, clickCount: click.count, modifiers: modifierBits(event.nativeEvent) },
    });
    pointerDragRef.current = { pointerId: event.pointerId, button, buttons, x: point.x, y: point.y, clickCount: click.count };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = pointerDragRef.current;
    if (!drag) {
      // Hover without a button held, throttled, so menus and hover states react.
      if (event.pointerType !== "mouse" || event.timeStamp - lastHoverSentRef.current < LIVE_HOVER_INTERVAL_MS) return;
      lastHoverSentRef.current = event.timeStamp;
      const point = pointForEvent(event.nativeEvent);
      sendLiveInput({
        type: "mouse",
        payload: { event: "mouseMoved", x: point.x, y: point.y, button: "none", buttons: 0, modifiers: modifierBits(event.nativeEvent) },
      });
      return;
    }
    if (drag.pointerId !== event.pointerId) return;
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

  useEffect(() => {
    const embed = remoteEmbedRef.current;
    if (!embed) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const pixelsPerUnit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? embed.clientHeight : 1;
      remoteClientRef.current?.scroll({
        ...pointForEvent(event),
        deltaX: event.deltaX * pixelsPerUnit,
        deltaY: event.deltaY * pixelsPerUnit,
        modifiers: modifierBits(event),
      });
    };
    embed.addEventListener("wheel", onWheel, { passive: false });
    return () => embed.removeEventListener("wheel", onWheel);
    // Input coordinates depend on the latest remote viewport and rendered video.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeViewer, state, viewerWindow, mediaStats]);

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

  const stage = <>
    {nativeViewer && !mobileViewer && state !== "error" && <LiveBrowserToolbar key={streamInfo?.id}
      tabs={remoteTabs} currentURL={streamInfo?.target?.url || ""} canNavigate={browserControls}
      busy={browserAction !== undefined || !!pendingRemoteTab}
      onSelect={selectRemoteTab} onAction={runBrowserAction} />}
    <div ref={nativeStage} className="live-stage remote-live-stage">
        {liveWindow && !liveWindow.attached && <div className="live-empty-panel">
          <strong>Live is in a separate window</strong>
          <button className="btn-bordered-prominent" onClick={() => void changeLiveWindow("embed")}>Return to Nextbrowser</button>
        </div>}
        {state === "needs-download" && chosenTarget && chosenTarget.runtime !== "multilogin" && (
          <div className="live-empty-panel">
            <Icon name="arrow.down.circle.fill" size={32} className="muted" />
            <strong>Download {runtimeNames[chosenTarget.runtime]} to use Live</strong>
            <p className="muted">The selected profile needs this browser.</p>
            <button className="primary live-stream-btn" onClick={() => void launchAndStream(launchTarget, true)}>
              Download &amp; start
            </button>
          </div>
        )}
        {state === "needs-native-restart" && (
          <div className="live-empty-panel">
            <strong>Live needs a browser window</strong>
            <p className="muted">Restart this profile to open its window inside Nextbrowser.</p>
            <button className="primary live-stream-btn" onClick={() => void restartInNativeWindow()}>
              Restart in Live
            </button>
          </div>
        )}
        {state === "connecting" && !streamInfo && (
          <div className="live-empty-panel" role="status">
            <Spinner size={18} />
            <strong>Starting live view...</strong>
            <p className="muted small">Connecting to the selected browser profile.</p>
          </div>
        )}
        {state === "error" && (
          <div className="live-error live-empty-panel">
            <Icon name="exclamationmark.triangle.fill" size={32} className="warn" />
            <p>
              <UserFacingError
                message={error || connectFailure}
                surface="live_view"
              />
            </p>
            <button className="primary live-stream-btn" disabled={!launchTarget} onClick={() => { stop(); void launchAndStream(); }}>
              <Icon name="play.fill" size={12} />
              Retry Live
            </button>
          </div>
        )}
        {state === "idle" && !streamInfo && (
          <div className="live-empty-panel">
            <Icon name="video.fill" size={34} className="muted" />
            <strong>{launchTarget ? "Live view is off" : "No browser profile selected"}</strong>
            <p className="muted">
              {launchTarget ? "Resume the browser in Live." : "Open Live controls to manage profiles in this workspace."}
            </p>
            {launchTarget && <button
              className="btn-bordered-prominent live-stream-btn"
              onClick={() => void launchAndStream()}
            >
              <Icon name="play.fill" size={12} />
              Resume Live
            </button>}
          </div>
        )}
        {streamInfo && state !== "error" && nativeViewer && (
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
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
          >
            <video ref={remoteVideoRef} className="remote-live-video" autoPlay muted playsInline draggable={false} />
            <textarea
              ref={keyboardSinkRef}
              className="remote-live-keyboard-sink"
              aria-label="Type in remote browser"
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              onInput={(event) => { if (!(event.nativeEvent as InputEvent).isComposing) flushKeyboardText(); }}
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
  </>;

  const canDetach = (!!streamInfo || !!liveWindow) && state === "live";
  return (
    <div className="live" data-native-window={liveWindow?.attached || undefined}>
      {viewerWindow ? <>
        <div className="live-stage remote-live-stage">
          <div className="live-empty-panel">
            <strong>Live is in a separate window</strong>
            <button className="btn-bordered-prominent" onClick={closeViewerWindow}>Return to Nextbrowser</button>
          </div>
        </div>
        {createPortal(<div className="live live-detached">
          {stage}
          <IconButton label="Return to Nextbrowser" text="Return to Nextbrowser" hint="" className="live-return-button" onClick={closeViewerWindow}>
            <Icon name="xmark" size={16} />
          </IconButton>
          {inputWarning && <div className="live-input-warning" role="status">{inputWarning}</div>}
        </div>, viewerWindow.document.body)}
      </> : <>
        {stage}
        {inputWarning && <div className="live-input-warning" role="status">{inputWarning}</div>}
      </>}
      {active && <LiveControls open={controlsOpen} onOpenChange={onControlsChange}>
        <div className="live-controls-navigation"><MainViewNavigation />{controlsAccessory}</div>
        <IconButton appearance="plain" label="All Profiles" text="Profiles" onClick={onOverview}><Glyph name="blocks" size={14} /></IconButton>
        <div className="live-controls">
          <Select label="Browser profile" value={launchTarget} onChange={switchProfile}
            options={profileOptions.map(profile => ({
              value: profile.key,
              label: profile.target.runtime === "multilogin" ? `${profile.label} · ${liveRuntimeLabel(profile.target)}` : profile.label,
            }))} />
          <span className={`live-pill live-status-${state}`}>{state === "needs-download" ? "Download required" : state === "idle" ? "Off" : state}</span>
        </div>
        {(canDetach || state === "connecting") && <div className="live-controls-actions">
          {canDetach && <button className="btn-bordered" type="button" onClick={liveWindow
            ? () => void changeLiveWindow(liveWindow.attached ? "detach" : "embed")
            : viewerWindow ? closeViewerWindow : openViewerWindow}>
            <Icon name="arrow.up.forward.app" size={14} /> {viewerWindow || liveWindow?.attached === false ? "Return to Nextbrowser" : "Open in separate window"}
          </button>}
          {(state === "live" || state === "connecting") && <button type="button" className="btn-bordered" onClick={stop}>
            <Icon name="stop.fill" size={14} /> Stop
          </button>}
        </div>}
      </LiveControls>}
    </div>
  );
}
