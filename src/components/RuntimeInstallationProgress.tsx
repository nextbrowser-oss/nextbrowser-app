import type { BrowserRuntimeInstallItem } from "../lib/settingsUpdates";
import { humanBytes } from "../types";
import { InstallationProgress } from "./InstallationProgress";

export function RuntimeInstallationProgress({ item, onCancel }: {
  item: BrowserRuntimeInstallItem;
  onCancel?: (runtime: BrowserRuntimeInstallItem["runtime"]) => void;
}) {
  const running = item.status === "installing";
  const phase = item.phase === "checking" ? "Checking availability" : item.phase === "preparing" ? "Preparing installation"
    : item.phase === "verifying" ? "Verifying installation" : item.phase === "downloading" ? "Downloading" : "Installing";
  return <div className="runtime-install-item" role="group" aria-label={`${item.name} installation`}>
    <strong className="small">{item.name} · {running ? phase : item.status === "ready" ? "Ready to use" : item.status === "cancelled" ? "Stopped" : "Needs attention"}</strong>
    {running && <InstallationProgress label={`Downloading ${item.name}`} percent={item.phase === "downloading" ? item.percent : undefined} />}
    <span className="muted small">{running && item.phase === "downloading" && item.percent !== undefined ? `${item.percent}% downloaded` : item.message}
      {running && item.receivedBytes !== undefined ? ` · ${humanBytes(item.receivedBytes)}${item.totalBytes ? ` / ${humanBytes(item.totalBytes)}` : ""}` : ""}</span>
    {running && onCancel && <button className="mini" disabled={item.cancelRequested} onClick={() => onCancel(item.runtime)}>{item.cancelRequested ? "Stopping…" : item.canCancel ? `Cancel ${item.name} download` : `Stop ${item.name} after installation`}</button>}
    {!running && item.errors?.map((error) => <span className="small" key={error.code}>{error.recovery || error.message}</span>)}
  </div>;
}
