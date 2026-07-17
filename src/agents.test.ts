import { describe, expect, it } from "vitest";
import { agentById, agentInvocation, nextctlAgentAdapter } from "./agents";

describe("agent invocation parity", () => {
  it("maps app agent ids to nextctl adapters", () => {
    expect(nextctlAgentAdapter("claude")).toBe("claude-code");
    expect(nextctlAgentAdapter("codex")).toBe("codex");
  });
  it.each([
    ["claude", ["-p", "--dangerously-skip-permissions", "hello"], undefined],
    ["codex", ["exec", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", "-"], "hello"],
    ["hermes", ["-z", "hello"], undefined],
    ["kilo", ["run", "hello"], undefined],
    ["openclaw", ["agent", "--agent", "main", "--message", "hello", "--local"], undefined],
    ["cline", ["hello"], undefined],
    ["pi", ["-p", "hello"], undefined],
  ])("builds the exact %s command", (id, args, stdin) => {
    expect(agentInvocation(agentById(id as string), "hello")).toEqual({
      args,
      ...(stdin === undefined ? {} : { stdin }),
    });
  });
});
