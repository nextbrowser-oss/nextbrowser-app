import type { Conversation, Workspace } from "../types";
import { settingsStorage } from "./settingsStorage";

const setupDoneKey = (ownerId: string) => `workspaceSetupDone:${ownerId}`;

function readSetupDone(ownerId?: string): boolean {
  if (!ownerId) return false;
  try {
    return settingsStorage.getItem(setupDoneKey(ownerId)) === "1";
  } catch {
    return false;
  }
}

export function markWorkspaceSetupDone(ownerId?: string): void {
  if (!ownerId) return;
  try {
    settingsStorage.setItem(setupDoneKey(ownerId), "1");
  } catch {
    // Storage can be unavailable; the account then behaves like a new one.
  }
}

/**
 * Empty workspaces are valid; only a new account needs initial setup. Once an
 * account has owned a workspace, deleting its last one is intentional and the
 * defaults must not be recreated.
 */
export function requiresWorkspaceSetup(
  workspaces: Workspace[],
  _conversations: Conversation[],
  _activeWorkspaceId?: string,
  accountOwnerId?: string,
): boolean {
  if (workspaces.length > 0) {
    markWorkspaceSetupDone(accountOwnerId);
    return false;
  }
  return !readSetupDone(accountOwnerId);
}
