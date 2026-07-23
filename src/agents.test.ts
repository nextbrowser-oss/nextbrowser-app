import { describe, expect, it } from "vitest";
import {
  agentById,
  agentInstallName,
  agentInvocation,
  isMissingAgentInstallError,
  missingAgentInstallError,
  nextctlAgentAdapter,
} from "./agents";

describe("agent invocation parity", () => {
  it("maps app agent ids to nextctl adapters", () => {
    expect(nextctlAgentAdapter("claude")).toBe("claude-code");
    expect(nextctlAgentAdapter("codex")).toBe("codex");
  });
  it("links primary agents to their supported installation pages", () => {
    expect(agentById("claude").installUrl).toBe("https://code.claude.com/docs/en/installation");
    expect(agentById("codex").installUrl).toBe("https://chatgpt.com/download/");
    expect(agentInstallName(agentById("claude"))).toBe("Claude Code CLI");
    expect(agentInstallName(agentById("codex"))).toBe("ChatGPT desktop app with Codex");
  });
  it("turns a missing Claude executable failure into CLI installation guidance", () => {
    const error = new Error(
      "Error invoking remote method 'nextbrowser:invoke': Error: claude executable not found.",
    );

    const message = missingAgentInstallError(error, agentById("claude"));

    expect(message).toBe(
      "Claude Code CLI not found. NextBrowser needs the CLI executable to connect. Install it, then try again.",
    );
    expect(isMissingAgentInstallError(message ?? "")).toBe(true);
  });
  it("turns a missing Codex executable failure into app installation guidance", () => {
    const error = new Error(
      "Error invoking remote method 'nextbrowser:invoke': Error: codex executable not found.",
    );

    const message = missingAgentInstallError(error, agentById("codex"));

    expect(message).toBe(
      "ChatGPT desktop app with Codex not found. NextBrowser connects through the executable bundled with the app. Install it, then try again.",
    );
    expect(isMissingAgentInstallError(message ?? "")).toBe(true);
  });
  it("does not expose unrelated agent failures", () => {
    expect(missingAgentInstallError(new Error("spawn failed with secret details"), agentById("codex"))).toBeUndefined();
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
