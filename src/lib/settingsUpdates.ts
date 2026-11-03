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
  items?: BrowserRuntimeInstallItem[];
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

export type BrowserRuntimeInstallItem = Omit<BrowserRuntimeUpdateInstallStatus, "items"> & {
  runtime: BrowserRuntimeUpdateEntry["runtime"];
  name: string;
};

export function runtimeInstallation(operation: BrowserRuntimeUpdateInstallStatus, runtime: BrowserRuntimeUpdateEntry["runtime"]) {
  return operation.items?.find((item) => item.runtime === runtime);
}

export function downloadableBrowsers(runtimes: readonly BrowserRuntimeUpdateEntry[], operation: BrowserRuntimeUpdateInstallStatus) {
  return runtimes.filter((runtime) => ["clawbrowser", "camoufox"].includes(runtime.runtime)
    && runtime.status === "not-installed" && !runtimeInstalling(operation, runtime.runtime));
}

export function runtimeInstalling(operation: BrowserRuntimeUpdateInstallStatus, runtime: BrowserRuntimeUpdateEntry["runtime"]) {
  const item = runtimeInstallation(operation, runtime);
  return item ? item.status === "installing" : operation.status === "installing" && !!operation.runtimes?.includes(runtime) && !operation.completed?.includes(runtime);
}

export function addPendingRuntimeInstall(current: BrowserRuntimeUpdateInstallStatus, requested: BrowserRuntimeUpdateEntry["runtime"][], candidates: BrowserRuntimeUpdateEntry[]): BrowserRuntimeUpdateInstallStatus {
  const items = current.status === "installing" ? [...(current.items || [])] : [];
  for (const runtime of requested) {
    if (items.some((item) => item.runtime === runtime && item.status === "installing")) continue;
    const candidate = candidates.find((item) => item.runtime === runtime);
    const pending: BrowserRuntimeInstallItem = { runtime, name: candidate?.name || runtime, status: "installing", phase: "checking", canCancel: true, message: "Checking download availability…" };
    const index = items.findIndex((item) => item.runtime === runtime);
    if (index < 0) items.push(pending); else items[index] = pending;
  }
  return { ...current, status: "installing", items, runtimes: items.map((item) => item.runtime), completed: items.filter((item) => item.status === "ready").map((item) => item.runtime), errors: [], currentName: undefined, currentRuntime: undefined, percent: undefined, phase: "checking", canCancel: true, cancelRequested: false, message: "Preparing browser installations…" };
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
  const item = runtimeInstallation(operation, runtime.runtime);
  if (item?.status === "installing") return "Installing…";
  if (item?.status === "failed" || item?.status === "partial") return "Retry";
  if (!operation.items && operation.status === "installing" && operation.runtimes?.includes(runtime.runtime)) {
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
