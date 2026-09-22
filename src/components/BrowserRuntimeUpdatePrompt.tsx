import { shouldDismissModalWithEscape } from "../lib/modalKeyboard";
import { Icon } from "./Icon";

export interface BrowserRuntimeUpdateEntry {
  runtime: "clawbrowser" | "dasbrowser" | "camoufox";
  name: string;
  status: "available" | "up-to-date" | "not-installed" | "unavailable" | "unknown" | "error";
  currentVersion?: string;
  latestVersion?: string;
  releasePage: string;
  error?: string;
}

export function BrowserRuntimeUpdatePrompt({ runtimes, onLater, onConfirm }: {
  runtimes: BrowserRuntimeUpdateEntry[];
  onLater: () => void;
  onConfirm: (runtimes: BrowserRuntimeUpdateEntry["runtime"][]) => void;
}) {
  const isFirstInstall = runtimes.every((runtime) => runtime.status === "not-installed");
  return (
    <div
      className="modal-overlay"
      onKeyDown={(event) => {
        if (!shouldDismissModalWithEscape(event)) return;
        event.preventDefault();
        onLater();
      }}
    >
      <div className="modal-card runtime-update-prompt" role="dialog" aria-modal="true" aria-labelledby="runtime-update-title">
        <div className="modal-title-row">
          <Icon name="arrow.down.circle" size={19} className="warn" />
          <div>
            <strong id="runtime-update-title">{isFirstInstall ? "Install browser toolset" : "Browser toolset update available"}</strong>
            <div className="muted small">{isFirstInstall ? "Nextbrowser will download and prepare it for a new profile." : "Choose when Nextbrowser may install it."}</div>
          </div>
        </div>
        <div className="runtime-update-prompt-list">
          {runtimes.map((runtime) => (
            <div className="runtime-update-prompt-row" key={runtime.runtime}>
              <strong>{runtime.name}</strong>
              <span className="muted small">{runtime.currentVersion ?? (runtime.status === "not-installed" ? "Not installed" : "Installed")} → {runtime.latestVersion}</span>
            </div>
          ))}
        </div>
        <p className="muted small">Installation starts only after you confirm and continues in the background. Keep Nextbrowser open until it finishes.</p>
        {runtimes.some((runtime) => runtime.runtime === "clawbrowser") && <p className="muted small">Nextbrowser will close any open Clawbrowser profiles before installing this update.</p>}
        <div className="row settings-actions">
          <button className="secondary" autoFocus onClick={onLater}>Later</button>
          <span className="spacer" />
          <button className="primary" onClick={() => onConfirm(runtimes.map((runtime) => runtime.runtime))}>{isFirstInstall ? "Install" : "Update"} {runtimes.length > 1 ? `${runtimes.length} toolsets` : "now"}</button>
        </div>
      </div>
    </div>
  );
}

export function ClawbrowserCloseProfilesPrompt({ profileNames, onCancel, onConfirm }: {
  profileNames: string[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="modal-overlay"
      onKeyDown={(event) => {
        if (!shouldDismissModalWithEscape(event)) return;
        event.preventDefault();
        onCancel();
      }}
    >
      <div className="modal-card runtime-update-prompt" role="dialog" aria-modal="true" aria-labelledby="close-profiles-title">
        <div className="modal-title-row">
          <Icon name="exclamationmark.triangle.fill" size={19} className="warn" />
          <strong id="close-profiles-title">
            You have {profileNames.length === 1 ? "an open session" : "open sessions"} in this toolset. We'll close {profileNames.length === 1 ? "it" : "them all"} before updating.
          </strong>
        </div>
        <div className="row settings-actions">
          <button className="secondary" autoFocus onClick={onCancel}>Cancel</button>
          <span className="spacer" />
          <button className="primary" onClick={onConfirm}>Continue the update</button>
        </div>
      </div>
    </div>
  );
}
