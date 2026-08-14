import { describe, expect, it } from "vitest";
import {
  chatPromptWithDeferredContext,
  chatToTerminalHandoff,
  terminalInputWithDeferredContext,
  terminalToChatHandoff,
} from "./contextHandoff";

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

  it("drops stopped replies and technical skill payloads", () => {
    const result = chatToTerminalHandoff([
      { id: "1", role: "user", text: "Find every Space Star from 2006 or earlier", status: "done", createdAt: 1 },
      { id: "2", role: "assistant", text: "Found five listings", status: "done", createdAt: 2 },
      { id: "3", role: "user", text: "Did you check pagination?", status: "done", createdAt: 3 },
      { id: "4", role: "assistant", text: "[stopped]", status: "cancelled", createdAt: 4 },
      {
        id: "5", role: "user", status: "done", createdAt: 5,
        commandChip: { kind: "skill", title: "Bad capture" },
        text: "Use my local browser skill \"Bad capture\" for app.clawbrowser.ai.\n\nOriginal task:\n\nWorkflow instructions:\n╭ OpenAI Codex ╮\nmodel: gpt-5.6-sol",
      },
    ]);
    expect(result).toContain("Did you check pagination?");
    expect(result).toContain("Found five listings");
    expect(result).not.toContain("[stopped]");
    expect(result).not.toContain("OpenAI Codex");
    expect(result).not.toContain("app.clawbrowser.ai");
  });

  it("keeps only the actual task from a valid skill run", () => {
    const result = chatToTerminalHandoff([{
      id: "1", role: "user", status: "done", createdAt: 1,
      commandChip: { kind: "skill", title: "999 cars" },
      text: "Use my local browser skill \"999 cars\" for 999.md.\n\nTask for this run:\nFind Matiz under 3000 EUR\n\nWorkflow instructions:\nTechnical fast path: clawbrowser.start({})",
    }]);
    expect(result).toContain("Find Matiz under 3000 EUR");
    expect(result).not.toContain("Technical fast path");
    expect(result).not.toContain("Use my local browser skill");
  });

  it("attaches terminal context only when a new chat message is sent", () => {
    expect(chatPromptWithDeferredContext(undefined, "Continue")).toBeUndefined();
    expect(chatPromptWithDeferredContext("Recent terminal context", "Continue")).toBe(
      "Recent terminal context\n\nNew user message:\nContinue",
    );
  });

  it("does not inject chat context on terminal navigation keys", () => {
    expect(terminalInputWithDeferredContext("Recent chat context", "\u001b[A")).toEqual({
      data: "\u001b[A",
      consumed: false,
      userInput: false,
    });
  });

  it("prepends chat context to the first terminal message without submitting it", () => {
    const result = terminalInputWithDeferredContext("Recent chat context", "H");
    expect(result).toMatchObject({ consumed: true, userInput: true });
    expect(result.data).toContain("Recent chat context");
    expect(result.data).toContain("New user message:\n");
    expect(result.data.endsWith("H")).toBe(true);
    expect(result.data.endsWith("\r")).toBe(false);
  });
});
