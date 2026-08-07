import { describe, expect, it } from "vitest";
import { chatToTerminalHandoff, terminalToChatHandoff } from "./contextHandoff";

describe("chat context handoff", () => {
  it("keeps recent terminal context and active profile", () => {
    const result = terminalToChatHandoff("old\n\x1b[31mFound 2 cars\x1b[0m\nnext step", "us-cars");
    expect(result).toContain("Active browser profile: us-cars");
    expect(result).toContain("Found 2 cars");
    expect(result).not.toContain("\x1b");
  });

  it("keeps recent chat roles and browser tool names", () => {
    const result = chatToTerminalHandoff([
      { id: "1", role: "user", text: "Find Matiz", status: "done", createdAt: 1 },
      { id: "2", role: "assistant", text: "Found two", status: "done", createdAt: 2, toolEvents: [{ id: "t", name: "clawbrowser.paginate_extract", createdAt: 2 }] },
    ], "md-cars");
    expect(result).toContain("User: Find Matiz");
    expect(result).toContain("Assistant: Found two");
    expect(result).toContain("clawbrowser.paginate_extract");
    expect(result.length).toBeLessThanOrEqual(6_000);
  });
});
