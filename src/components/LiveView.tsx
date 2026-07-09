import { useEffect, useState } from "react";
import { useStore } from "../store";
import { Icon, Spinner } from "./Icon";

export function LiveView() {
  const s = useStore();
  const [sessionKey, setSessionKey] = useState<string>("");
  const [streamUrl, setStreamUrl] = useState("");
  const [state, setState] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [error, setError] = useState("");
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
          {state === "live" ? "backend stream" : state}
        </span>
        <span className="muted small">Tabs are handled by the Remote Control viewer when supported.</span>
        <span className="spacer" />
        {streamUrl && (
          <a className="btn-bordered" href={streamUrl} target="_blank" rel="noreferrer" title="Open Remote Control in your browser">
            <Icon name="arrow.up.forward.app" size={14} />
            Open link
          </a>
        )}
        {state === "live" ? (
          <button className="btn-bordered live-stop-btn" onClick={stop}>
            <Icon name="stop.fill" size={14} className="error" />
            Stop
          </button>
        ) : streamUrl ? (
          <button
            className="btn-bordered-prominent live-stream-btn"
            disabled={state === "connecting"}
            onClick={() => start()}
          >
            {state === "connecting" ? (
              <>
                <Spinner size={13} />
                Connecting…
              </>
            ) : (
              <>
                <Icon name="play.fill" size={12} />
                Stream
              </>
            )}
          </button>
        ) : null}
      </div>
      <hr className="divider" />

      <div className="live-stage remote-live-stage">
        {state === "connecting" && (
          <div className="live-empty-panel">
            <Spinner size={18} />
            <strong>Starting backend stream…</strong>
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
                ? "Start a backend Remote Control stream for the selected running profile."
                : "Launch a profile to stream it through backend Remote Control."}
            </p>
            <button
              className="btn-bordered-prominent live-stream-btn"
              onClick={() => launchAndStream()}
              title={runningProfiles.length || defaultRunning ? "Start backend stream" : "Launch selected profile and stream"}
            >
              <Icon name="play.fill" size={12} />
              {runningProfiles.length || defaultRunning ? "Stream" : "Launch to stream"}
            </button>
          </div>
        )}
        {streamUrl && state === "live" && (
          <div className="remote-live-embed">
            <iframe
              className="remote-live-frame"
              src={streamUrl}
              title="Remote browser stream"
              allow="clipboard-read; clipboard-write; fullscreen"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        )}
      </div>
      {state === "live" && (
        <div className="live-hint muted small">
          Streaming through backend Remote Control. Use the viewer controls for tabs and interaction.
        </div>
      )}
    </div>
  );
}
