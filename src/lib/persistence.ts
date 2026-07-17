import { uid } from "./ids";
import type {
  Conversation,
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

export function normalizeConversation(raw: Conversation): Conversation {
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
  return {
    ...raw,
    createdAt: parseMillis(raw.createdAt),
    updatedAt: parseMillis(raw.updatedAt),
    messages,
    executionTarget,
    vpsConnectionInstructions,
    vpsConnectionLabel,
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
