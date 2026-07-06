import { useState } from "react";
import { useStore } from "../store";
import { Icon, Spinner } from "./Icon";
import { trackEvent } from "../lib/analytics";
import { dashboardUrl } from "../constants";

export function DashboardKeyModal() {
  const open = useStore((s) => s.dashboardKeyPromptOpen);
  const setOpen = useStore((s) => s.setDashboardKeyPromptOpen);
  const login = useStore((s) => s.login);
  const error = useStore((s) => s.loginError);
  const loading = useStore((s) => s.isLoggingIn);
  const [key, setKey] = useState("");

  if (!open) return null;

  const save = async () => {
    await login(key);
    if (!useStore.getState().loginError) {
      setKey("");
      setOpen(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={() => setOpen(false)}>
      <div className="modal-card dashboard-key-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <Icon name="lock.open" size={18} />
          <strong>Dashboard API key</strong>
        </div>
        <p className="muted small">
          Required for managed proxy traffic, profile creation, and dashboard usage stats.
        </p>
        <input
          className="login-input"
          type="password"
          autoFocus
          placeholder="nextbrowser API key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && key.trim()) void save();
          }}
        />
        {error && <div className="error small login-error">{error}</div>}
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <a
            className="link small"
            href={dashboardUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => trackEvent("dashboard_opened", { source: "dashboard_key_modal" })}
          >
            Open dashboard
          </a>
          <span className="spacer" />
          <button className="secondary" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={loading || !key.trim()}
            onClick={() => void save()}
          >
            {loading ? <Spinner size={14} /> : "Save key"}
          </button>
        </div>
      </div>
    </div>
  );
}
