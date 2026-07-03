import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { clawctlJson } from "../clawctl";
import { Screencast, httpBaseFromEndpoint } from "../screencast";
import type { SessionStatus } from "../types";
import { sessionEndpoint } from "../types";
import { Icon, Spinner } from "./Icon";

export function LiveView() {
  const s = useStore();
  const [sessionKey, setSessionKey] = useState<string>("");
  const [frame, setFrame] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [fps, setFps] = useState(0);
  const [error, setError] = useState("");
  const [control, setControl] = useState(false);
  const [clickPos, setClickPos] = useState<{ x: number; y: number } | null>(null);
  const castRef = useRef<Screencast | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (castRef.current) castRef.current.interactive = control;
  }, [control]);

  const resolveBase = async (key: string): Promise<string> => {
    const st = await clawctlJson<SessionStatus>(["status", "--profile", key]);
    const ep = sessionEndpoint(st);
    if (!ep || st.status !== "running") throw new Error("Session not running.");
    const base = httpBaseFromEndpoint(ep);
    if (!base) throw new Error("Invalid CDP endpoint.");
    return base;
  };

  const start = async (requestedKey = sessionKey) => {
    if (!requestedKey || state === "connecting") return;
    castRef.current?.stop();
    setError("");
    const cast = new Screencast({
      onState: setState,
      onFrame: setFrame,
      onFps: setFps,
      onError: setError,
    });
    cast.interactive = control;
    castRef.current = cast;
    try {
      const base = await resolveBase(requestedKey);
      await cast.start(base);
    } catch (e) {
      setState("error");
      setError(String(e));
    }
  };

  const stop = () => {
    castRef.current?.stop();
    castRef.current = null;
    setFrame(null);
    setState("idle");
  };

  useEffect(() => {
    const current =
      s.selectedProfile ??
      s.profiles.find((profile) => s.statuses[profile.name] === "running")?.name ??
      "";
    setSessionKey(current);
    if (current) void start(current);
    return () => castRef.current?.stop();
    // LiveView is mounted afresh on tab selection, matching Swift onAppear.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onStageClick = (e: React.MouseEvent) => {
    const el = frameRef.current;
    const stage = stageRef.current;
    const cast = castRef.current;
    if (!el || !stage || !cast || !control || state !== "live") return;
    const rect = el.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
    const stageRect = stage.getBoundingClientRect();
    setClickPos({ x: e.clientX - stageRect.left, y: e.clientY - stageRect.top });
    setTimeout(() => setClickPos(null), 350);
    void cast.click(nx, ny);
  };

  const onWheel = (e: React.WheelEvent) => {
    const cast = castRef.current;
    if (!cast || !control || state !== "live") return;
    e.preventDefault();
    const el = frameRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
    void cast.scroll(nx, ny, e.deltaX, e.deltaY);
  };

  useEffect(() => {
    if (!control) return;
    const onKey = (e: KeyboardEvent) => {
      const cast = castRef.current;
      if (!cast || state !== "live") return;
      if (e.key === "Enter") void cast.specialKey("Enter", "Enter");
      else if (e.key === "Backspace") void cast.specialKey("Backspace", "Backspace");
      else if (e.key === "Tab") {
        e.preventDefault();
        void cast.specialKey("Tab", "Tab");
      } else if (e.key === "Escape") void cast.specialKey("Escape", "Escape");
      else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) void cast.typeText(e.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [control, state]);

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
          {state === "live" && control ? "live · control" : state}
        </span>
        <label className="control-toggle">
          <input
            type="checkbox"
            checked={control}
            disabled={state !== "live"}
            onChange={(e) => setControl(e.target.checked)}
          />
          Control
        </label>
        <span className="spacer" />
        {state === "live" && (
          <span className="muted small fps-label">
            <Icon name="speedometer" size={12} /> {fps} fps
          </span>
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

      <div
        ref={stageRef}
        className={"live-stage" + (control ? " interactive" : "")}
        onClick={onStageClick}
        onWheel={onWheel}
      >
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
        {state === "idle" && !frame && (
          <div className="muted">Start a session, then Stream to watch the browser.</div>
        )}
        {frame && <img ref={frameRef} src={frame} alt="Live browser" className="live-frame" draggable={false} />}
        {clickPos && (
          <div
            className="click-indicator"
            style={{ left: clickPos.x, top: clickPos.y }}
          />
        )}
      </div>
      {control && state === "live" && (
        <div className="live-hint muted small">
          Click to interact · scroll wheel · type when Control is on
        </div>
      )}
    </div>
  );
}
