import { describe, expect, it } from "vitest";
import {
  AGENTS,
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
    expect(nextctlAgentAdapter("antigravity")).toBe("antigravity");
    expect(nextctlAgentAdapter("opencode")).toBe("opencode");
  });
  it("has no nextctl adapter for agents nbc does not integrate with", () => {
    expect(nextctlAgentAdapter("pi")).toBeUndefined();
    expect(nextctlAgentAdapter("kilo")).toBeUndefined();
    expect(nextctlAgentAdapter("copilot")).toBeUndefined();
    // `nbc install` 1.2.37: unknown agent adapter "pi" (known: all, antigravity, auto, claude-code,
    // codex, cursor, gemini, generic, hermes, openclaw, opencode).
    const known = new Set(["antigravity", "claude-code", "codex", "cursor", "gemini", "hermes", "openclaw", "opencode"]);
    for (const agent of AGENTS) {
      const adapter = nextctlAgentAdapter(agent.id);
      if (adapter) expect(known, agent.id).toContain(adapter);
    }
  });
  it("links primary agents to their supported installation pages", () => {
    expect(agentById("claude").installUrl).toBe("https://code.claude.com/docs/en/installation");
    expect(agentById("codex").installUrl).toBe("https://chatgpt.com/download/");
    expect(agentById("antigravity").installUrl).toBe("https://www.antigravity.google/docs/cli/install/");
    expect(agentById("kilo").installUrl).toBe("https://kilo.ai/docs/getting-started/using-kilo-for-free");
    expect(agentById("copilot").installUrl).toBe("https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli");
    expect(agentById("amazonq").installUrl).toBe("https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/q-tiers.html");
    expect(agentInstallName(agentById("claude"))).toBe("Claude Code CLI");
    expect(agentInstallName(agentById("codex"))).toBe("ChatGPT desktop app with Codex");
  });
  it("turns a missing Claude executable failure into CLI installation guidance", () => {
    const error = new Error(
      "Error invoking remote method 'nextbrowser:invoke': Error: claude executable not found.",
    );

    const message = missingAgentInstallError(error, agentById("claude"));

    expect(message).toBe(
      "Claude Code CLI not found. Nextbrowser needs the Claude Code CLI, not the Claude desktop app, to connect. Install the CLI, then try again.",
    );
    expect(isMissingAgentInstallError(message ?? "")).toBe(true);
  });
  it("turns a missing Codex executable failure into app installation guidance", () => {
    const error = new Error(
      "Error invoking remote method 'nextbrowser:invoke': Error: codex executable not found.",
    );

    const message = missingAgentInstallError(error, agentById("codex"));

    expect(message).toBe(
      "ChatGPT desktop app with Codex not found. Nextbrowser connects through the executable bundled with the app. Install it, then try again.",
    );
    expect(isMissingAgentInstallError(message ?? "")).toBe(true);
  });
  it("does not expose unrelated agent failures", () => {
    expect(missingAgentInstallError(new Error("spawn failed with secret details"), agentById("codex"))).toBeUndefined();
  });
  it.each([
    ["claude", ["-p", "--dangerously-skip-permissions"], "hello"],
    ["codex", ["exec", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", "-"], "hello"],
    ["hermes", ["-z", "hello"], undefined],
    ["kilo", ["run", "hello"], undefined],
    ["openclaw", ["agent", "--agent", "main", "--message", "hello", "--local"], undefined],
    ["cline", ["hello"], undefined],
    ["pi", ["-p", "hello"], undefined],
    ["antigravity", ["-p", "hello"], undefined],
    ["copilot", ["-p", "hello"], undefined],
  ])("builds the exact %s command", (id, args, stdin) => {
    expect(agentInvocation(agentById(id as string), "hello")).toEqual({
      args,
      ...(stdin === undefined ? {} : { stdin }),
    });
  });

  it("asks Claude for its event stream when the chat shows steps", () => {
    expect(agentInvocation(agentById("claude"), "hello", { steps: true })).toEqual({
      args: ["-p", "--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose"],
      stdin: "hello",
      stepFormat: "claude-stream-json",
    });
  });

  it("keeps the Codex command and reads its steps from stderr", () => {
    expect(agentInvocation(agentById("codex"), "hello", { steps: true })).toEqual({
      args: ["exec", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", "-"],
      stdin: "hello",
      stepFormat: "codex-stderr",
    });
  });

  it("keeps a long prompt out of the Claude and Codex command lines", () => {
    // Windows refuses to spawn a command line past 32,767 characters.
    const prompt = "x".repeat(40_000);
    for (const id of ["claude", "codex"]) {
      for (const steps of [false, true]) {
        const invocation = agentInvocation(agentById(id), prompt, { steps });
        expect(invocation.stdin).toBe(prompt);
        expect(invocation.args.join(" ").length).toBeLessThan(200);
      }
    }
  });

  it("leaves agents without a step decoder unchanged", () => {
    expect(agentInvocation(agentById("hermes"), "hello", { steps: true })).toEqual({ args: ["-z", "hello"] });
  });
});
