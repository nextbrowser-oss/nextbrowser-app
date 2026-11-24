import { settingsStorage } from "./settingsStorage";

export interface ActivityDay { ms: number; sessions: number }
interface ActivityLog { first: string; lastVisit: number; days: Record<string, ActivityDay> }
export const activityChanged = "nextbrowser:account-activity";
const interval = 15_000;
const visitGap = 30 * 60_000;
const key = (owner: string) => "nextbrowser.accountActivity." + owner;
export function localDay(at: number): string {
  const date = new Date(at);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
export function readActivity(owner: string): ActivityLog {
  try {
    const data = JSON.parse(settingsStorage.getItem(key(owner)) ?? "null");
    if (data && typeof data.first === "string" && typeof data.lastVisit === "number" && data.days && typeof data.days === "object") return data;
  } catch { /* Start a new local counter if storage is unavailable. */ }
  return { first: localDay(Date.now()), lastVisit: 0, days: {} };
}
export function addForeground(log: ActivityLog, from: number, until: number) {
  if (until <= from || until - from > 2 * interval) return;
  while (from < until) {
    const midnight = new Date(from);
    midnight.setHours(24, 0, 0, 0);
    const stop = Math.min(until, midnight.getTime());
    const day = log.days[localDay(from)] ??= { ms: 0, sessions: 0 };
    day.ms += stop - from;
    from = stop;
  }
}
export function observeAccountActivity(owner: string) {
  const log = readActivity(owner);
  const visible = () => document.visibilityState === "visible" && document.hasFocus();
  let from: number | undefined;
  const tick = (focused: boolean) => {
    const now = Date.now();
    if (from !== undefined) addForeground(log, from, now);
    if (focused) {
      const day = log.days[localDay(now)] ??= { ms: 0, sessions: 0 };
      if (!log.lastVisit || now - log.lastVisit >= visitGap) day.sessions++;
      log.lastVisit = now;
    }
    from = focused ? now : undefined;
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 89);
    for (const day of Object.keys(log.days)) if (day < localDay(cutoff.getTime())) delete log.days[day];
    try { settingsStorage.setItem(key(owner), JSON.stringify(log)); } catch { return; }
    window.dispatchEvent(new Event(activityChanged));
  };
  const update = () => tick(visible());
  const pause = () => tick(false);
  update();
  const timer = window.setInterval(() => { if (visible() || from !== undefined) update(); }, interval);
  document.addEventListener("visibilitychange", update);
  window.addEventListener("focus", update);
  window.addEventListener("blur", pause);
  window.addEventListener("pagehide", pause);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", update);
    window.removeEventListener("focus", update);
    window.removeEventListener("blur", pause);
    window.removeEventListener("pagehide", pause);
    pause();
  };
}

export function recentActivity(owner: string, length = 14) {
  const log = readActivity(owner);
  const today = new Date();
  return Array.from({ length }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - length + 1 + index);
    const label = localDay(date.getTime());
    return { label, ...(log.days[label] ?? { ms: 0, sessions: 0 }) };
  }).filter(day => day.label >= log.first);
}
