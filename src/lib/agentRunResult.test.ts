import { describe, expect, it } from "vitest";
import { agentEmptyReplyMessage } from "./agentRunResult";

describe("agentEmptyReplyMessage", () => {
  it("gives Antigravity users a recoverable, actionable error", () => {
    expect(agentEmptyReplyMessage("antigravity", "Antigravity CLI")).toMatch(
      /^Antigravity CLI finished without a reply\. Check that Antigravity is signed in and that its free quota is available, then retry\. Ref: NB-/,
    );
  });

  it("does not present an empty successful agent result as a reply", () => {
    expect(agentEmptyReplyMessage("codex", "Codex")).toMatch(
      /^Codex finished without a reply\. Check its connection and retry\. Ref: NB-/,
    );
  });
});
