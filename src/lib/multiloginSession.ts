import { multiloginSessionName } from "./liveStreamTarget";
import type { MultiloginProfileSelection } from "./multiloginSelection";

export type MultiloginLifecycle = "start" | "stop" | "status";
export type MultiloginSessionStatus = "running" | "starting" | "stopping" | "stopped" | "error" | "unknown";

/** nextctl arguments that start, stop, or inspect a workspace's Multilogin profile. */
export function multiloginLifecycleArgs(selection: MultiloginProfileSelection, operation: MultiloginLifecycle): string[] {
  const folder = selection.folderId ? ["--multilogin-folder-id", selection.folderId] : [];
  if (selection.kind === "mobile") {
    return ["--runtime", "multilogin", "mobile", operation, selection.id, ...(operation === "start" ? ["--no-wait"] : []), ...folder];
  }
  return [
    "--runtime", "multilogin",
    "--profile", multiloginSessionName(selection),
    "--multilogin-profile-id", selection.id,
    operation,
    ...folder,
  ];
}

/** Maps nextctl's browser `status` and cloud phone `mobile` payloads to one row status. */
export function multiloginSessionStatus(payload: unknown): MultiloginSessionStatus {
  const data = (payload ?? {}) as { status?: unknown; status_name?: unknown; mobile?: { status_name?: unknown } };
  const raw = String(data.mobile?.status_name ?? data.status_name ?? data.status ?? "").trim().toLowerCase();
  switch (raw) {
    case "running":
    case "started":
      return "running";
    case "starting":
    case "launching":
      return "starting";
    case "stopping":
      return "stopping";
    case "stopped":
    case "expired":
      return "stopped";
    case "error":
      return "error";
    default:
      return "unknown";
  }
}
