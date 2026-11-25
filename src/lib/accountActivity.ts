import { settingsStorage } from "./settingsStorage";

export interface ActivityDay { ms: number; sessions: number }
interface ActivityLog { first: string; lastVisit: number; days: Record<string, ActivityDay> }
export const activityChanged = "nextbrowser:account-activity";
const snapshots = new Map<string, ActivityLog>();
const key = (owner: string) => "nextbrowser.accountActivity." + owner;
export function localDay(at: number): string {
  const date = new Date(at);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
export function readActivity(owner: string): ActivityLog {
  try {
    const data = snapshots.get(owner) ?? JSON.parse(settingsStorage.getItem(key(owner)) ?? "null");
    if (data && typeof data.first === "string" && typeof data.lastVisit === "number" && data.days && typeof data.days === "object") return data;
  } catch { /* Start a new local counter if storage is unavailable. */ }
  return { first: localDay(Date.now()), lastVisit: 0, days: {} };
}
export function observeAccountActivity(owner: string) {
  const bridge = window.nextbrowser;
  if (!bridge?.trackAccountActivity) return () => {};
  const unsubscribe = bridge.on("account-activity:snapshot", payload => {
    const update = payload as { owner: string; log: ActivityLog };
    if (update?.owner !== owner) return;
    snapshots.set(owner, update.log);
    window.dispatchEvent(new Event(activityChanged));
  });
  bridge.trackAccountActivity(owner);
  return () => {
    unsubscribe();
    bridge.trackAccountActivity?.(null);
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
