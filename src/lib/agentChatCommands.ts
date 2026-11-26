import { translate } from "../shared/lib/i18n";
export const agentChatCommands = [
  { name: "help", get description() { return translate("Show available chat commands"); } },
  { name: "new", get description() { return translate("Start a fresh project; keep the previous history"); }, args: "[name]" },
  { name: "sessions", get description() { return translate("Switch between recent projects"); } },
  { name: "title", get description() { return translate("Show or rename this project"); }, args: "[name]" },
  { name: "stop", get description() { return translate("Interrupt this project's running response"); } },
  { name: "retry", get description() { return translate("Send the last user message again"); } },
  { name: "history", get description() { return translate("Scroll to the beginning of this conversation"); } },
  { name: "model", get description() { return translate("Open agent and model settings"); } },
  { name: "config", get description() { return translate("Open agent settings"); } },
  { name: "skills", get description() { return translate("Browse available skills"); } },
  { name: "scripts", get description() { return translate("Open this chat's scripts"); } },
  { name: "usage", get description() { return translate("Open account usage"); } },
  { name: "status", get description() { return translate("Show this project's agent and activity"); } },
  { name: "version", get description() { return translate("Show the connected agent version"); } },
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
