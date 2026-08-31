import type { Workspace } from "../types";

/** An optimistic workspace write can race with another signed-in device. */
export function isWorkspaceRevisionConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /workspace revision conflict/i.test(message);
}

/**
 * Preserve both devices' profile associations when retrying an optimistic
 * workspace update. The local edit wins only for the same profile key, while
 * profiles introduced remotely are retained.
 */
export function mergeWorkspaceAfterRevisionConflict(local: Workspace, remote: Workspace): Workspace {
  return {
    ...local,
    profileNames: [...new Set([...remote.profileNames, ...local.profileNames])],
    profileToolsets: { ...remote.profileToolsets, ...local.profileToolsets },
    profileProxyIds: { ...(remote.profileProxyIds ?? {}), ...(local.profileProxyIds ?? {}) },
  };
}
