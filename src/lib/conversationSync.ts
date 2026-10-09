import type { Conversation, MessageStatus } from "../types";

const terminalStatuses = new Set<MessageStatus>([
  "done",
  "failed",
  "cancelled",
  "timedOut",
]);

/** How far along a message is: queued, then streaming, then finished. */
function progress(status: MessageStatus): number {
  if (terminalStatuses.has(status)) return 2;
  return status === "streaming" ? 1 : 0;
}

export function shouldApplyRemoteConversation(
  local: Conversation,
  remote: Conversation,
  remoteUpdatedAt: number,
): boolean {
  // A cloud copy that holds no message missing here is this device's own
  // earlier upload, unless one of its replies got further than ours (a run
  // that finished elsewhere). Steps, failures and streamed text change a
  // chat without moving its updatedAt, so the server's newer timestamp alone
  // rolled them back: Draft reply steps, errors and whole replies vanished
  // from the chat a moment after they were written (2026-10-09).
  const localById = new Map(local.messages.map((message) => [message.id, message]));
  if (remote.messages.every((message) => localById.has(message.id))) {
    const further = remote.messages.some((message) => progress(message.status) > progress(localById.get(message.id)!.status));
    const same = remote.messages.length === local.messages.length && remote.messages.every((message) => {
      const mine = localById.get(message.id)!;
      return mine.status === message.status && mine.text === message.text;
    });
    if (!further && !same) return false;
  }
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
