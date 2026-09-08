import { internalError } from "./userFacingError";

export function agentEmptyReplyMessage(agentId: string, agentName: string): string {
  if (agentId === "antigravity") {
    return internalError(
      "Antigravity CLI finished without a reply. Check that Antigravity is signed in and that its free quota is available, then retry.",
      "ANTIGRAVITY_EMPTY_REPLY",
    );
  }
  return internalError(
    `${agentName} finished without a reply. Check its connection and retry.`,
    "AGENT_EMPTY_REPLY",
  );
}
