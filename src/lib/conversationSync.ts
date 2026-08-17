import type { Conversation, MessageStatus } from "../types";

const terminalStatuses = new Set<MessageStatus>([
  "done",
  "failed",
  "cancelled",
  "timedOut",
]);

export function shouldApplyRemoteConversation(
  local: Conversation,
  remote: Conversation,
  remoteUpdatedAt: number,
): boolean {
  const localLast = local.messages.at(-1);
  const remoteLast = remote.messages.at(-1);
  if (
    localLast
    && remoteLast
    && localLast.id === remoteLast.id
    && terminalStatuses.has(localLast.status)
    && !terminalStatuses.has(remoteLast.status)
  ) return false;
  return remoteUpdatedAt >= local.updatedAt;
}
