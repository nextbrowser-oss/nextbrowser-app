import type { Conversation, Workspace } from "../types";

/** Setup is complete only when the selected workspace has a chat and profile. */
export function requiresWorkspaceSetup(
  workspaces: Workspace[],
  conversations: Conversation[],
  activeWorkspaceId?: string,
): boolean {
  const workspace = workspaces.find((item) => item.id === activeWorkspaceId) ?? workspaces[0];
  if (!workspace) return true;
  return workspace.profileNames.length === 0
    || !conversations.some((conversation) => conversation.workspaceId === workspace.id);
}
