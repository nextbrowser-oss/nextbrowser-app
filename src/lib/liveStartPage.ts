import { invoke } from "../electronBridge";
import { nextctlErrorMessage, nextctlJson, nextctlRun } from "../nextctl";
import type { TabsList } from "../types";
import type { LocalLiveTarget } from "./liveStreamTarget";

export function isBrowserPlaceholder(raw?: string) {
  const url = raw?.toLowerCase().replace(/\/$/, "");
  return !url || url === "about:blank" || url === "about:newtab" || url === "about:home" ||
    url === "chrome://newtab" || url === "chrome://new-tab-page" || url === "clawbrowser://newtab" ||
    url === "clawbrowser://verify";
}

export async function showLiveStartPage(target: LocalLiveTarget, current: () => boolean) {
  const args = ["--runtime", target.runtime, ...(target.profile ? ["--profile", target.profile] : [])];
  const { tabs } = await nextctlJson<TabsList>([...args, "tabs", "list"]);
  if (!current()) return;
  const active = tabs.find(tab => tab.active || tab.current);
  if (active && !isBrowserPlaceholder(active.url)) return;

  const existing = tabs.find(tab => !isBrowserPlaceholder(tab.url));
  if (existing) {
    const result = await nextctlRun([...args, "tabs", "activate", existing.id, "--format", "json"]);
    if (result.code !== 0) throw new Error(nextctlErrorMessage(result));
    return;
  }

  const url = await invoke<string>("live_start_page_url");
  if (!current()) return;
  const result = await nextctlRun([...args, "open", url, ...(tabs.length ? [] : ["--new-tab"]), "--format", "json"]);
  if (result.code !== 0) throw new Error(nextctlErrorMessage(result));
}
