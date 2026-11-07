export const agentChatCommands = [
  { name: "help", description: "Show available chat commands" },
  { name: "new", description: "Start a fresh project; keep the previous history", args: "[name]" },
  { name: "sessions", description: "Switch between recent projects" },
  { name: "title", description: "Show or rename this project", args: "[name]" },
  { name: "stop", description: "Interrupt this project's running response" },
  { name: "retry", description: "Send the last user message again" },
  { name: "history", description: "Scroll to the beginning of this conversation" },
  { name: "model", description: "Open agent and model settings" },
  { name: "config", description: "Open agent settings" },
  { name: "skills", description: "Browse available skills" },
  { name: "scripts", description: "Open this chat's scripts" },
  { name: "usage", description: "Open account usage" },
  { name: "status", description: "Show this project's agent and activity" },
  { name: "version", description: "Show the connected agent version" },
] as const;
export type AgentChatCommand = typeof agentChatCommands[number]["name"];
const aliases: Record<string, AgentChatCommand> = { reset: "new", clear: "new" };

/** Only actual client actions belong here. Unsupported native TUI commands never become model prompts. */
export function parseAgentChatCommand(text: string): { name: AgentChatCommand | undefined; rawName: string; args: string } | undefined {
  const match = /^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) return;
  const rawName = match[1].toLowerCase();
  const name = agentChatCommands.find(command => command.name === rawName)?.name
    ?? (Object.prototype.hasOwnProperty.call(aliases, rawName) ? aliases[rawName] : undefined);
  return { name, rawName, args: match[2]?.trim() ?? "" };
}

export function matchingAgentChatCommands(text: string) {
  const match = /^\/([a-z-]*)$/i.exec(text);
  if (!match) return [];
  const query = match[1].toLowerCase();
  return agentChatCommands.filter(command => command.name.startsWith(query) || Object.entries(aliases).some(([alias, name]) => name === command.name && alias.startsWith(query)));
}
