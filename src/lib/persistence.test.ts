import { describe, expect, it } from "vitest";
import {
  normalizeConversation,
  normalizeSchedule,
  serializeConversations,
  serializeSchedules,
} from "./persistence";
import type { Conversation, ScheduledRun } from "../types";

describe("Swift-compatible persistence", () => {
  it("reads Swift ISO dates, migrates stopped, and writes second-precision ISO", () => {
    const raw = {
      id: "c", title: "Chat", agent: "claude",
      createdAt: "2026-06-30T10:20:30Z", updatedAt: "2026-06-30T10:20:31Z",
      messages: [{ id: "m", role: "assistant", text: "x", status: "stopped", createdAt: "2026-06-30T10:20:30Z" }],
    } as unknown as Conversation;
    const normalized = normalizeConversation(raw);
    expect(normalized.messages[0].status).toBe("cancelled");
    expect(serializeConversations([normalized])[0]).toMatchObject({
      createdAt: "2026-06-30T10:20:30Z",
      messages: [{ createdAt: "2026-06-30T10:20:30Z", status: "cancelled" }],
    });
  });

  it("preserves clickable local file attachments", () => {
    const raw = {
      id: "c", title: "Files", agent: "codex", createdAt: 1, updatedAt: 1,
      messages: [{ id: "m", role: "user", text: "Review", status: "done", createdAt: 1,
        attachments: [{ name: "report.pdf", path: "/tmp/report.pdf", size: 123 }] }],
    } as Conversation;
    expect(serializeConversations([normalizeConversation(raw)])[0].messages[0].attachments).toEqual([
      { name: "report.pdf", path: "/tmp/report.pdf", size: 123 },
    ]);
  });

  it("round-trips Swift Date's Apple-reference seconds for schedules", () => {
    const raw = {
      id: "r", title: "Run", prompt: "p", agent: "codex", hour: 8,
      minute: 5, weekdays: [2], enabled: true, lastFiredAt: 804_766_830,
    } as ScheduledRun;
    const normalized = normalizeSchedule(raw);
    expect(normalized.lastFiredAt).toBe(Date.parse("2026-07-03T10:20:30Z"));
    expect(serializeSchedules([normalized])[0].lastFiredAt).toBe(804_766_830);
  });
});
