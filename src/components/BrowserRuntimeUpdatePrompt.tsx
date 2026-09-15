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
    <div className="modal-overlay">
      <div className="modal-card runtime-update-prompt" role="dialog" aria-modal="true" aria-labelledby="runtime-update-title">
        <div className="modal-title-row">
          <Icon name="arrow.down.circle" size={19} className="warn" />
          <div>
            <strong id="runtime-update-title">{isFirstInstall ? "Install browser toolset" : "Browser toolset update available"}</strong>
            <div className="muted small">{isFirstInstall ? "NextBrowser will download and prepare it for a new profile." : "Choose when NextBrowser may install it."}</div>
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
        <p className="muted small">Installation starts only after you confirm and continues in the background. Keep NextBrowser open until it finishes.</p>
        {runtimes.some((runtime) => runtime.runtime === "clawbrowser") && <p className="muted small">Stop running ClawBrowser profiles first; NextBrowser won’t close them automatically.</p>}
        <div className="row settings-actions">
          <button className="secondary" onClick={onLater}>Later</button>
          <span className="spacer" />
          <button className="primary" onClick={() => onConfirm(runtimes.map((runtime) => runtime.runtime))}>{isFirstInstall ? "Install" : "Update"} {runtimes.length > 1 ? `${runtimes.length} toolsets` : "now"}</button>
        </div>
      </div>
    </div>
  );
}
