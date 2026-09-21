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

function profileArgs(selectedProfile?: string, runtime?: string): string[] {
  return [...(selectedProfile ? ["--profile", selectedProfile] : []), ...(runtime ? ["--runtime", runtime] : [])];
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

async function runChecked(args: string[], message: string, requestId?: string): Promise<void> {
  const result = await nextctlRun(args, {}, requestId ? { requestId } : {});
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

interface VerificationCheck {
  pass?: boolean;
  surface?: string;
}

interface VerificationResult {
  verify?: {
    finalized?: boolean;
    status?: string;
    checks?: VerificationCheck[];
  };
}

export type VerificationFailureChoice = "direct" | "cancel";

export interface VerificationFailure {
  message: string;
  failedSurfaces: string[];
  proxyExpected: boolean;
  attempts: number;
}

class BrowserVerificationError extends Error {
  readonly failedSurfaces: string[];

  constructor(failedSurfaces: string[]) {
    const suffix = failedSurfaces.length ? `: ${failedSurfaces.join(", ")}` : ".";
    super(`Browser verification is not green${suffix}`);
    this.name = "BrowserVerificationError";
    this.failedSurfaces = failedSurfaces;
  }
}

async function requireGreenVerification(args: string[], onRetry?: () => void): Promise<void> {
  const inspect = () => nextctlJson<VerificationResult>([
    ...args,
    "verify",
    "--timeout",
    "30s",
  ]);
  let data: VerificationResult;
  try {
    data = await inspect();
  } catch (error) {
    // A browser can finish opening while its local CDP pipe is briefly being
    // replaced. Retrying one read is safe and avoids surfacing a false setup
    // failure after the page is already visible.
    const message = error instanceof Error ? error.message : String(error);
    if (!isTransientCdpDisconnect(message)) throw error;
    onRetry?.();
    await new Promise((resolve) => setTimeout(resolve, 350));
    data = await inspect();
  }
  const verification = data.verify;
  const failed = verification?.checks?.filter((check) => check.pass !== true) ?? [];
  if (verification?.finalized !== true || verification.status !== "pass" || !verification.checks?.length || failed.length > 0) {
    const surfaces = failed.flatMap((check) => check.surface ? [check.surface] : []);
    throw new BrowserVerificationError(surfaces);
  }
}

export function isTransientCdpDisconnect(message: string): boolean {
  return /(?:\bcdp\b.*(?:read response|connection|aborted|closed|reset)|Runtime\.evaluate.*(?:read|connection|aborted|closed|reset)|wsarecv.*(?:aborted|reset)|read tcp.*(?:aborted|reset))/i.test(message);
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
  directFallback?: boolean;
}

/** tidyEngineTabs closes what an unattended loop leaves behind in its profile:
 *  the clawbrowser://verify pages verification opens, and duplicate x.com tabs.
 *  One x.com tab is kept, and pages on any other site are left alone. Every
 *  nbc call dials every open page to pick the current one, so a profile with a
 *  dozen orphans slows each step and multiplies X's own polling. Returns how
 *  many tabs were closed. */
export async function tidyEngineTabs(args: string[]): Promise<number> {
  let list: TabsList;
  try {
    list = await nextctlJson<TabsList>([...args, "tabs", "list"]);
  } catch {
    return 0;
  }
  const tabs = (list.tabs ?? []).filter((tab) => !!tab.id);
  const onX = (url?: string) => ["x.com", "twitter.com"].includes(hostOf(url));
  const verifying = (url?: string) => (url ?? "").toLowerCase().startsWith("clawbrowser://verify");
  const keep = tabs.find((tab) => onX(tab.url) && (tab.active || tab.current)) ?? tabs.find((tab) => onX(tab.url));
  const doomed = tabs.filter((tab) => verifying(tab.url) || (onX(tab.url) && tab.id !== keep?.id));
  // Never close the last page: a profile with no page has nothing to navigate.
  if (doomed.length >= tabs.length) doomed.pop();
  let closed = 0;
  for (const tab of doomed) {
    try {
      await nextctlJson<unknown>([...args, "tabs", "close", tab.id]);
      closed += 1;
    } catch {
      /* a tab that vanished on its own is already what was wanted */
    }
  }
  return closed;
}

export async function prepareSession(opts: {
  host?: string;
  selectedProfile?: string;
  runtime?: "clawbrowser" | "dasbrowser" | "camoufox";
  statuses: Record<string, string>;
  defaultSession?: SessionStatus;
  onStep?: (step: string) => void;
  proxyExpected?: boolean;
  verifyOnly?: boolean;
  shouldContinue?: () => boolean;
  onVerificationFailure?: (failure: VerificationFailure) => Promise<VerificationFailureChoice>;
  /** The CLI verifies startup before returning success and stops on failure. */
  startupVerifies?: boolean;
  /** Legacy caller option. */
  verifyEvery?: number;
}): Promise<PrepareResult> {
  let args = profileArgs(opts.selectedProfile, opts.runtime);
  const steps: string[] = [];
  let directFallback = false;
  const rawHost = opts.host?.trim();
  const step = (text: string) => {
    steps.push(text);
    opts.onStep?.(text);
  };

  const proxyExpected = opts.proxyExpected !== false;
  const checkCancelled = () => {
    if (opts.shouldContinue?.() === false) throw new Error("Profile start cancelled");
  };
  const stop = () => runChecked([...args, "stop", "--format", "json"], "Could not stop the unverified browser");
  let running = await isRunning(opts.selectedProfile, opts.statuses, opts.defaultSession);
  let lastError: unknown;
  for (let attempt = 0; attempt < (proxyExpected && !opts.startupVerifies ? 3 : 1); attempt++) {
    checkCancelled();
    try {
      if (!running) {
        await runChecked([...args, "start", "--format", "json"], "Could not start Nextbrowser", opts.selectedProfile ? `profile-start:${opts.selectedProfile}` : undefined);
        step("Started Nextbrowser for verification");
      } else {
        step("Session running");
      }
      checkCancelled();
      if (!opts.startupVerifies) await requireGreenVerification(args, () => step("Reconnecting to the browser"));
      checkCancelled();
      step(opts.startupVerifies && running ? "Using running session" : "Browser verified");
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      // Stop must succeed before a retry or any direct-connection choice.
      await stop();
      running = false;
      checkCancelled();
      if (proxyExpected && !opts.startupVerifies && attempt < 2) step("Restarting the profile with the same proxy");
    }
  }
  if (lastError !== undefined) {
    const choice = await opts.onVerificationFailure?.({
      message: lastError instanceof Error ? lastError.message : String(lastError),
      failedSurfaces: lastError instanceof BrowserVerificationError ? lastError.failedSurfaces : [],
      proxyExpected,
      attempts: proxyExpected && !opts.startupVerifies ? 3 : 1,
    });
    checkCancelled();
    if (!proxyExpected || choice !== "direct") throw lastError;
    const directProfile = `direct-consented-${crypto.randomUUID()}`;
    await runChecked(["profiles", "create", directProfile, "--no-proxy", "--format", "json"], "Could not create a direct session");
    args = profileArgs(directProfile, opts.runtime);
    try {
      checkCancelled();
      await runChecked([...args, "start", "--format", "json"], "Could not start the direct session");
      checkCancelled();
      if (!opts.startupVerifies) await requireGreenVerification(args);
      checkCancelled();
      directFallback = true;
      step("Direct session verified after your confirmation");
    } catch (error) {
      await stop();
      throw error;
    }
  }

  if (opts.verifyOnly) return { profileArgs: args, steps, directFallback };

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

  return { profileArgs: args, host: rawHost || undefined, steps, directFallback };
}
