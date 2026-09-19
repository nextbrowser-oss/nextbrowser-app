import type { Workspace } from "../types";

/** An optimistic workspace write can race with another signed-in device. */
export function isWorkspaceRevisionConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /workspace revision conflict/i.test(message);
}

/** Chats carry the same optimistic-revision contract as workspaces. */
export function isProjectRevisionConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /project revision conflict/i.test(message);
}

/**
 * The backend does not have this workspace for the signed-in account. Its id
 * may belong to another account (the primary key is global) or have been
 * removed server-side. The sync must not fail the user's profile action over
 * it, so this is handled like the foreign-workspace case.
 */
export function isWorkspaceNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const status = (error as { status?: number } | null)?.status;
  return status === 404 || /workspace not found/i.test(message);
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
