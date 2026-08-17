import { describe, expect, it } from "vitest";
import type { Conversation, MessageStatus } from "../types";
import { shouldApplyRemoteConversation } from "./conversationSync";

function conversation(status: MessageStatus, updatedAt: number, replyId = "reply"): Conversation {
  return {
    id: "chat",
    title: "Chat",
    agent: "codex",
    messages: [{
      id: replyId,
      role: "assistant",
      text: "",
      status,
      createdAt: 1,
    }],
    createdAt: 1,
    updatedAt,
  };
}

describe("conversation cloud sync", () => {
  it.each<MessageStatus>(["done", "failed", "cancelled", "timedOut"])(
    "does not downgrade a local %s reply to a newer remote streaming snapshot",
    (status) => {
      expect(shouldApplyRemoteConversation(
        conversation(status, 10),
        conversation("streaming", 20),
        20,
      )).toBe(false);
    },
  );

  it("accepts a remote terminal result for a locally streaming reply", () => {
    expect(shouldApplyRemoteConversation(
      conversation("streaming", 10),
      conversation("done", 20),
      20,
    )).toBe(true);
  });

  it("uses timestamps when the latest reply is different", () => {
    expect(shouldApplyRemoteConversation(
      conversation("done", 10, "local-reply"),
      conversation("streaming", 20, "remote-reply"),
      20,
    )).toBe(true);
    expect(shouldApplyRemoteConversation(
      conversation("done", 20, "local-reply"),
      conversation("done", 10, "remote-reply"),
      10,
    )).toBe(false);
  });
});
