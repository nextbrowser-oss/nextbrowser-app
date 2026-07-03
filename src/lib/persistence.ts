import { uid } from "./ids";
import type {
  Conversation,
  CustomScript,
  ScheduledRun,
  UsageSnapshot,
} from "../types";

const APPLE_REFERENCE_UNIX_SECONDS = 978_307_200;

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
  return {
    ...raw,
    createdAt: parseMillis(raw.createdAt),
    updatedAt: parseMillis(raw.updatedAt),
    messages: (raw.messages ?? []).map((message) => ({
      ...message,
      status: (message.status as string) === "stopped" ? "cancelled" : message.status,
      createdAt: parseMillis(message.createdAt),
      runStartedAt:
        message.runStartedAt == null ? undefined : parseMillis(message.runStartedAt),
      lastActivityAt:
        message.lastActivityAt == null ? undefined : parseMillis(message.lastActivityAt),
      toolEvents: message.toolEvents?.map((event) => ({
        ...event,
        createdAt: parseMillis(event.createdAt),
      })),
    })),
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
