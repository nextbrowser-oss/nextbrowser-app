import type { ScheduledRun } from "../types";

export function scheduleDue(run: ScheduledRun, timestamp: number): boolean {
  if (!run.enabled) return false;
  const last = run.lastFiredAt ?? run.createdAt ?? timestamp - 60_000;
  if (run.intervalMinutes) return timestamp - last >= Math.max(1, run.intervalMinutes) * 60_000;
  // Recover one missed run after sleep/background throttling, never a burst.
  const date = new Date(timestamp);
  for (let offset = 0; offset < 7; offset++) {
    const due = new Date(date);
    due.setDate(date.getDate() - offset);
    due.setHours(run.hour, run.minute, 0, 0);
    if (run.weekdays.includes(due.getDay() + 1) && due.getTime() <= timestamp && due.getTime() > last) return true;
  }
  return false;
}
