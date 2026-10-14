import { expect, it } from "vitest";
import { DAILY_WEEKDAYS, scheduleDue } from "./scheduleDue";
import type { ScheduledRun } from "../types";
const run: ScheduledRun = { id: "r", title: "Test", prompt: "test", agent: "codex", enabled: true, hour: 12, minute: 25, weekdays: [1,2,3,4,5,6,7] };
it("fires an interval once after its deadline", () => {
  expect(scheduleDue({ ...run, intervalMinutes: 3, createdAt: 1000 }, 180999)).toBe(false);
  expect(scheduleDue({ ...run, intervalMinutes: 3, createdAt: 1000 }, 181000)).toBe(true);
  expect(scheduleDue({ ...run, intervalMinutes: 3, lastFiredAt: 181000 }, 181001)).toBe(false);
});
it("recovers a daily run missed while the app was asleep", () => {
  const before = new Date(2026, 8, 23, 12, 22).getTime();
  const after = new Date(2026, 8, 23, 12, 28).getTime();
  expect(scheduleDue({ ...run, createdAt: before }, after)).toBe(true);
  expect(scheduleDue({ ...run, lastFiredAt: after }, after + 1000)).toBe(false);
});
it("does not fire a new schedule for time before it was created", () => {
  const createdAt = new Date(2026, 8, 23, 12, 28).getTime();
  expect(scheduleDue({ ...run, createdAt }, createdAt + 1000)).toBe(false);
});
it("runs a default daily schedule on Saturday and Sunday too", () => {
  const daily = { ...run, weekdays: [...DAILY_WEEKDAYS] };
  for (const day of [17, 18]) {
    const slot = new Date(2026, 9, day, 12, 25).getTime();
    expect(new Date(slot).getDay() % 6).toBe(0);
    expect(scheduleDue({ ...daily, createdAt: slot - 60_000 }, slot + 30_000)).toBe(true);
    expect(scheduleDue({ ...daily, lastFiredAt: slot + 30_000 }, slot + 60_000)).toBe(false);
  }
});
