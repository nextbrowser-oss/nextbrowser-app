import type { AppTab } from "../types";

export type PrimaryAppTab = Extract<AppTab, "chat" | "live">;

export function isPrimaryAppTab(tab: AppTab): tab is PrimaryAppTab {
  return tab === "chat" || tab === "live";
}

export function isAppBackShortcut(event: Pick<KeyboardEvent, "altKey" | "key" | "metaKey">): boolean {
  return event.key === "Escape"
    || (event.altKey && event.key === "ArrowLeft")
    || (event.metaKey && event.key === "[");
}
