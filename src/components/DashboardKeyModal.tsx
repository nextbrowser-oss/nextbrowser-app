import { useEffect, useState } from "react";
import { useStore } from "../store";
import { Icon, Spinner } from "./Icon";
import { trackEvent } from "../lib/analytics";

export function DashboardKeyModal() {
  const open = useStore((s) => s.dashboardKeyPromptOpen);
  const setOpen = useStore((s) => s.setDashboardKeyPromptOpen);
  const login = useStore((s) => s.login);
  const startPairing = useStore((s) => s.startAccountPairing);
  const reopenPairing = useStore((s) => s.reopenAccountPairing);
  const pollPairing = useStore((s) => s.pollAccountPairing);
  const cancelPairing = useStore((s) => s.cancelAccountPairing);
  const pairing = useStore((s) => s.accountPairing);
  const error = useStore((s) => s.loginError);
  const loading = useStore((s) => s.isLoggingIn);
  const [key, setKey] = useState("");
  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => {
    if (!open || !pairing) return undefined;
    const timer = window.setInterval(() => {
      void pollPairing();
    }, 2_000);
    void pollPairing();
    return () => window.clearInterval(timer);
  }, [open, pairing?.pairingId, pollPairing]);

  if (!open) return null;

  const save = async () => {
    await login(key);
    if (!useStore.getState().loginError) {
      setKey("");
      setOpen(false);
    }
  };
  const close = () => {
    if (pairing) cancelPairing();
    setOpen(false);
  };

  return (
    <div className="modal-overlay" onMouseDown={close}>
      <div className="modal-card dashboard-key-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <Icon name="lock.open" size={18} />
          <strong>Sign in to NextBrowser</strong>
        </div>
        <p className="muted small">
          Managed profiles, proxy traffic, Remote Control, and skills need a connected account.
        </p>
        {pairing ? (
          <div className="pairing-status">
            <div className="pairing-code" title="Pairing code">{pairing.pairingCode}</div>
            <div>
              <strong>{pairing.status === "pending" ? "Approve this request in your browser" : pairing.status}</strong>
              <p className="muted small">NextBrowser is waiting here and will connect automatically after approval.</p>
            </div>
          </div>
        ) : (
          <button className="primary full auth-browser-btn" disabled={loading} onClick={() => void startPairing()}>
            {loading ? <Spinner size={14} /> : <Icon name="person.crop.circle.badge.checkmark" size={15} />}
            Continue in browser
          </button>
        )}
        {error && <div className="error small login-error">{error}</div>}
        <details className="manual-key-details" open={manualOpen} onToggle={(e) => setManualOpen(e.currentTarget.open)}>
          <summary className="link small" onClick={() => trackEvent("manual_api_key_toggle")}>
            Advanced: paste API key
          </summary>
          <input
            className="login-input"
            type="password"
            placeholder="NextBrowser API key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && key.trim()) void save();
            }}
          />
        </details>
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <button className="secondary" onClick={close}>
            {pairing ? "Cancel sign-in" : "Cancel"}
          </button>
          <span className="spacer" />
          {manualOpen && (
            <button
              className="primary"
              disabled={loading || !key.trim()}
              onClick={() => void save()}
              title="Save API key manually"
              aria-label="Save API key manually"
            >
              {loading ? <Spinner size={14} /> : "Save key"}
            </button>
          )}
          {pairing && (
            <>
              <button
                className="secondary"
                disabled={loading}
                onClick={() => void reopenPairing()}
                title="Open the sign-in page again"
                aria-label="Open the sign-in page again"
              >
                Open browser
              </button>
              <button
                className="primary"
                disabled={loading}
                onClick={() => void pollPairing()}
                title="Check sign-in status"
                aria-label="Check sign-in status"
              >
                {loading ? <Spinner size={14} /> : "Check now"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
