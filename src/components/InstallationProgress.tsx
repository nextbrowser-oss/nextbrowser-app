import { Spinner } from "./Icon";

/** Shared indicator for setup stages that do not report byte-level progress. */
export function InstallationSpinner() {
  return <div className="browser-install-mark"><Spinner size={22} /></div>;
}

export function InstallationProgress({ label, percent }: { label: string; percent?: number }) {
  const value = typeof percent === "number" && Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : undefined;
  return <div className={"browser-install-progress" + (value !== undefined ? " is-determinate" : "")} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><span style={value !== undefined ? { width: `${value}%` } : undefined} /></div>;
}
