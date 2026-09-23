import type { Conversation, Workspace } from "../types";

/** Empty workspaces are valid; only a new account needs initial setup. */
export function requiresWorkspaceSetup(
  workspaces: Workspace[],
  _conversations: Conversation[],
  _activeWorkspaceId?: string,
): boolean {
  return workspaces.length === 0;
}
