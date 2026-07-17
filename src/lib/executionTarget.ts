import type { Conversation } from "../types";

export type ExecutionTarget = "local" | "vps";

export function executionTargetForTurn(
  conversation: Conversation | undefined,
): ExecutionTarget {
  if (conversation?.executionTarget === "vps") return "vps";
  if (conversation?.executionTarget === "local") return "local";
  return "local";
}
