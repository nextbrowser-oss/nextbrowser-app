import type { ChatMessage } from "../types";

const MAX_HANDOFF_CHARS = 6_000;

function clean(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
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

export function chatPromptWithDeferredContext(context: string | undefined, message: string): string | undefined {
  if (!context) return undefined;
  return `${context}\n\nNew user message:\n${message}`;
}

export function terminalInputWithDeferredContext(
  context: string | undefined,
  data: string,
  bufferedInput = "",
): { data: string; consumed: boolean; userInput: boolean } {
  const textInput = data.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  const userInput = /[^\x00-\x1f\x7f]/.test(textInput);
  // xterm sends CR for submit. LF is deliberately used by our Shift+Enter
  // handler to add a newline inside the editor and must not consume context.
  const submitting = data.includes("\r");
  const inlineInput = textInput.split(/[\r\n]/, 1)[0].replace(/[\x00-\x1f\x7f]/g, "");
  const message = bufferedInput || inlineInput;
  if (!context || !submitting || !message) {
    return { data, consumed: false, userInput };
  }
  const prompt = `${context}\n\nNew user message:\n${message}`;
  return {
    // Replace the already-rendered editor line atomically. Inserting context
    // at column zero leaves the TUI's current line-editing state out of sync
    // and can corrupt alternating characters in the user's message.
    data: `${bufferedInput ? "\x15" : ""}\x1b[200~${prompt}\x1b[201~\r`,
    consumed: true,
    userInput: true,
  };
}

export function terminalBrowserScopeContext(
  profiles: Array<{ name: string; runtime: "clawbrowser" | "dasbrowser" | "camoufox"; running?: boolean; selected?: boolean }>,
  recorderActive = false,
): string | undefined {
  if (!profiles.length) return undefined;
  const runtimeLabel = (runtime: string) => runtime === "camoufox"
    ? "Camoufox"
    : runtime === "dasbrowser"
      ? "DasBrowser"
      : "ClawBrowser";
  const uniqueProfiles = profiles.filter((profile, index) =>
    profiles.findIndex((candidate) => candidate.name === profile.name) === index
  );
  const rows = uniqueProfiles.map((profile) =>
    `- ${profile.name}: ${runtimeLabel(profile.runtime)} (${profile.running ? "running" : "stopped"}${profile.selected ? ", selected" : ""})`,
  );
  const startCommands = uniqueProfiles.map((profile) =>
    `- Start ${profile.name} exactly: curl -sS -X POST "$NEXTBROWSER_CONTROL_URL/profile/start" -H "Authorization: Bearer $NEXTBROWSER_CONTROL_TOKEN" -H "Content-Type: application/json" --data ${shellSingleQuote(JSON.stringify({ profile: profile.name }))}`,
  );
  const recorderContext = recorderActive
    ? "\nRecorder is active. A reusable recording must contain a successful nextbrowser.extract, nextbrowser.paginate_extract, nextbrowser.tabs_extract, or read-only nextbrowser.evaluate call returning the exact final dataset. State is discovery only: never construct the artifact solely from state output or reasoning. Perform the final deterministic data call after state and before Artifact Center save. Do not finish with only open, state, and save_artifact."
    : "";
  return `NextBrowser workspace browser access (not project chat history):\n${rows.join("\n")}\nUse an explicit profile name exactly; otherwise use the selected or sole profile. If several profiles are plausible, ask which one to use. Ignore profile names from older turns. Never invent, clone, create, start, or substitute an unlisted profile, and do not use another browser-control integration. A runtime label such as ClawBrowser, Camoufox, or DasBrowser is not a profile name and must never be passed as one.${startCommands.length ? `\nAuthorized recovery commands (available even when status says running because the user may close the browser manually; copy only the matching command and never replace its profile value):\n${startCommands.join("\n")}` : ""}\nIf the chosen listed profile is stopped, or a page tool reports that its session is missing, closed, refused, or unreachable, run its exact authorized host start command once. On Windows use curl.exe. The successful response contains the canonical session name; retry the original page action once with that exact name. If either attempt fails, report that error without trying another name. For Artifact Center JSON, send one complete request; never use --data-binary @- without an attached heredoc and never create a temporary workspace file. Use: curl -sS -X POST "$NEXTBROWSER_CONTROL_URL/artifact/save" -H "Authorization: Bearer $NEXTBROWSER_CONTROL_TOKEN" -H "Content-Type: application/json" --data-binary @- <<'NEXTBROWSER_ARTIFACT_JSON', followed by one JSON object containing name, format, and non-empty content, then NEXTBROWSER_ARTIFACT_JSON on its own line.${recorderContext}`;
}

export function terminalLineBufferAfter(current: string, data: string): string {
  let value = current;
  for (const char of data.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")) {
    if (char === "\r" || char === "\n") value = "";
    else if (char === "\x7f" || char === "\b") value = [...value].slice(0, -1).join("");
    else if (char === "\x15") value = "";
    else if (char >= " ") value += char;
  }
  return value.slice(-64_000);
}
