import { describe, expect, it } from "vitest";
import type { ChatMessage, Conversation } from "../types";
import { executionTargetForTurn } from "./executionTarget";
import { VPS_PROMPT_MARKER } from "./vpsPrompt";

function message(id: string, role: ChatMessage["role"], text: string): ChatMessage {
  return { id, role, text, status: "done", createdAt: 1 };
}

function conversation(messages: ChatMessage[], executionTarget?: "local" | "vps"): Conversation {
  return {
    id: "conversation",
    title: "Chat",
    agent: "codex",
    messages,
    createdAt: 1,
    updatedAt: 1,
    executionTarget,
  };
}

describe("executionTargetForTurn", () => {
  it("does not infer a VPS target from user-authored markers", () => {
    const conv = conversation([
      message("local-user", "user", "Run locally"),
      { ...message("local-reply", "assistant", ""), status: "queued" },
      message("vps-user", "user", `${VPS_PROMPT_MARKER}\nUse VPS`),
      { ...message("vps-reply", "assistant", ""), status: "queued" },
    ]);

    expect(executionTargetForTurn(conv)).toBe("local");
  });

  it("keeps follow-up turns on the persisted conversation target", () => {
    const conv = conversation([], "vps");
    expect(executionTargetForTurn(conv)).toBe("vps");
  });

  it("does not pass through an invalid persisted execution target", () => {
    const conv = conversation([]);
    (conv as unknown as { executionTarget: string }).executionTarget = "remote";
    expect(executionTargetForTurn(conv)).toBe("local");
  });
});
