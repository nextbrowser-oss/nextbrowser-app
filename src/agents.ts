// Agent catalog, a faithful port of clawdesk/Models/Models.swift `AgentKind`.
// Claude Code & Codex are primary; the rest are best-effort CLI integrations.

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
}

function envVar(bin: string): string {
  return bin.toUpperCase().replace(/-/g, "_") + "_BIN";
}

function spec(
  id: string,
  name: string,
  binary: string,
  runStyle: RunStyle,
  opts: { primary?: boolean; loginArgs?: string[]; logoutArgs?: string[]; statusArgs?: string[] | null } = {},
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
  };
}

export const AGENTS: AgentSpec[] = [
  spec("claude", "Claude Code", "claude", "claudePrint", { primary: true, loginArgs: ["auth", "login"], logoutArgs: ["auth", "logout"], statusArgs: ["auth", "status"] }),
  spec("codex", "Codex", "codex", "codexExec", { primary: true, loginArgs: ["login"], logoutArgs: ["logout"], statusArgs: ["login", "status"] }),
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

/** Adapter name understood by `clawctl install --agent`. */
export function clawctlAgentAdapter(id: string): string {
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
