// Agent catalog, a faithful port of clawdesk/Models/Models.swift `AgentKind`.
// Claude Code & Codex are primary; the rest are best-effort integrations.

/** The agent that runs inside Nextbrowser itself (electron/builtin-agent.cjs). */
export const BUILTIN_AGENT_ID = "nextbrowser";

export type RunStyle =
  | "claudePrint"
  | "codexExec"
  | "hermesOneshot"
  | "openclawAgent"
  | "promptFlag"
  | "runSubcommand"
  | "promptArg"
  | "messageFlag"
  /** The built-in Nextbrowser agent: runs inside the app, no CLI. */
  | "builtin";

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
    envVar: binary ? envVar(binary) : "",
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
  // Runs inside the app against an OpenAI-compatible model API (a free NVIDIA,
  // OpenRouter or Gemini key, or a local model); see electron/builtin-agent.cjs.
  spec(BUILTIN_AGENT_ID, "Nextbrowser agent", "", "builtin"),
  spec("hermes", "Hermes Agent", "hermes", "hermesOneshot", { loginArgs: ["setup"] }),
  spec("kilo", "Kilo Code", "kilo", "runSubcommand", { installUrl: "https://kilo.ai/docs/getting-started/using-kilo-for-free" }),
  spec("openclaw", "OpenClaw", "openclaw", "openclawAgent", { loginArgs: ["onboard"] }),
  spec("cline", "Cline", "cline", "promptArg", { loginArgs: ["auth"] }),
  spec("pi", "pi", "pi", "promptFlag"),
  spec("gemini", "Gemini CLI", "gemini", "promptFlag"),
  // Antigravity's documented non-interactive mode is `agy -p <prompt>`.
  // Authentication happens when its interactive terminal opens (keyring first,
  // then Google Sign-In), so it intentionally has no status or logout command.
  spec("antigravity", "Antigravity CLI", "agy", "promptFlag", { installUrl: "https://www.antigravity.google/docs/cli/install/" }),
  // Copilot Free includes a small monthly allowance. The CLI's programmatic
  // mode is `copilot -p <prompt>`, the same shape used by Gemini/Antigravity.
  spec("copilot", "GitHub Copilot CLI", "copilot", "promptFlag", { loginArgs: ["login"], installUrl: "https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli" }),
  spec("qwen", "Qwen Code", "qwen", "promptFlag"),
  spec("opencode", "OpenCode", "opencode", "runSubcommand", { installUrl: "https://opencode.ai/docs/#install" }),
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
  spec("amazonq", "Amazon Q", "q", "promptArg", { installUrl: "https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/q-tiers.html" }),
  spec("continue", "Continue", "cn", "promptArg"),
  spec("droid", "Factory Droid", "droid", "promptArg"),
];

/** The built-in agent has no CLI: no install, sign-in, terminal, or nbc adapter. */
export function isBuiltinAgent(agent: AgentSpec | string | undefined): boolean {
  const id = typeof agent === "string" ? agent : agent?.id;
  return id === BUILTIN_AGENT_ID;
}

/** Whether a project of this agent can open the Terminal chat. */
export function agentSupportsTerminal(agent: AgentSpec | string | undefined): boolean {
  return !isBuiltinAgent(agent);
}

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
  if (!agent.binary) return undefined;
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  const binary = agent.binary.toLowerCase();
  if (
    !normalized.includes(`${binary} executable not found`)
    && !normalized.includes(`${binary} cli not found`)
  ) return undefined;
  const requirement = agent.installKind === "app"
    ? "Nextbrowser connects through the executable bundled with the app. Install it, then try again."
    : agent.id === "claude"
      ? "Nextbrowser needs the Claude Code CLI, not the Claude desktop app, to connect. Install the CLI, then try again."
      : "Nextbrowser needs the CLI executable to connect. Install it, then try again.";
  return `${agentInstallName(agent)} not found. ${requirement}`;
}

export function isMissingAgentInstallError(message: string): boolean {
  return /(?:CLI|app(?: with Codex)?) not found/i.test(message);
}

// The agents nbc integrates with (nextctl internal/install/adapters). It has no
// adapter for the others, such as pi or Kilo Code: `nbc install --agent pi`
// fails with "unknown agent adapter".
const NEXTCTL_AGENT_ADAPTERS: Record<string, string> = {
  claude: "claude-code",
  codex: "codex",
  antigravity: "antigravity",
  cursor: "cursor",
  gemini: "gemini",
  hermes: "hermes",
  openclaw: "openclaw",
  opencode: "opencode",
};

/** Adapter name understood by `nextctl install --agent`; undefined when nbc has none for the agent. */
export function nextctlAgentAdapter(id: string): string | undefined {
  return NEXTCTL_AGENT_ADAPTERS[id];
}

/** How the host turns an agent's progress output into chat steps. */
export type AgentStepFormat = "claude-stream-json" | "codex-stderr";

/// Build CLI args (+ optional stdin) for one non-interactive prompt. With
/// `steps`, the agent also reports its progress in a form the host decodes
/// into step lines (see electron/agent-steps.cjs); the reply text is unchanged.
export function agentInvocation(
  spec: AgentSpec,
  prompt: string,
  options: { steps?: boolean } = {},
): { args: string[]; stdin?: string; stepFormat?: AgentStepFormat } {
  switch (spec.runStyle) {
    case "claudePrint":
      // The prompt goes on stdin, as for Codex. A chat prompt carries recent
      // history and an automation repair its recipe, and on Windows a command
      // line past 32,767 characters fails to spawn (ENAMETOOLONG): the chat
      // only said "We couldn't start the agent".
      return options.steps
        ? {
            args: ["-p", "--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose"],
            stdin: prompt,
            stepFormat: "claude-stream-json",
          }
        : { args: ["-p", "--dangerously-skip-permissions"], stdin: prompt };
    case "codexExec":
      return {
        args: ["exec", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", "-"],
        stdin: prompt,
        ...(options.steps ? { stepFormat: "codex-stderr" as const } : {}),
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
    case "builtin":
      // The main process sends the prompt to the model itself.
      return { args: [], stdin: prompt };
  }
}
