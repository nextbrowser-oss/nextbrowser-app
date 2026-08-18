import { uid } from "./ids";
import type {
  Conversation,
  BrowserWorkflowSkill,
  CustomScript,
  ScheduledRun,
  UsageSnapshot,
} from "../types";
import { VPS_PROMPT_MARKER } from "./vpsPrompt";

const APPLE_REFERENCE_UNIX_SECONDS = 978_307_200;
const MAX_VPS_CONNECTION_INSTRUCTIONS = 32_768;

export function parseMillis(value: unknown, fallback = Date.now()): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function parseAppleDate(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000
      ? (value + APPLE_REFERENCE_UNIX_SECONDS) * 1000
      : value;
  }
  return parseMillis(value);
}

export function isoSeconds(value: number): string {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function normalizeConversation(raw: Omit<Conversation, "profileToolsets"> & { profileToolsets?: Record<string, string> }): Conversation {
  const messages = (raw.messages ?? []).map((message) => ({
    ...message,
    status: (message.status as string) === "stopped" ? "cancelled" as const : message.status,
    createdAt: parseMillis(message.createdAt),
    runStartedAt:
      message.runStartedAt == null ? undefined : parseMillis(message.runStartedAt),
    lastActivityAt:
      message.lastActivityAt == null ? undefined : parseMillis(message.lastActivityAt),
    toolEvents: message.toolEvents?.map((event) => ({
      ...event,
      createdAt: parseMillis(event.createdAt),
    })),
  }));
  const storedInstructions = typeof raw.vpsConnectionInstructions === "string"
    ? raw.vpsConnectionInstructions.trim()
    : "";
  const vpsConnectionInstructions = storedInstructions.length <= MAX_VPS_CONNECTION_INSTRUCTIONS &&
    storedInstructions.startsWith(VPS_PROMPT_MARKER)
    ? storedInstructions
    : undefined;
  const vpsConnectionLabel = typeof raw.vpsConnectionLabel === "string"
    ? raw.vpsConnectionLabel.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 160) || undefined
    : undefined;
  const executionTarget = raw.executionTarget === "vps" || vpsConnectionInstructions
    ? "vps" as const
    : raw.executionTarget === "local"
      ? "local" as const
      : undefined;
  const legacyNumberedChat = /^Chat\s+(\d+)$/i.exec(raw.title?.trim() ?? "");
  const title = legacyNumberedChat ? `Project ${legacyNumberedChat[1]}` : raw.title;
  const chatMode = raw.chatMode === "terminal" ? "terminal" as const : "chat" as const;
  const terminalPreview = typeof raw.terminalPreview === "string"
    ? raw.terminalPreview.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || undefined
    : undefined;
  const profileNames = [...new Set((raw.profileNames ?? []).filter((name): name is string => typeof name === "string" && !!name.trim()))];
  const profileToolsets = Object.fromEntries(Object.entries(raw.profileToolsets ?? {}).flatMap(
    ([name, toolset]) => profileNames.includes(name) && (toolset === "clawbrowser" || toolset === "dasbrowser" || toolset === "camoufox" || toolset === "chromium")
      ? [[name, toolset === "chromium" ? "clawbrowser" : toolset]]
      : [],
  )) as Conversation["profileToolsets"];
  return {
    ...raw,
    title,
    createdAt: parseMillis(raw.createdAt),
    updatedAt: parseMillis(raw.updatedAt),
    messages,
    executionTarget,
    vpsConnectionInstructions,
    vpsConnectionLabel,
    chatMode,
    terminalPreview,
    profileNames,
    profileToolsets,
  };
}

export function serializeConversations(conversations: Conversation[]) {
  return conversations.map((conversation) => ({
    ...conversation,
    createdAt: isoSeconds(conversation.createdAt),
    updatedAt: isoSeconds(conversation.updatedAt),
    messages: conversation.messages.map((message) => ({
      ...message,
      createdAt: isoSeconds(message.createdAt),
      runStartedAt: message.runStartedAt == null ? undefined : isoSeconds(message.runStartedAt),
      lastActivityAt:
        message.lastActivityAt == null ? undefined : isoSeconds(message.lastActivityAt),
      toolEvents: message.toolEvents?.map((event) => ({
        ...event,
        createdAt: isoSeconds(event.createdAt),
      })),
    })),
  }));
}

export function normalizeSchedule(run: ScheduledRun): ScheduledRun {
  return { ...run, lastFiredAt: parseAppleDate(run.lastFiredAt) };
}

export function serializeSchedules(runs: ScheduledRun[]) {
  return runs.map((run) => ({
    ...run,
    lastFiredAt:
      run.lastFiredAt == null
        ? undefined
        : run.lastFiredAt / 1000 - APPLE_REFERENCE_UNIX_SECONDS,
  }));
}

export function normalizeScript(script: CustomScript): CustomScript {
  return {
    ...script,
    createdAt: parseMillis(script.createdAt),
    updatedAt: parseMillis(script.updatedAt),
    submittedAt: script.submittedAt == null ? undefined : parseMillis(script.submittedAt),
  };
}

export function serializeScripts(scripts: CustomScript[]) {
  return scripts.map((script) => ({
    ...script,
    createdAt: isoSeconds(script.createdAt),
    updatedAt: isoSeconds(script.updatedAt),
    submittedAt: script.submittedAt == null ? undefined : isoSeconds(script.submittedAt),
  }));
}

export function normalizeWorkflowSkill(skill: BrowserWorkflowSkill): BrowserWorkflowSkill {
  const legacyActions: unknown[] = Array.isArray(skill.actions) ? skill.actions : [];
  const actions = legacyActions.flatMap((action) => {
    if (action && typeof action === "object" && "tool" in action && typeof action.tool === "string") {
      const args = "arguments" in action && action.arguments && typeof action.arguments === "object" ? action.arguments as Record<string, unknown> : {};
      return [{ tool: action.tool, arguments: args }];
    }
    if (typeof action !== "string") return [];
    const match = action.match(/(?:(?:clawbrowser|nextbrowser)\.)?([a-z_]+)\((\{.*\})\)/s);
    try { return match ? [{ tool: match[1], arguments: JSON.parse(match[2]) as Record<string, unknown> }] : [{ tool: action.replace(/^(?:clawbrowser|nextbrowser)\./, ""), arguments: {} }]; } catch { return []; }
  });
  const capability = skill.capability ?? "other";
  return {
    ...skill,
    actions,
    capability,
    parametersSchema: skill.parametersSchema ?? { type: "object", properties: {} },
    outputSchema: skill.outputSchema ?? { type: "object", properties: {} },
    recipe: skill.recipe ?? { version: 1, capability, actions },
    createdAt: parseMillis(skill.createdAt),
    updatedAt: parseMillis(skill.updatedAt),
    submittedAt: skill.submittedAt == null ? undefined : parseMillis(skill.submittedAt),
  };
}

export function serializeWorkflowSkills(skills: BrowserWorkflowSkill[]) {
  return skills.map((skill) => ({
    ...skill,
    createdAt: isoSeconds(skill.createdAt),
    updatedAt: isoSeconds(skill.updatedAt),
    submittedAt: skill.submittedAt == null ? undefined : isoSeconds(skill.submittedAt),
  }));
}

export function normalizeUsage(snapshot: UsageSnapshot): UsageSnapshot {
  return {
    ...snapshot,
    id: snapshot.id || uid(),
    date: parseMillis(snapshot.date),
  };
}

export function serializeUsage(history: UsageSnapshot[]) {
  return history.map((snapshot) => ({ ...snapshot, date: isoSeconds(snapshot.date) }));
}
