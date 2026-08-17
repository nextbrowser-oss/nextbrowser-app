import type { AppTab } from "../types";

export type PrimaryAppTab = Extract<AppTab, "chat" | "live">;

const APP_TAB_HISTORY_LIMIT = 50;

const APP_TAB_LABELS: Record<AppTab, string> = {
  chat: "Chat",
  skills: "Skills",
  connectors: "Connectors",
  live: "Live",
  usage: "Usage",
  guide: "Guide",
  scheduled: "Scheduled",
};

export function isPrimaryAppTab(tab: AppTab): tab is PrimaryAppTab {
  return tab === "chat" || tab === "live";
}

export function appTabLabel(tab: AppTab): string {
  return APP_TAB_LABELS[tab];
}

export function recordPreviousAppTab(history: readonly AppTab[], tab: AppTab): AppTab[] {
  return [...history, tab].slice(-APP_TAB_HISTORY_LIMIT);
}

export function previousAppTab(history: readonly AppTab[]): AppTab | undefined {
  return history[history.length - 1];
}

export function popPreviousAppTab(history: readonly AppTab[]): {
  history: AppTab[];
  target?: AppTab;
} {
  if (history.length === 0) return { history: [] };
  return {
    history: history.slice(0, -1),
    target: history[history.length - 1],
  };
}

export function isAppBackShortcut(event: Pick<KeyboardEvent, "altKey" | "key" | "metaKey">): boolean {
  return event.key === "Escape"
    || (event.altKey && event.key === "ArrowLeft")
    || (event.metaKey && event.key === "[");
}
