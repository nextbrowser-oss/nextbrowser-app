import { describe, expect, it } from "vitest";
import { terminalActivityPreview, terminalAgentReady, terminalInputShouldQueueBeforeReady } from "./terminalReadiness";

describe("terminal readiness", () => {
  it("waits for the Codex prompt instead of the banner", () => {
    expect(terminalAgentReady("codex", "OpenAI Codex\nMCP server starting…")).toBe(false);
    expect(terminalAgentReady("codex", "OpenAI Codex\n\x1b[1m› \x1b[0m")).toBe(true);
  });

  it("recognizes the usable Codex prompt after partial MCP startup", () => {
    const output = "MCP startup interrupted.\n› Ask Codex to do anything\n\ngpt-5.6-sol low · ~/.nextbrowser/workspace";
    expect(terminalAgentReady("codex", output)).toBe(true);
  });

  it("queues bracketed paste while startup is still finishing", () => {
    expect(terminalInputShouldQueueBeforeReady("\x1b[200~Open Wikipedia\x1b[201~")).toBe(true);
    expect(terminalInputShouldQueueBeforeReady("\x1b[A")).toBe(false);
  });

  it("allows Claude first-run setup to receive input", () => {
    expect(terminalAgentReady("claude", "Choose the text style that looks best")).toBe(true);
  });

  it("uses meaningful terminal output as the project preview", () => {
    expect(terminalActivityPreview("Tip: hello\n• Found 5 matching cars\n› ")).toBe("Found 5 matching cars");
  });
});
