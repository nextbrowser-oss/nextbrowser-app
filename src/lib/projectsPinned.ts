import { useSyncExternalStore } from "react";
import { settingsStorage } from "./settingsStorage";

const key = "nextbrowser.projectsPinned";
const subscribers = new Set<() => void>();

function subscribe(notify: () => void) {
  subscribers.add(notify);
  return () => { subscribers.delete(notify); };
}

export function useProjectsPinned() {
  return useSyncExternalStore(subscribe, () => settingsStorage.getItem(key) === "true");
}

export function setProjectsPinned(pinned: boolean) {
  settingsStorage.setItem(key, String(pinned));
  subscribers.forEach(notify => notify());
}
