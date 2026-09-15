import { useEffect, useState } from "react";
import { invoke, listen } from "../electronBridge";
import { useStore } from "../store";
interface SafetyState { phase: string; message?: string; profile?: string; attempt?: number }
export function ProxySafetyBanner() {
  const [state, setState] = useState<SafetyState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false, cleanup: (() => void) | undefined, revision = 0;
    const apply = (next: SafetyState | null) => {
      if (disposed) return;
      setState(next);
      useStore.setState({ proxySafetyBlocked: !!next });
      if (!next) for (const id of Object.keys(useStore.getState().runtime)) useStore.getState().startConsumer(id);
    };
    void listen<SafetyState | null>("proxy:safety", ({ payload }) => { revision++; apply(payload); }).then((stop) => { if (disposed) stop(); else cleanup = stop; });
    const initialRevision = revision;
    void invoke<SafetyState | null>("proxy_safety_status").then((next) => { if (revision === initialRevision) apply(next); }).catch(() => apply({ phase: "blocked", message: "Connection safety status is unavailable. Local tasks are paused." }));
    return () => { disposed = true; cleanup?.(); };
  }, []);
  if (!state) return null;
  const act = async (command: string) => {
    setBusy(true); setError("");
    try { await invoke(command); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <section role="alert" className="proxy-safety-banner">
    <strong>Local tasks paused · {state.profile || "Default profile"}</strong>
    <p>{state.message}</p>
    <p>Interrupted actions are not repeated automatically. Check whether the last action completed before resuming.</p>
    {error && <p>{error}</p>}
    {state.phase === "recovered"
      ? <button className="primary" disabled={busy} onClick={() => void act("proxy_safety_resume")}>Verify again and resume queued tasks</button>
      : <button className="secondary" disabled={busy || state.phase === "recovering"} onClick={() => void act("proxy_safety_recover")}>{state.phase === "recovering" ? `Restoring connection ${state.attempt || 0}/3` : "Retry the same connection"}</button>}
  </section>;
}
