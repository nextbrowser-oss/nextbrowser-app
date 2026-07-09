import { useEffect, useState } from "react";
import { useStore } from "../store";
import { Icon, Spinner } from "./Icon";

export function LiveView() {
  const s = useStore();
  const [sessionKey, setSessionKey] = useState<string>("");
  const [streamUrl, setStreamUrl] = useState("");
  const [state, setState] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [error, setError] = useState("");

  const start = async (requestedKey = sessionKey) => {
    if (!requestedKey || state === "connecting") return;
    setError("");
    setState("connecting");
    try {
      const url = await s.startRemoteStream(requestedKey);
      setStreamUrl(url);
      setState("live");
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
      s.selectedProfile ??
      s.profiles.find((profile) => s.statuses[profile.name] === "running")?.name ??
      "";
    setSessionKey(current);
    if (current) void start(current);
    // LiveView is mounted afresh on tab selection, matching Swift onAppear.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="live">
      <div className="live-controls">
        <Icon name="video.fill" size={18} className="accent-icon" />
        <select className="live-session-select" value={sessionKey} onChange={(e) => setSessionKey(e.target.value)}>
          <option value="">Select session</option>
          {s.profiles.map((p) => (
            <option key={p.name} value={p.name}>
              {s.statuses[p.name] === "running" ? p.name : `${p.name} (stopped)`}
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
        ) : (
          <button
            className="btn-bordered-prominent live-stream-btn"
            disabled={!sessionKey || state === "connecting"}
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
        )}
      </div>
      <hr className="divider" />

      <div className="live-stage remote-live-stage">
        {state === "connecting" && <div className="muted">Connecting…</div>}
        {state === "error" && (
          <div className="live-error">
            <Icon name="exclamationmark.triangle.fill" size={32} className="warn" />
            <p>{error || "Connection failed"}</p>
            <button className="primary live-stream-btn" onClick={() => start()}>
              <Icon name="play.fill" size={12} />
              Stream
            </button>
          </div>
        )}
        {state === "idle" && !streamUrl && (
          <div className="muted">Start a session, then Stream to open the backend Remote Control viewer.</div>
        )}
        {streamUrl && state === "live" && (
          <iframe
            className="remote-live-frame"
            title="NextBrowser Remote Control"
            src={streamUrl}
            allow="clipboard-read; clipboard-write"
          />
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
