// Deterministic session preparation before scripts/skills run.
// Port of clawdesk AppState.prepareSession + helpers.

import { nextctlErrorMessage, nextctlJson, nextctlRun } from "./nextctl";
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
    const list = await nextctlJson<TabsList>([...args, "tabs", "list"]);
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
  let list: TabsList;
  try {
    list = await nextctlJson<TabsList>([...args, "tabs", "list"]);
  } catch {
    return false;
  }
  const match = list.tabs.find((t) => hostOf(t.url) === want);
  if (!match) return false;
  if (match.active || match.current) return true;
  await runChecked(
    [...args, "tabs", "activate", match.id, "--format", "json"],
    `Could not switch to ${host}`,
  );
  return true;
}

async function runChecked(args: string[], message: string): Promise<void> {
  const result = await nextctlRun(args);
  let envelopeFailed = false;
  try {
    const envelope = JSON.parse(result.stdout) as { ok?: boolean; error?: unknown };
    envelopeFailed = envelope.ok === false || envelope.error != null;
  } catch {
    /* plain output is valid for older nextctl builds */
  }
  if (result.code !== 0 || envelopeFailed) {
    throw new Error(`${message}: ${nextctlErrorMessage(result)}`);
  }
}

async function openBlankActivePage(args: string[]): Promise<void> {
  const data = await nextctlJson<{ tab?: { id: string } }>([
    ...args,
    "open",
    "about:blank",
    "--new-tab",
  ]);
  const id = data.tab?.id;
  if (!id) throw new Error("Could not open a blank page: nextctl returned no tab.");
  await runChecked(
    [...args, "tabs", "activate", id, "--format", "json"],
    "Could not activate the blank page",
  );
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
    await runChecked(
      [...args, "start", "--format", "json"],
      "Could not start NextBrowser",
    );
    step("Started NextBrowser");
  }

  if (rawHost) {
    if (await activateMatchingTab(args, rawHost)) {
      step(`Switched to ${rawHost}`);
    } else {
      const target = rawHost.includes("://") ? rawHost : `https://${rawHost}`;
      await runChecked(
        [...args, "open", target, "--format", "json"],
        `Could not open ${rawHost}`,
      );
      step(`Opened ${rawHost}`);
    }
    await runChecked(
      [...args, "wait", "--load", "--timeout", "10s", "--format", "json"],
      `Could not finish loading ${rawHost}`,
    );
    step("Page ready");
  } else if (!(await hasUsablePage(args))) {
    await openBlankActivePage(args);
    step("Opened a blank page");
  }

  return { profileArgs: args, host: rawHost || undefined, steps };
}
