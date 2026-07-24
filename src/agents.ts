// Agent catalog, a faithful port of clawdesk/Models/Models.swift `AgentKind`.
// Claude Code & Codex are primary; the rest are best-effort integrations.

export type RunStyle =
  | "claudePrint"
  | "codexExec"
  | "hermesOneshot"
  | "openclawAgent"
  | "promptFlag"
  | "runSubcommand"
  | "promptArg"
  | "messageFlag";

export interface AgentSpec {
  id: string;
  name: string;
  binary: string;
  envVar: string;
  runStyle: RunStyle;
  primary: boolean;
  loginArgs: string[];
  /// CLI args that sign the agent out. Empty means the agent exposes no
  /// non-interactive logout, so the UI hides the "Log out" action.
  logoutArgs: string[];
  statusArgs: string[] | null;
  installUrl?: string;
  installKind: "cli" | "app";
}

function envVar(bin: string): string {
  return bin.toUpperCase().replace(/-/g, "_") + "_BIN";
}

function spec(
  id: string,
  name: string,
  binary: string,
  runStyle: RunStyle,
  opts: {
    primary?: boolean;
    loginArgs?: string[];
    logoutArgs?: string[];
    statusArgs?: string[] | null;
    installUrl?: string;
    installKind?: "cli" | "app";
  } = {},
): AgentSpec {
  return {
    id,
    name,
    binary,
    envVar: envVar(binary),
    runStyle,
    primary: opts.primary ?? false,
    loginArgs: opts.loginArgs ?? [],
    logoutArgs: opts.logoutArgs ?? [],
    statusArgs: opts.statusArgs ?? null,
    installUrl: opts.installUrl,
    installKind: opts.installKind ?? "cli",
  };
}

export const AGENTS: AgentSpec[] = [
  spec("claude", "Claude Code", "claude", "claudePrint", { primary: true, loginArgs: ["auth", "login"], logoutArgs: ["auth", "logout"], statusArgs: ["auth", "status"], installUrl: "https://code.claude.com/docs/en/installation" }),
  spec("codex", "Codex", "codex", "codexExec", { primary: true, loginArgs: ["login"], logoutArgs: ["logout"], statusArgs: ["login", "status"], installUrl: "https://chatgpt.com/download/", installKind: "app" }),
  spec("hermes", "Hermes Agent", "hermes", "hermesOneshot", { loginArgs: ["setup"] }),
  spec("kilo", "Kilo Code", "kilo", "runSubcommand"),
  spec("openclaw", "OpenClaw", "openclaw", "openclawAgent", { loginArgs: ["onboard"] }),
  spec("cline", "Cline", "cline", "promptArg", { loginArgs: ["auth"] }),
  spec("pi", "pi", "pi", "promptFlag"),
  spec("gemini", "Gemini CLI", "gemini", "promptFlag"),
  spec("qwen", "Qwen Code", "qwen", "promptFlag"),
  spec("opencode", "OpenCode", "opencode", "runSubcommand"),
  spec("cursor", "Cursor Agent", "cursor-agent", "promptFlag"),
  spec("crush", "Crush", "crush", "runSubcommand"),
  spec("goose", "Goose", "goose", "runSubcommand"),
  spec("aider", "Aider", "aider", "messageFlag"),
  spec("amp", "Amp", "amp", "promptArg"),
  spec("llm", "LLM (Simon Willison)", "llm", "promptArg"),
  spec("aichat", "aichat", "aichat", "promptArg"),
  spec("sgpt", "Shell GPT", "sgpt", "promptArg"),
  spec("mods", "mods", "mods", "promptArg"),
  spec("gptme", "gptme", "gptme", "promptArg"),
  spec("cody", "Cody", "cody", "promptArg"),
  spec("plandex", "Plandex", "plandex", "promptArg"),
  spec("codebuff", "Codebuff", "codebuff", "promptArg"),
  spec("interpreter", "Open Interpreter", "interpreter", "promptArg"),
  spec("amazonq", "Amazon Q", "q", "promptArg"),
  spec("continue", "Continue", "cn", "promptArg"),
  spec("droid", "Factory Droid", "droid", "promptArg"),
];

export const PRIMARY_AGENTS = AGENTS.filter((a) => a.primary);
export const ADDITIONAL_AGENTS = AGENTS.filter((a) => !a.primary);

export function agentById(id: string): AgentSpec {
  return AGENTS.find((a) => a.id === id) ?? AGENTS[0];
}

export function agentInstallName(agent: AgentSpec): string {
  if (agent.id === "codex") return "ChatGPT desktop app with Codex";
  return agent.installKind === "app" ? `${agent.name} app` : `${agent.name} CLI`;
}

export function missingAgentInstallError(error: unknown, agent: AgentSpec): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  const binary = agent.binary.toLowerCase();
  if (
    !normalized.includes(`${binary} executable not found`)
    && !normalized.includes(`${binary} cli not found`)
  ) return undefined;
  const requirement = agent.installKind === "app"
    ? "NextBrowser connects through the executable bundled with the app. Install it, then try again."
    : agent.id === "claude"
      ? "NextBrowser needs the Claude Code CLI, not the Claude desktop app, to connect. Install the CLI, then try again."
      : "NextBrowser needs the CLI executable to connect. Install it, then try again.";
  return `${agentInstallName(agent)} not found. ${requirement}`;
}

export function isMissingAgentInstallError(message: string): boolean {
  return /(?:CLI|app(?: with Codex)?) not found/i.test(message);
}

/** Adapter name understood by `nextctl install --agent`. */
export function nextctlAgentAdapter(id: string): string {
  return id === "claude" ? "claude-code" : id;
}

/// Build CLI args (+ optional stdin) for one non-interactive prompt.
export function agentInvocation(
  spec: AgentSpec,
  prompt: string,
): { args: string[]; stdin?: string } {
  switch (spec.runStyle) {
    case "claudePrint":
      return { args: ["-p", "--dangerously-skip-permissions", prompt] };
    case "codexExec":
      return {
        args: ["exec", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", "-"],
        stdin: prompt,
      };
    case "hermesOneshot":
      return { args: ["-z", prompt] };
    case "openclawAgent":
      return { args: ["agent", "--agent", "main", "--message", prompt, "--local"] };
    case "promptFlag":
      return { args: ["-p", prompt] };
    case "runSubcommand":
      return { args: ["run", prompt] };
    case "promptArg":
      return { args: [prompt] };
    case "messageFlag":
      return { args: ["--message", prompt] };
  }
}
