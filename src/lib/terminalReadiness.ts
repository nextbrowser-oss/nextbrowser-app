const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g;

export function plainTerminalText(value: string): string {
  return value.replace(ANSI, "").replace(/\r/g, "");
}

export function terminalAgentReady(agentId: string, output: string): boolean {
  const text = plainTerminalText(output);
  if (agentId === "codex") {
    return /(?:^|\n)\s*›\s/.test(text) ||
      /Ask Codex to do anything/i.test(text) ||
      /(?:^|\n)\s*gpt-[^\n]*·\s*[^\n]+/.test(text);
  }
  if (agentId === "claude") {
    return /Choose the text style|(?:^|\n)\s*[>❯]\s/.test(text);
  }
  return /(?:^|\n)\s*(?:›|>|❯)\s/.test(text);
}

export function terminalInputShouldQueueBeforeReady(data: string): boolean {
  if (!data.includes("\x1b")) return true;
  const withoutControls = plainTerminalText(data).replace(/[\x00-\x1f\x7f]/g, "");
  return withoutControls.length > 0;
}

export function terminalActivityPreview(output: string): string | undefined {
  const ignored = /^(?:[›>─╭╰│]|Tip:|model:|directory:|Working \(|Worked for |MCP startup|OpenAI Codex|Welcome to Claude Code)/i;
  const lines = plainTerminalText(output)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim().replace(/^[•◦]\s*/, ""))
    .filter((line) => line.length >= 3 && !ignored.test(line));
  const value = lines.at(-1)?.slice(0, 120);
  return value || undefined;
}
