import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { Icon } from "./Icon";
import { UserFacingError } from "./UserFacingError";

export function DashboardKeyModal() {
  const open = useStore((s) => s.dashboardKeyPromptOpen);
  const setOpen = useStore((s) => s.setDashboardKeyPromptOpen);
  const startPairing = useStore((s) => s.startAccountPairing);
  const reopenPairing = useStore((s) => s.reopenAccountPairing);
  const pollPairing = useStore((s) => s.pollAccountPairing);
  const cancelPairing = useStore((s) => s.cancelAccountPairing);
  const pairing = useStore((s) => s.accountPairing);
  const error = useStore((s) => s.loginError);
  const loading = useStore((s) => s.isLoggingIn);
  const resumeOnboarding = useStore((s) => s.resumeOnboardingAfterSetup);
  const startAttempted = useRef(false);

  useEffect(() => {
    if (!open) {
      startAttempted.current = false;
      return;
    }
    if (pairing || loading || startAttempted.current) return;
    startAttempted.current = true;
    void startPairing();
  }, [loading, open, pairing, startPairing]);

  useEffect(() => {
    if (!open || !pairing) return undefined;
    const timer = window.setInterval(() => {
      void pollPairing();
    }, 2_000);
    void pollPairing();
    // Poll immediately when the user returns from the browser, instead of
    // waiting for the next interval tick.
    const pollNow = () => {
      if (document.visibilityState === "visible") void pollPairing();
    };
    window.addEventListener("focus", pollNow);
    document.addEventListener("visibilitychange", pollNow);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", pollNow);
      document.removeEventListener("visibilitychange", pollNow);
    };
  }, [open, pairing?.pairingId, pollPairing]);

  if (!open) return null;

  const close = () => {
    if (pairing) cancelPairing();
    setOpen(false);
    resumeOnboarding();
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
        <div className="pairing-status">
          <div className="pairing-ring" data-state={pairing ? "waiting" : "opening"} aria-hidden="true">
            <Icon name="globe.americas.fill" size={26} className="pairing-ring-icon" />
          </div>
          {pairing ? (
            <div className="pairing-copy">
              <strong>{pairing.status === "pending" ? "Waiting for browser sign-in…" : pairing.status}</strong>
              <p className="muted small">NextBrowser connects automatically when you finish in the browser.</p>
              <button
                type="button"
                className="pairing-reopen"
                disabled={loading}
                onClick={() => void reopenPairing()}
                title="Open the sign-in page again"
              >
                <Icon name="arrow.clockwise" size={13} />
                Reopen sign-in page
              </button>
            </div>
          ) : (
            <div className="pairing-copy">
              <strong>Opening your browser…</strong>
              <p className="muted small">Continue sign-in in the page that just opened.</p>
            </div>
          )}
        </div>
        {error && (
          <div className="error small login-error">
            <UserFacingError message={error} surface="account_sign_in" />
          </div>
        )}
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <span className="spacer" />
          <button className="secondary" onClick={close}>
            {pairing ? "Cancel sign-in" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
