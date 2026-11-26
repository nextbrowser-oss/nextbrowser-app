import { translate } from "../shared/lib/i18n";
import type { BrowserRuntimeInstallItem } from "../lib/settingsUpdates";
import { humanBytes } from "../types";
import { InstallationProgress } from "./InstallationProgress";

export function RuntimeInstallationProgress({ item, onCancel }: {
  item: BrowserRuntimeInstallItem;
  onCancel?: (runtime: BrowserRuntimeInstallItem["runtime"]) => void;
}) {
  const running = item.status === "installing";
  const phase = item.phase === "checking" ? translate("Checking availability") : item.phase === "preparing" ? translate("Preparing installation")
    : item.phase === "verifying" ? translate("Verifying installation") : item.phase === "downloading" ? translate("Downloading") : translate("Installing");
  return <div className="runtime-install-item" role="group" aria-label={translate("%1 installation", item.name)}>
    <strong className="small">{item.name} · {running ? phase : item.status === "ready" ? translate("Ready to use") : item.status === "cancelled" ? translate("Stopped") : translate("Needs attention")}</strong>
    {running && <InstallationProgress label={`${item.name} · ${phase}`} percent={item.phase === "downloading" ? item.percent : undefined} />}
    <span className="muted small">{running && item.phase === "downloading" && item.percent !== undefined ? translate("%1% downloaded", item.percent) : item.message}
      {running && item.receivedBytes !== undefined ? ` · ${humanBytes(item.receivedBytes)}${item.totalBytes ? ` / ${humanBytes(item.totalBytes)}` : ""}` : ""}</span>
    {running && onCancel && <button className="mini" disabled={item.cancelRequested} onClick={() => onCancel(item.runtime)}>{item.cancelRequested ? translate("Stopping…") : item.canCancel ? translate("Cancel %1 download", item.name) : translate("Stop %1 after installation", item.name)}</button>}
    {!running && item.errors?.map((error) => <span className="small" key={error.code}>{error.recovery || error.message}</span>)}
  </div>;
}
