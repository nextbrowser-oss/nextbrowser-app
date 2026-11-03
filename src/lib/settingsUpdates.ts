import type { BrowserRuntimeUpdateEntry } from "../components/BrowserRuntimeUpdatePrompt";

export interface AppUpdateStatus {
  status?: string;
  version?: string;
  percent?: number;
  message?: string;
}

export interface BrowserRuntimeUpdateStatus {
  status: "idle" | "checking" | "ready" | "partial" | "error";
  checkedAt?: number;
  message?: string;
  runtimes: BrowserRuntimeUpdateEntry[];
}

export interface BrowserRuntimeUpdateInstallStatus {
  updatedAt?: number;
  status: "idle" | "installing" | "ready" | "partial" | "failed" | "cancelled";
  runtimes?: BrowserRuntimeUpdateEntry["runtime"][];
  completed?: BrowserRuntimeUpdateEntry["runtime"][];
  currentRuntime?: BrowserRuntimeUpdateEntry["runtime"];
  currentName?: string;
  currentVersion?: string;
  total?: number;
  progress?: number;
  percent?: number;
  receivedBytes?: number;
  totalBytes?: number;
  phase?: "checking" | "preparing" | "downloading" | "installing" | "verifying";
  canCancel?: boolean;
  cancelRequested?: boolean;
  message?: string;
  errors?: {
    runtime: BrowserRuntimeUpdateEntry["runtime"];
    name: string;
    releasePage?: string;
    code?: string;
    category?: string;
    retryable?: boolean;
    message: string;
    recovery?: string;
  }[];
}

export function latestRuntimeOperation(current: BrowserRuntimeUpdateInstallStatus, incoming: BrowserRuntimeUpdateInstallStatus) {
  if (current.status === "installing" && incoming.status === "idle" && !incoming.updatedAt) return current;
  if (current.updatedAt && incoming.updatedAt && incoming.updatedAt < current.updatedAt) return current;
  return incoming;
}

export function browserRuntimeUpdateLabel(runtime: BrowserRuntimeUpdateEntry): string {
  if (runtime.status === "available") return `${runtime.currentVersion ?? "Installed"} → ${runtime.latestVersion ?? "new version"}`;
  if (runtime.status === "up-to-date") return `${runtime.currentVersion ?? runtime.latestVersion ?? "Installed"} · Up to date`;
  if (runtime.status === "not-installed") return runtime.latestVersion ? `Not installed · Latest ${runtime.latestVersion}` : "Not installed";
  if (runtime.status === "unavailable") return "No compatible download found";
  if (runtime.status === "error") return `${runtime.currentVersion ? `Installed ${runtime.currentVersion} · ` : ""}Couldn't check for updates`;
  return runtime.currentVersion ? `Installed ${runtime.currentVersion} · Update availability unknown` : "Installed version unknown";
}

export function runtimeUpdateAction(runtime: BrowserRuntimeUpdateEntry, operation: BrowserRuntimeUpdateInstallStatus): string | undefined {
  if (operation.status === "installing" && operation.runtimes?.includes(runtime.runtime)) {
    if (operation.completed?.includes(runtime.runtime)) return "Updated";
    return operation.currentRuntime === runtime.runtime ? "Updating…" : "Queued";
  }
  return runtime.status === "available" ? "Update" : runtime.status === "not-installed" ? "Install" : undefined;
}

/** Bulk updates never install optional, previously missing browsers. */
export function availableRuntimeUpdates(runtimes: readonly BrowserRuntimeUpdateEntry[]) {
  return runtimes.filter((runtime) => runtime.status === "available").map((runtime) => runtime.runtime);
}

export function canStartUpdates(app: AppUpdateStatus, operation: BrowserRuntimeUpdateInstallStatus, cliUpdating: boolean, bulkUpdating: boolean) {
  return !bulkUpdating && !cliUpdating && operation.status !== "installing" && app.status !== "downloading";
}
