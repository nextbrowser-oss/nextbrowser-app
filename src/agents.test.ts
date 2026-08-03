import { describe, expect, it } from "vitest";
import {
  agentById,
  agentInstallName,
  agentInvocation,
  isMissingAgentInstallError,
  missingAgentInstallError,
  nextctlAgentAdapter,
  supportsBrowserEngine,
} from "./agents";

describe("agent invocation parity", () => {
  it("maps app agent ids to nextctl adapters", () => {
    expect(nextctlAgentAdapter("claude")).toBe("claude-code");
    expect(nextctlAgentAdapter("codex")).toBe("codex");
  });
  it("limits the experimental browser engine to agents with isolated MCP config", () => {
    expect(supportsBrowserEngine("codex")).toBe(true);
    expect(supportsBrowserEngine("claude")).toBe(true);
    expect(supportsBrowserEngine("gemini")).toBe(false);
  });
  it("injects only the browser engine MCP into Codex", () => {
    const invocation = agentInvocation(agentById("codex"), "scrape", {
      command: "/opt/nextbrowser-browser-engine",
      cdpUrl: "http://127.0.0.1:9222",
    });
    expect(invocation.args).toContain("--ignore-user-config");
    expect(invocation.args.join(" ")).toContain("nextbrowser_browser");
    expect(invocation.args.join(" ")).toContain("127.0.0.1:9222");
    expect(invocation.args.join(" ")).toContain("default_tools_approval_mode");
    expect(invocation.stdin).toBe("scrape");
  });
  it("uses Claude strict MCP config without adding an LLM credential", () => {
    const invocation = agentInvocation(agentById("claude"), "post", {
      command: "engine.exe",
      cdpUrl: "http://127.0.0.1:9333",
    });
    expect(invocation.args).toContain("--strict-mcp-config");
    expect(invocation.args.join(" ")).toContain("nextbrowser-browser");
    expect(invocation.args.join(" ")).not.toMatch(/API_KEY|OPENAI|ANTHROPIC/);
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
      "Claude Code CLI not found. NextBrowser needs the Claude Code CLI, not the Claude desktop app, to connect. Install the CLI, then try again.",
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
