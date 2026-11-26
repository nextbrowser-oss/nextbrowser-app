import { formattingLocale, translate } from "../shared/lib/i18n";
import { Tooltip } from "../shared/ui";
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
      <button className="secondary small" disabled={checking || !canStart} onClick={onCheck}>{checking ? <Spinner size={12} /> : <Icon name="arrow.clockwise" size={12} />} {translate("Check for updates")}</button>
      <div className="row">
        <Tooltip content={translate("Download and install missing Clawbrowser and Camoufox browsers")}><button className="secondary small" disabled={!canInstall || !downloads.length} onClick={onDownloadAll}>{translate("Download all")}</button></Tooltip>
        <button className="primary small" disabled={checking || !canStart} onClick={onUpdateAll}>{bulkUpdating ? translate("Updating…") : translate("Update all")}</button>
      </div>
    </div>
    <p className="muted small">{translate("Missing Clawbrowser and Camoufox browsers install automatically at startup. You can also start or retry a download here.")}</p>
    {bulkOutcome && <p className="settings-update-outcome small" role="status">{bulkOutcome}</p>}
    {running && <div className="settings-group settings-operation" role="status">
      <strong>{operation.items?.length ? translate("Browser installations") : operation.currentName ? translate("Updating %1", operation.currentName) : translate("Checking updates")}</strong>
      <p className="muted small">{operation.message}</p>
      {!operation.items?.length && <><InstallationProgress label={translate("Updating %1", operation.currentName || "browser toolsets")} percent={operation.percent} />
      <span className="muted small">{operation.percent !== undefined ? translate("%1% downloaded", operation.percent) : operation.phase === "installing" ? translate("Installing — duration depends on this component") : translate("Working…")}{operation.receivedBytes ? ` · ${humanBytes(operation.receivedBytes)}` : ""}</span></>}
      <div className="row"><button className="mini" onClick={onShowProgress}>{translate("Show progress")}</button><button className="mini" disabled={operation.cancelRequested} onClick={() => onCancel()}>{operation.cancelRequested ? translate("Stopping…") : operation.items?.length ? translate("Stop all installations") : operation.canCancel ? translate("Cancel update") : translate("Stop after this component")}</button></div>
    </div>}
    {!running && operation.status !== "idle" && <div className="settings-group settings-operation" role="status"><strong>{operation.status === "ready" ? translate("Browser toolsets ready") : operation.status === "cancelled" ? translate("Updates stopped") : translate("Some updates need attention")}</strong><p className="small">{operation.message}</p>{!!operation.errors?.length && <button className="mini" onClick={onShowProgress}>{translate("Review and retry")}</button>}</div>}
    <div className="settings-group settings-runtime-list">
      <div className="settings-runtime-row">
        <div className="settings-runtime-copy"><strong>Nextbrowser</strong><span className="muted small">{translate("Installed")} {appVersion}</span><span className="small">{appLabel}</span></div>
        <div className="settings-update-cell">{appActions}</div>
      </div>
      {appUpdate.status === "downloading" && <InstallationProgress label={translate("Downloading Nextbrowser")} percent={appUpdate.percent} />}
      <div className="settings-runtime-row">
        <div className="settings-runtime-copy"><strong>{translate("nextctl")}</strong><span className="muted small">{nextctlVersion || translate("Not detected")}</span>{(cliStatus || cliError) && <span className="small">{cliError || cliStatus}</span>}</div>
        <button className="mini" disabled={!canStart} onClick={onUpdateCli}>{cliUpdating ? translate("Updating…") : translate("Check and update")}</button>
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
      {runtimes.runtimes.length === 0 && <p className="muted small">{checking ? translate("Checking browser toolsets…") : translate("Check for updates to load browser versions.")}</p>}
      <div className="settings-runtime-row">
        <div className="settings-runtime-copy"><strong>{agentName}</strong><span className="muted small">{agentVersion || translate("Not detected")} {translate("· Updated with its own installer")}</span></div>
      </div>
    </div>
    {(runtimes.status === "partial" || runtimes.status === "error") && <p className="small" role="status">{translate("Some update checks failed. Installed components are unaffected. Check again to retry.")}</p>}
    {!checking && !!runtimes.checkedAt && <p className="muted small">{translate("Checked")} {new Date(runtimes.checkedAt).toLocaleTimeString(formattingLocale())} · {translate("Available browser updates: %1", updates.length)}</p>}
  </>;
}
