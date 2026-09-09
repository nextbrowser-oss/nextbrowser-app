import { describe, expect, it } from "vitest";
import { codexMcpRecovery } from "./codexMcpRecovery";

describe("codexMcpRecovery", () => {
  it("explains the malformed legacy MCP config", () => {
    expect(codexMcpRecovery("codex", "Error loading config.toml: invalid transport\nin mcp_servers.clawbrowser"))
      .toContain("remove or repair");
  });

  it("does not attach Codex recovery guidance to another terminal", () => {
    expect(codexMcpRecovery("claude", "MCP startup incomplete (failed: clawbrowser)")).toBeUndefined();
  });
});
