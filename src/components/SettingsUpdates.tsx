import type { ReactNode } from "react";
import type { BrowserRuntimeUpdateEntry } from "./BrowserRuntimeUpdatePrompt";
import { InstallationProgress } from "./InstallationProgress";
import { Icon, Spinner } from "./Icon";
import { availableRuntimeUpdates, browserRuntimeUpdateLabel, canStartUpdates, runtimeUpdateAction, type AppUpdateStatus, type BrowserRuntimeUpdateInstallStatus, type BrowserRuntimeUpdateStatus } from "../lib/settingsUpdates";
import { humanBytes } from "../types";
import { downloadableBrowsers, runtimeInstalling, runtimeInstallation } from "../lib/settingsUpdates";
import { RuntimeInstallationProgress } from "./RuntimeInstallationProgress";

export function SettingsUpdates({ appVersion, appUpdate, appLabel, appActions, runtimes, operation, nextctlVersion, cliUpdating, cliError, cliStatus, agentName, agentVersion, bulkUpdating, bulkOutcome, onCheck, onUpdateAll, onDownloadAll, onUpdateCli, onUpdateRuntime, onShowProgress, onCancel }: {
  appVersion: string;
  appUpdate: AppUpdateStatus;
  appLabel: ReactNode;
  appActions: ReactNode;
  runtimes: BrowserRuntimeUpdateStatus;
  operation: BrowserRuntimeUpdateInstallStatus;
  nextctlVersion: string;
  cliUpdating: boolean;
  cliError?: string;
  cliStatus?: string;
  agentName: string;
  agentVersion: string;
  bulkUpdating: boolean;
  bulkOutcome?: string;
  onCheck: () => void;
  onUpdateAll: () => void;
  onDownloadAll: () => void;
  onUpdateCli: () => void;
  onUpdateRuntime: (runtime: BrowserRuntimeUpdateEntry) => void;
  onShowProgress: () => void;
  onCancel: (runtime?: BrowserRuntimeUpdateEntry["runtime"]) => void;
}) {
  const checking = runtimes.status === "checking" || appUpdate.status === "checking";
  const canStart = canStartUpdates(appUpdate, operation, cliUpdating, bulkUpdating);
  const running = operation.status === "installing";
  const updates = availableRuntimeUpdates(runtimes.runtimes);
  const canInstall = !cliUpdating && !bulkUpdating && appUpdate.status !== "downloading";
  const downloads = downloadableBrowsers(runtimes.runtimes, operation);
  return <>
    <div className="settings-updates-toolbar">
      <button className="secondary small" disabled={checking || !canStart} onClick={onCheck}>{checking ? <Spinner size={12} /> : <Icon name="arrow.clockwise" size={12} />} Check for updates</button>
      <div className="row">
        <button className="secondary small" disabled={!canInstall || !downloads.length} onClick={onDownloadAll} title="Download and install missing Clawbrowser and Camoufox browsers">Download all</button>
        <button className="primary small" disabled={checking || !canStart} onClick={onUpdateAll}>{bulkUpdating ? "Updating…" : "Update all"}</button>
      </div>
    </div>
    <p className="muted small">Download all installs missing Clawbrowser and Camoufox browsers together. Update all updates installed components. Restart when you're ready.</p>
    {bulkOutcome && <p className="settings-update-outcome small" role="status">{bulkOutcome}</p>}
    {running && <div className="settings-group settings-operation" role="status">
      <strong>{operation.items?.length ? "Browser installations" : operation.currentName ? `Updating ${operation.currentName}` : "Checking updates"}</strong>
      <p className="muted small">{operation.message}</p>
      {!operation.items?.length && <><InstallationProgress label={`Updating ${operation.currentName || "browser toolsets"}`} percent={operation.percent} />
      <span className="muted small">{operation.percent !== undefined ? `${operation.percent}% downloaded` : operation.phase === "installing" ? "Installing — duration depends on this component" : "Working…"}{operation.receivedBytes ? ` · ${humanBytes(operation.receivedBytes)}` : ""}</span></>}
      <div className="row"><button className="mini" onClick={onShowProgress}>Show progress</button><button className="mini" disabled={operation.cancelRequested} onClick={() => onCancel()}>{operation.cancelRequested ? "Stopping…" : operation.items?.length ? "Stop all installations" : operation.canCancel ? "Cancel update" : "Stop after this component"}</button></div>
    </div>}
    {!running && operation.status !== "idle" && <div className="settings-group settings-operation" role="status"><strong>{operation.status === "ready" ? "Browser toolsets ready" : operation.status === "cancelled" ? "Updates stopped" : "Some updates need attention"}</strong><p className="small">{operation.message}</p>{!!operation.errors?.length && <button className="mini" onClick={onShowProgress}>Review and retry</button>}</div>}
    <div className="settings-group settings-runtime-list">
      <div className="settings-runtime-row">
        <div className="settings-runtime-copy"><strong>Nextbrowser</strong><span className="muted small">Installed {appVersion}</span><span className="small">{appLabel}</span></div>
        <div className="settings-update-cell">{appActions}</div>
      </div>
      {appUpdate.status === "downloading" && <InstallationProgress label="Downloading Nextbrowser" percent={appUpdate.percent} />}
      <div className="settings-runtime-row">
        <div className="settings-runtime-copy"><strong>nextctl</strong><span className="muted small">{nextctlVersion || "Not detected"}</span>{(cliStatus || cliError) && <span className="small">{cliError || cliStatus}</span>}</div>
        <button className="mini" disabled={!canStart} onClick={onUpdateCli}>{cliUpdating ? "Updating…" : "Check and update"}</button>
      </div>
      {runtimes.runtimes.map((runtime) => {
        const action = runtimeUpdateAction(runtime, operation);
        const item = runtimeInstallation(operation, runtime.runtime);
        return <div className="settings-runtime-entry" key={runtime.runtime}><div className="settings-runtime-row">
          <span className={"settings-runtime-dot " + (runtime.status === "available" ? "is-update" : runtime.status === "up-to-date" ? "is-ready" : "")} />
          <div className="settings-runtime-copy"><strong>{runtime.name}</strong><span className={runtime.status === "available" ? "warn small" : "muted small"}>{browserRuntimeUpdateLabel(runtime)}</span>{(runtime.availabilityMessage || runtime.error) && <span className="muted small settings-runtime-explanation">{runtime.availabilityMessage || runtime.error}</span>}</div>
          {action && <button className="mini primary-mini" disabled={!canInstall || runtimeInstalling(operation, runtime.runtime)} onClick={() => onUpdateRuntime(runtime)}>{action}</button>}
        </div>{item && <RuntimeInstallationProgress item={item} onCancel={onCancel} />}</div>;
      })}
      {runtimes.runtimes.length === 0 && <p className="muted small">{checking ? "Checking browser toolsets…" : "Check for updates to load browser versions."}</p>}
      <div className="settings-runtime-row">
        <div className="settings-runtime-copy"><strong>{agentName}</strong><span className="muted small">{agentVersion || "Not detected"} · Updated with its own installer</span></div>
      </div>
    </div>
    {(runtimes.status === "partial" || runtimes.status === "error") && <p className="small" role="status">Some update checks failed. Installed components are unaffected. Check again to retry.</p>}
    {!checking && !!runtimes.checkedAt && <p className="muted small">Checked {new Date(runtimes.checkedAt).toLocaleTimeString()} · {updates.length} browser update{updates.length === 1 ? "" : "s"} available</p>}
  </>;
}
