import type { ExecutionTarget } from "./executionTarget";

/** How long a due run that could not start waits before it tries again. The
 *  run stays due until it really starts, so it still fires once its agent or
 *  profile is back; the pause keeps a broken schedule from reconnecting its
 *  agent on every tick. */
export const SCHEDULE_START_RETRY_MS = 5 * 60_000;

/** How long a due run quietly waits for the app to finish loading (the browser
 *  profile list, or an agent connection that is already in progress) before it
 *  reports why it has not started. */
export const SCHEDULE_START_GRACE_MS = 5 * 60_000;

export type ScheduledStartCheck =
  | { status: "ready" }
  | { status: "wait"; reason: string }
  | { status: "failed"; error: string };

export interface ScheduledAgentRuntime {
  ready?: boolean;
  authorizing?: boolean;
  loggedIn?: boolean | null;
  error?: string;
}

/** Whether the schedule's agent can take its prompt now. The queue silently
 *  drops a prompt for an agent that is offline or signed out, so a scheduled
 *  run must check this before it counts as started. */
export function scheduledAgentCheck(runtime: ScheduledAgentRuntime | undefined, agentName: string): ScheduledStartCheck {
  if (runtime?.authorizing) return { status: "wait", reason: `${agentName} is still connecting.` };
  if (!runtime?.ready) {
    return { status: "failed", error: runtime?.error || `${agentName} is not connected. Connect ${agentName} in Nextbrowser.` };
  }
  if (runtime.loggedIn === false) {
    return { status: "failed", error: `${agentName} is signed out. Use “Log in” for ${agentName}.` };
  }
  return { status: "ready" };
}

/** A local run checks its saved profile against this computer's profile
 *  inventory. Until that inventory has been read, every profile would look
 *  deleted, so the run waits instead of failing. A VPS run uses the
 *  workspace's own profile list and never waits for it. */
export function scheduledInventoryCheck(target: ExecutionTarget, inventoryLoaded: boolean): ScheduledStartCheck {
  if (target === "vps" || inventoryLoaded) return { status: "ready" };
  return { status: "wait", reason: "The browser profile list has not loaded, so the scheduled profile could not be checked." };
}

/** A wait that has outlasted the grace period becomes a visible failure, so a
 *  run never waits forever without saying why. */
export function settleScheduledWait(check: ScheduledStartCheck, waitingSince: number, timestamp: number): ScheduledStartCheck {
  if (check.status !== "wait" || timestamp - waitingSince < SCHEDULE_START_GRACE_MS) return check;
  return { status: "failed", error: check.reason };
}
