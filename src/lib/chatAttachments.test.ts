import { describe, expect, it } from "vitest";
import { promptWithAttachments, terminalAttachmentContext } from "./chatAttachments";

describe("chat attachments", () => {
  it("passes exact local paths to the agent", () => {
    expect(promptWithAttachments("Review", [
      { name: "brief one.pdf", path: "/tmp/brief one.pdf", size: 42 },
      { name: "data.csv", path: "/tmp/data.csv", size: 12 },
    ])).toBe("Review\n\n[Attached local files — open/read these exact paths:]\n- /tmp/brief one.pdf\n- /tmp/data.csv");
  });

  it("does not alter prompts without attachments", () => {
    expect(promptWithAttachments("Hello", [])).toBe("Hello");
  });

  it("builds terminal context from staged attachment paths", () => {
    expect(terminalAttachmentContext([
      { name: "brief.pdf", path: "/workspace/.attachments/chat/brief.pdf", size: 42 },
    ])).toBe("[Attached local files — open/read these exact paths:]\n- /workspace/.attachments/chat/brief.pdf");
    expect(terminalAttachmentContext([])).toBeUndefined();
  });
});
