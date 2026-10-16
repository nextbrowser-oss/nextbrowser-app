import { trackEvent } from "./analytics";
import {
  FIRST_TASK_EXAMPLE,
  hasCompletedCurrentOnboarding,
  LEGACY_ONBOARDING_KEY,
  ONBOARDING_STEPS,
  ONBOARDING_VERSION,
  ONBOARDING_VERSION_KEY,
  type OnboardingStep,
} from "./onboarding";

// The onboarding funnel: first launch -> tour -> first browser task. Its events
// carry step ids, enums, counts, and booleans only. Never put what the user
// typed or named in them: no emails, profile or project names, prompts, URLs.

type StepId = OnboardingStep["id"];
type FunnelParams = Record<string, string | number | boolean | undefined>;
type Track = (name: string, params?: FunnelParams) => void;

/** Why the tour opened: a new install, a new tour revision for someone who
 *  finished an older one, or Replay from Guide. */
export type OnboardingTrigger = "first_run" | "new_version" | "replay";

/** How the user left a step forward. */
export type OnboardingStepExit = "continue" | "rail" | "try_chat" | "open_live" | "finish";

export interface OnboardingReadiness {
  accountConnected: boolean;
  agentReady: boolean;
  /** The profile the agent will use is running. */
  profileRunning: boolean;
}

export function onboardingTrigger(storage: Pick<Storage, "getItem">): OnboardingTrigger {
  const version = storage.getItem(ONBOARDING_VERSION_KEY);
  if (version === ONBOARDING_VERSION) return "replay";
  if (version || storage.getItem(LEGACY_ONBOARDING_KEY) === "true") return "new_version";
  return "first_run";
}

/** Whether a step's own completion criterion holds as the user leaves it. */
export function onboardingStepReady(step: StepId, readiness: OnboardingReadiness, via: OnboardingStepExit): boolean {
  switch (step) {
    case "workspace": return readiness.accountConnected;
    case "agent": return readiness.agentReady;
    case "profile": return readiness.profileRunning;
    case "prompt": return via === "try_chat";
    case "control": return readiness.profileRunning;
  }
}

function stepNumber(step: StepId): number {
  return ONBOARDING_STEPS.findIndex((item) => item.id === step) + 1;
}

export function createOnboardingFunnel(track: Track, now: () => number = Date.now) {
  let run: { trigger: OnboardingTrigger; startedAt: number; lastViewed?: StepId; completed: Set<StepId> } | undefined;

  return {
    /** Records a step the tour shows. The first view starts a tour run. */
    viewStep(step: StepId, trigger: OnboardingTrigger) {
      if (!run) {
        run = { trigger, startedAt: now(), completed: new Set() };
        track("onboarding_started", { trigger, onboarding_version: ONBOARDING_VERSION });
      }
      // The tour remounts when it comes back from a setup it stepped aside
      // for. Showing the same step again is not a new view.
      if (run.lastViewed === step) return;
      run.lastViewed = step;
      track("onboarding_step_viewed", { step, step_number: stepNumber(step), trigger: run.trigger });
    },

    /** Records the user leaving a step forward, once per step and tour run. */
    completeStep(step: StepId, via: OnboardingStepExit, readiness: OnboardingReadiness) {
      if (run?.completed.has(step)) return;
      run?.completed.add(step);
      track("onboarding_step_completed", {
        step,
        step_number: stepNumber(step),
        via,
        ready: onboardingStepReady(step, readiness, via),
        trigger: run?.trigger,
      });
    },

    /** Records the tour coming back after the setup it stepped aside for. */
    resume(step: StepId | undefined, failed: boolean) {
      if (!step) return;
      track("onboarding_resumed", { step, step_number: stepNumber(step), failed, trigger: run?.trigger });
    },

    /** Records the tour closing and ends the run. */
    close(reason: "skipped" | "completed", details: { lastStep: StepId; agentReady: boolean; profileCount: number }) {
      track("onboarding_closed", {
        reason,
        last_step: details.lastStep,
        agent_ready: details.agentReady,
        profile_count: details.profileCount,
        trigger: run?.trigger,
        steps_completed: run?.completed.size ?? 0,
        duration_ms: run ? Math.max(0, now() - run.startedAt) : undefined,
      });
      run = undefined;
    },
  };
}

export const onboardingFunnel = createOnboardingFunnel((name, params) => trackEvent(name, params));

// First task milestones, once per install. "legacy" marks an install that had
// already sent a task before these events existed: it never reports them.
const FIRST_TASK_KEY = "nextbrowser.funnel.firstTask";
export type FirstTaskStage = "submitted" | "succeeded" | "legacy";

export function firstTaskStageAfterSubmit(
  stage: FirstTaskStage | undefined,
  hadEarlierTask: boolean,
): { stage: FirstTaskStage; milestone: boolean } {
  if (stage) return { stage, milestone: false };
  return hadEarlierTask ? { stage: "legacy", milestone: false } : { stage: "submitted", milestone: true };
}

/** The first task succeeds on the first finished reply that ran with a browser
 *  profile up. A reply without a browser does not end the wait for one. */
export function firstTaskStageAfterSuccess(
  stage: FirstTaskStage | undefined,
  browserUsed: boolean,
): { stage: FirstTaskStage | undefined; milestone: boolean } {
  if (stage === "submitted" && browserUsed) return { stage: "succeeded", milestone: true };
  return { stage, milestone: false };
}

/** A browser profile of the task's workspace was up when the task started or
 *  is up as it finishes. */
export function browserProfileRunning(
  profileNames: readonly string[],
  statuses: Readonly<Record<string, string | undefined>>,
  defaultStatus: string | undefined,
  runningAtStart: number,
): boolean {
  if (runningAtStart > 0) return true;
  return profileNames.some((name) =>
    name === "__default" ? defaultStatus === "running" : statuses[name] === "running");
}

export function isFirstTaskExample(prompt: string): boolean {
  return prompt.trim() === FIRST_TASK_EXAMPLE;
}

type StageStorage = Pick<Storage, "getItem" | "setItem">;

function readStage(storage: StageStorage): FirstTaskStage | undefined {
  const value = storage.getItem(FIRST_TASK_KEY);
  return value === "submitted" || value === "succeeded" || value === "legacy" ? value : undefined;
}

// Storage that cannot be read or written reports nothing, so a broken store
// never repeats a "first" event on every task. Nothing here may throw: it runs
// on the path that sends and finishes agent turns.
function trackMilestone(
  storage: StageStorage,
  name: string,
  params: FunnelParams,
  track: Track,
  next: (stage: FirstTaskStage | undefined) => { stage: FirstTaskStage | undefined; milestone: boolean },
): void {
  try {
    const current = readStage(storage);
    const { stage, milestone } = next(current);
    if (stage && stage !== current) storage.setItem(FIRST_TASK_KEY, stage);
    if (milestone) track(name, { ...params, onboarding_done: hasCompletedCurrentOnboarding(storage) });
  } catch {
    // Analytics never blocks a task.
  }
}

export function trackFirstTaskSubmitted(
  storage: StageStorage,
  hadEarlierTask: boolean,
  params: FunnelParams,
  track: Track = trackEvent,
): void {
  trackMilestone(storage, "first_task_submitted", params, track, (stage) => firstTaskStageAfterSubmit(stage, hadEarlierTask));
}

export function trackFirstTaskSucceeded(
  storage: StageStorage,
  browserUsed: boolean,
  params: FunnelParams,
  track: Track = trackEvent,
): void {
  trackMilestone(storage, "first_task_succeeded", params, track, (stage) => firstTaskStageAfterSuccess(stage, browserUsed));
}
