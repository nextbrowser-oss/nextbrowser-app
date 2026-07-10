import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { Icon, Spinner } from "./Icon";

type LiveWebviewElement = HTMLWebViewElement & {
  executeJavaScript?: (code: string) => Promise<unknown>;
};

type RemoteFrameSnapshot = {
  data?: string;
  ok?: boolean;
};

export function LiveView() {
  const s = useStore();
  const [sessionKey, setSessionKey] = useState<string>("");
  const [streamUrl, setStreamUrl] = useState("");
  const [state, setState] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [error, setError] = useState("");
  const remoteEmbedRef = useRef<HTMLDivElement | null>(null);
  const remoteWebviewRef = useRef<LiveWebviewElement | null>(null);
  const remoteCanvasRef = useRef<HTMLCanvasElement | null>(null);
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

  const start = async (requestedKey = sessionKey) => {
    if (state === "connecting") return;
    setError("");
    setState("connecting");
    try {
      const url = await s.startRemoteStream(requestedKey === "__default" ? undefined : requestedKey || undefined);
      setStreamUrl(url);
      setState("live");
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

  const stop = () => {
    setStreamUrl("");
    setState("idle");
  };

  useEffect(() => {
    const current =
      s.selectedProfile ||
      (s.defaultSession?.status === "running" ? "__default" : "") ||
      s.profiles.find((profile) => s.statuses[profile.name] === "running")?.name ||
      "";
    setSessionKey(current);
    if (current && (current === "__default" || s.statuses[current] === "running")) void start(current);
    // LiveView is mounted afresh on tab selection, matching Swift onAppear.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!streamUrl || state !== "live") return;
    const embed = remoteEmbedRef.current;
    const webview = remoteWebviewRef.current;
    if (!embed || !webview) return;

    const syncSize = () => {
      const width = Math.max(1, Math.floor(embed.clientWidth));
      const height = Math.max(1, Math.floor(embed.clientHeight));
      const canvas = remoteCanvasRef.current;
      webview.style.width = `${width}px`;
      webview.style.height = `${height}px`;
      webview.style.minWidth = `${width}px`;
      webview.style.minHeight = `${height}px`;
      if (canvas) {
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.floor(width * ratio));
        canvas.height = Math.max(1, Math.floor(height * ratio));
      }
      webview.setAttribute("autosize", "on");
      webview.setAttribute("minwidth", String(width));
      webview.setAttribute("maxwidth", String(width));
      webview.setAttribute("minheight", String(height));
      webview.setAttribute("maxheight", String(height));
      applyEmbeddedStreamLayout(width, height);
    };

    const applyEmbeddedStreamLayout = (width = Math.max(1, Math.floor(embed.clientWidth)), height = Math.max(1, Math.floor(embed.clientHeight))) => {
      if (!webview.executeJavaScript) return;
      const script = `(() => {
        const width = ${JSON.stringify(width)};
        const height = ${JSON.stringify(height)};
        const video = document.querySelector("video");
        const streamBox = video?.parentElement;
        if (!video || !streamBox) return { ok: false, reason: "video-not-ready" };

        document.documentElement.style.setProperty("background", "#000", "important");
        document.documentElement.style.setProperty("overflow", "hidden", "important");
        document.body.style.setProperty("margin", "0", "important");
        document.body.style.setProperty("background", "#000", "important");
        document.body.style.setProperty("overflow", "hidden", "important");

        streamBox.style.setProperty("position", "fixed", "important");
        streamBox.style.setProperty("inset", "0 auto auto 0", "important");
        streamBox.style.setProperty("z-index", "2147483647", "important");
        streamBox.style.setProperty("width", width + "px", "important");
        streamBox.style.setProperty("height", height + "px", "important");
        streamBox.style.setProperty("min-height", "0", "important");
        streamBox.style.setProperty("max-height", "none", "important");
        streamBox.style.setProperty("border-radius", "0", "important");

        video.style.setProperty("width", "100%", "important");
        video.style.setProperty("height", "100%", "important");
        video.style.setProperty("object-fit", "contain", "important");
        window.scrollTo(0, 0);
        return { ok: true, width, height };
      })()`;
      try {
        void webview.executeJavaScript(script).catch(() => undefined);
      } catch {
        // The webview throws synchronously until its guest page emits dom-ready.
      }
    };

    let mirrorClosed = false;
    let mirrorInFlight = false;
    const drawRemoteFrame = async () => {
      const canvas = remoteCanvasRef.current;
      if (mirrorClosed || mirrorInFlight || !canvas || !webview.executeJavaScript) return;
      const width = Math.max(1, canvas.width);
      const height = Math.max(1, canvas.height);
      const script = `(() => {
        const video = document.querySelector("video");
        if (!video || !video.videoWidth || !video.videoHeight || video.readyState < 2) return { ok: false };
        const width = ${JSON.stringify(width)};
        const height = ${JSON.stringify(height)};
        const canvas = window.__nextBrowserFrameMirrorCanvas || document.createElement("canvas");
        window.__nextBrowserFrameMirrorCanvas = canvas;
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return { ok: false };
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, height);
        const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
        const drawWidth = Math.max(1, Math.round(video.videoWidth * scale));
        const drawHeight = Math.max(1, Math.round(video.videoHeight * scale));
        const x = Math.floor((width - drawWidth) / 2);
        const y = Math.floor((height - drawHeight) / 2);
        ctx.drawImage(video, x, y, drawWidth, drawHeight);
        return { ok: true, data: canvas.toDataURL("image/jpeg", 0.82) };
      })()`;
      mirrorInFlight = true;
      try {
        const snapshot = (await webview.executeJavaScript(script)) as RemoteFrameSnapshot;
        if (!mirrorClosed && snapshot?.ok && snapshot.data) {
          await new Promise<void>((resolve) => {
            const image = new Image();
            image.onload = () => {
              if (!mirrorClosed) {
                const ctx = canvas.getContext("2d");
                if (ctx) {
                  ctx.clearRect(0, 0, canvas.width, canvas.height);
                  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
                }
              }
              resolve();
            };
            image.onerror = () => resolve();
            image.src = snapshot.data || "";
          });
        }
      } catch {
        // The guest page is not always ready when the mirror ticks.
      } finally {
        mirrorInFlight = false;
      }
    };

    syncSize();
    const frame = window.requestAnimationFrame(syncSize);
    const timers = [100, 350, 800, 1400, 2400, 4000].map((delay) => window.setTimeout(syncSize, delay));
    const interval = window.setInterval(syncSize, 1200);
    const mirrorInterval = window.setInterval(() => void drawRemoteFrame(), 160);
    const observer = new ResizeObserver(syncSize);
    observer.observe(embed);
    webview.addEventListener("dom-ready", syncSize);
    webview.addEventListener("did-finish-load", syncSize);
    webview.addEventListener("did-stop-loading", syncSize);

    return () => {
      window.cancelAnimationFrame(frame);
      mirrorClosed = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      window.clearInterval(interval);
      window.clearInterval(mirrorInterval);
      observer.disconnect();
      webview.removeEventListener("dom-ready", syncSize);
      webview.removeEventListener("did-finish-load", syncSize);
      webview.removeEventListener("did-stop-loading", syncSize);
    };
  }, [streamUrl, state]);

  return (
    <div className="live">
      <div className="live-controls">
        <Icon name="video.fill" size={18} className="accent-icon" />
        <select
          className="live-session-select"
          value={sessionKey}
          title="Choose profile to stream"
          onChange={(e) => {
            setSessionKey(e.target.value);
            setStreamUrl("");
            setState("idle");
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
        <span className="muted small">Tabs are handled by the Remote Control viewer when supported.</span>
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

      <div className="live-stage remote-live-stage">
        {state === "connecting" && (
          <div className="live-empty-panel">
            <Spinner size={18} />
            <strong>Starting live view…</strong>
            <p className="muted small">Creating a Remote Control session through clawctl.</p>
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
        {state === "idle" && !streamUrl && (
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
        {streamUrl && state === "live" && (
          <div ref={remoteEmbedRef} className="remote-live-embed">
            <webview
              ref={remoteWebviewRef}
              className="remote-live-frame"
              src={streamUrl}
              title="Remote browser stream"
            />
            <canvas ref={remoteCanvasRef} className="remote-live-canvas" aria-hidden="true" />
          </div>
        )}
      </div>
      {state === "live" && (
        <div className="live-hint muted small">
          Remote Control is running. Use the viewer controls for tabs and interaction.
        </div>
      )}
    </div>
  );
}
