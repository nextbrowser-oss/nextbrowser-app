import { Spinner } from "./Icon";

/** Shared indicator for setup stages that do not report byte-level progress. */
export function InstallationSpinner() {
  return <div className="browser-install-mark"><Spinner size={22} /></div>;
}

export function InstallationProgress({ label }: { label: string }) {
  return <div className="browser-install-progress" role="progressbar" aria-label={label}><span /></div>;
}
