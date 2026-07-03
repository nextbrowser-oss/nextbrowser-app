// Deterministic session preparation before scripts/skills run.
// Port of clawdesk AppState.prepareSession + helpers.

import { clawctlJson, clawctlRun } from "./clawctl";
import type { SessionStatus, TabsList } from "./types";

export function hostOf(raw?: string | null): string {
  if (!raw) return "";
  const withScheme = raw.includes("://") ? raw : `https://${raw}`;
  try {
    let h = new URL(withScheme).hostname.toLowerCase();
    if (h.startsWith("www.")) h = h.slice(4);
    return h;
  } catch {
    return "";
  }
}

function profileArgs(selectedProfile?: string): string[] {
  return selectedProfile ? ["--profile", selectedProfile] : [];
}

async function isRunning(
  selectedProfile: string | undefined,
  statuses: Record<string, string>,
  defaultSession?: SessionStatus,
): Promise<boolean> {
  if (selectedProfile) return statuses[selectedProfile] === "running";
  return defaultSession?.status === "running";
}

async function hasUsablePage(args: string[]): Promise<boolean> {
  try {
    const list = await clawctlJson<TabsList>([...args, "tabs", "list"]);
    return list.tabs.some((t) => {
      const u = (t.url ?? "").toLowerCase();
      return u.startsWith("http://") || u.startsWith("https://") || u === "about:blank";
    });
  } catch {
    return false;
  }
}

async function activateMatchingTab(args: string[], host: string): Promise<boolean> {
  const want = hostOf(host);
  if (!want) return false;
  try {
    const list = await clawctlJson<TabsList>([...args, "tabs", "list"]);
    const match = list.tabs.find((t) => hostOf(t.url) === want);
    if (!match) return false;
    if (match.active || match.current) return true;
    await clawctlRun([...args, "tabs", "activate", match.id, "--format", "json"]);
    return true;
  } catch {
    return false;
  }
}

async function openBlankActivePage(args: string[]): Promise<boolean> {
  try {
    const data = await clawctlJson<{ tab?: { id: string } }>([
      ...args,
      "open",
      "about:blank",
      "--new-tab",
    ]);
    const id = data.tab?.id;
    if (!id) return false;
    await clawctlRun([...args, "tabs", "activate", id, "--format", "json"]);
    return true;
  } catch {
    return false;
  }
}

export interface PrepareResult {
  profileArgs: string[];
  host?: string;
  steps: string[];
}

export async function prepareSession(opts: {
  host?: string;
  selectedProfile?: string;
  statuses: Record<string, string>;
  defaultSession?: SessionStatus;
  onStep?: (step: string) => void;
}): Promise<PrepareResult> {
  const args = profileArgs(opts.selectedProfile);
  const steps: string[] = [];
  const rawHost = opts.host?.trim();
  const step = (text: string) => {
    steps.push(text);
    opts.onStep?.(text);
  };

  const running = await isRunning(opts.selectedProfile, opts.statuses, opts.defaultSession);
  if (running) {
    step("Session running");
  } else {
    await clawctlRun([...args, "start", "--format", "json"]).catch(() => undefined);
    step("Started NextBrowser");
  }

  if (rawHost) {
    if (await activateMatchingTab(args, rawHost)) {
      step(`Switched to ${rawHost}`);
    } else {
      const target = rawHost.includes("://") ? rawHost : `https://${rawHost}`;
      await clawctlRun([...args, "open", target, "--format", "json"]).catch(() => undefined);
      step(`Opened ${rawHost}`);
    }
    await clawctlRun([...args, "wait", "--load", "--timeout", "10s", "--format", "json"]).catch(
      () => undefined,
    );
    step("Page ready");
  } else if (!(await hasUsablePage(args))) {
    await openBlankActivePage(args);
    step("Opened a blank page");
  }

  return { profileArgs: args, host: rawHost || undefined, steps };
}
