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

  const chat = (updatedAt: number, messages: Array<[string, "user" | "assistant" | "system", MessageStatus, string]>): Conversation => ({
    id: "chat",
    title: "Chat",
    agent: "codex",
    messages: messages.map(([id, role, status, text]) => ({ id, role, status, text, createdAt: 1 })),
    createdAt: 1,
    updatedAt,
  });

  it("keeps steps and a failure written after this device's last upload", () => {
    const local = chat(10, [["steps", "system", "failed", "Browser setup stopped. Could not finish loading facebook.com"]]);
    const remote = chat(20, [["steps", "system", "done", "✓ Session running   ✓ Using running session"]]);
    expect(shouldApplyRemoteConversation(local, remote, 20)).toBe(false);
  });

  it("keeps a reply streaming here over the queued copy it uploaded", () => {
    const local = chat(10, [["ask", "user", "done", "Draft a reply"], ["reply", "assistant", "streaming", "Signed in as Mike"]]);
    const remote = chat(20, [["ask", "user", "done", "Draft a reply"], ["reply", "assistant", "queued", ""]]);
    expect(shouldApplyRemoteConversation(local, remote, 20)).toBe(false);
  });

  it("keeps messages added here that the cloud copy does not have yet", () => {
    const local = chat(10, [["steps", "system", "done", "✓ Page ready"], ["ask", "user", "done", "Draft a reply"], ["reply", "assistant", "done", "Nothing posted"]]);
    const remote = chat(20, [["steps", "system", "done", "✓ Page ready"]]);
    expect(shouldApplyRemoteConversation(local, remote, 20)).toBe(false);
  });

  it("still takes a newer cloud copy of the same messages, for its title and settings", () => {
    const local = chat(10, [["ask", "user", "done", "Hello"]]);
    const remote = { ...chat(20, [["ask", "user", "done", "Hello"]]), title: "Renamed elsewhere" };
    expect(shouldApplyRemoteConversation(local, remote, 20)).toBe(true);
  });
});
