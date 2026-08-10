import type { ChatMessage } from "../types";

const MAX_HANDOFF_CHARS = 6_000;

function clean(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function tailWithinLimit(lines: string[], limit = MAX_HANDOFF_CHARS): string {
  const kept: string[] = [];
  let size = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trimEnd();
    if (!line.trim()) continue;
    if (size + line.length + 1 > limit) break;
    kept.unshift(line);
    size += line.length + 1;
  }
  return kept.join("\n");
}

function taskFromSkillPrompt(text: string): string | undefined {
  if (!/^Use my local browser skill\b/i.test(text.trim())) return undefined;
  const match = text.match(/(?:Task for this run|Original task):[ \t]*\n([\s\S]*?)(?=\n[ \t]*(?:Workflow instructions|Observed browser actions)[ \t]*:|$)/i);
  const task = clean(match?.[1] ?? "");
  return task || undefined;
}

function handoffMessageText(message: ChatMessage): string | undefined {
  if (message.role === "assistant" && message.status !== "done") return undefined;
  const text = clean(message.text);
  if (!text || /^\[(?:stopped|cancelled|timed out)\]$/i.test(text)) return undefined;
  if (message.commandChip?.kind === "skill" || /^Use my local browser skill\b/i.test(text)) {
    return taskFromSkillPrompt(text);
  }
  return text;
}

export function terminalToChatHandoff(transcript: string, profile?: string): string {
  const recent = tailWithinLimit(clean(transcript).split("\n"));
  return `Continue this task from Terminal Chat in the regular NextBrowser chat.
${profile ? `Active browser profile: ${profile}.\n` : ""}Use the existing browser session and do not repeat completed actions. First acknowledge the handoff, then continue from the latest unfinished step.

Recent terminal context:
${recent}`.slice(0, MAX_HANDOFF_CHARS);
}

export function chatToTerminalHandoff(messages: ChatMessage[], profile?: string): string {
  const useful = messages.flatMap((message) => {
    if (message.role !== "user" && message.role !== "assistant") return [];
    const text = handoffMessageText(message);
    if (!text) return [];
    const role = message.role === "user" ? "User" : "Assistant";
    const tools = (message.toolEvents ?? []).map((event) => event.name).filter(Boolean);
    return [`${role}: ${text.slice(0, 900)}${tools.length ? `\nBrowser tools used: ${[...new Set(tools)].join(", ")}` : ""}`];
  }).slice(-6);
  const conversation = tailWithinLimit(useful, 5_200);
  return `Continue this task from the regular NextBrowser chat in Terminal Chat.
${profile ? `Active browser profile: ${profile}.\n` : ""}Use the existing browser session and do not repeat completed actions. Continue from the latest unfinished step.

Recent chat context:
${conversation}`.slice(0, MAX_HANDOFF_CHARS);
}
