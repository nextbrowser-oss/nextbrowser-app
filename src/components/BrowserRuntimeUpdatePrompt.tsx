import { translate } from "../shared/lib/i18n";
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
  availabilityMessage?: string;
  installed?: boolean;
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
            <strong id="runtime-update-title">{isFirstInstall ? translate("Install browser toolset") : translate("Browser toolset update available")}</strong>
            <div className="muted small">{isFirstInstall ? translate("Nextbrowser will download and prepare it for a new profile.") : translate("Choose when Nextbrowser may install it.")}</div>
          </div>
        </div>
        <div className="runtime-update-prompt-list">
          {runtimes.map((runtime) => (
            <div className="runtime-update-prompt-row" key={runtime.runtime}>
              <strong>{runtime.name}</strong>
              <span className="muted small">{runtime.currentVersion ?? (runtime.status === "not-installed" ? translate("Not installed") : translate("Installed"))} → {runtime.latestVersion}</span>
            </div>
          ))}
        </div>
        <p className="muted small">{translate("Installation starts only after you confirm and continues in the background. Keep Nextbrowser open until it finishes.")}</p>
        {runtimes.some((runtime) => runtime.runtime === "clawbrowser") && <p className="muted small">{translate("Nextbrowser will close any open Clawbrowser profiles before installing this update.")}</p>}
        <div className="row settings-actions">
          <button className="secondary" autoFocus onClick={onLater}>{translate("Later")}</button>
          <span className="spacer" />
          <button className="primary" onClick={() => onConfirm(runtimes.map((runtime) => runtime.runtime))}>{isFirstInstall ? translate("Install") : translate("Update")} {runtimes.length > 1 ? translate("%1 toolsets", runtimes.length) : translate("now")}</button>
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
          <strong id="close-profiles-title">{translate("You have")} {profileNames.length === 1 ? translate("an open session") : translate("open sessions")} {translate("in this toolset. We'll close")} {profileNames.length === 1 ? translate("it") : translate("them all")} {translate("before updating.")}</strong>
        </div>
        <div className="row settings-actions">
          <button className="secondary" autoFocus onClick={onCancel}>{translate("Cancel")}</button>
          <span className="spacer" />
          <button className="primary" onClick={onConfirm}>{translate("Continue the update")}</button>
        </div>
      </div>
    </div>
  );
}
