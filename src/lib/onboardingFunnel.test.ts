import { describe, expect, it, vi } from "vitest";
import { FIRST_TASK_EXAMPLE, ONBOARDING_VERSION } from "./onboarding";
import {
  browserProfileRunning,
  createOnboardingFunnel,
  firstTaskStageAfterSubmit,
  firstTaskStageAfterSuccess,
  isFirstTaskExample,
  onboardingStepReady,
  onboardingTrigger,
  trackFirstTaskSubmitted,
  trackFirstTaskSucceeded,
} from "./onboardingFunnel";

vi.mock("./analytics", () => ({ trackEvent: vi.fn() }));

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    values,
  };
}

const notReady = { accountConnected: false, agentReady: false, profileRunning: false };
const allReady = { accountConnected: true, agentReady: true, profileRunning: true };

describe("onboardingTrigger", () => {
  it("tells a new install from a new tour revision and a replay", () => {
    expect(onboardingTrigger(memoryStorage())).toBe("first_run");
    expect(onboardingTrigger(memoryStorage({ onboardingComplete: "true" }))).toBe("new_version");
    expect(onboardingTrigger(memoryStorage({ onboardingVersion: "1" }))).toBe("new_version");
    expect(onboardingTrigger(memoryStorage({ onboardingVersion: ONBOARDING_VERSION }))).toBe("replay");
  });
});

describe("onboardingStepReady", () => {
  it("holds each step to its own criterion", () => {
    expect(onboardingStepReady("workspace", { ...notReady, accountConnected: true }, "continue")).toBe(true);
    expect(onboardingStepReady("workspace", notReady, "continue")).toBe(false);
    expect(onboardingStepReady("agent", { ...notReady, agentReady: true }, "continue")).toBe(true);
    expect(onboardingStepReady("agent", { ...allReady, agentReady: false }, "continue")).toBe(false);
    expect(onboardingStepReady("profile", { ...notReady, profileRunning: true }, "continue")).toBe(true);
    expect(onboardingStepReady("profile", { ...allReady, profileRunning: false }, "continue")).toBe(false);
    expect(onboardingStepReady("control", { ...notReady, profileRunning: true }, "open_live")).toBe(true);
    expect(onboardingStepReady("control", { ...allReady, profileRunning: false }, "finish")).toBe(false);
  });

  it("counts the first-task step only when the example went to Chat", () => {
    expect(onboardingStepReady("prompt", notReady, "try_chat")).toBe(true);
    expect(onboardingStepReady("prompt", allReady, "continue")).toBe(false);
  });
});

describe("onboarding funnel", () => {
  function funnel() {
    const track = vi.fn();
    let clock = 1_000;
    const tour = createOnboardingFunnel(track, () => clock);
    return { track, tour, advance: (ms: number) => { clock += ms; } };
  }

  it("starts a run on the first step view and tags it with the trigger", () => {
    const { track, tour } = funnel();
    tour.viewStep("workspace", "first_run");

    expect(track.mock.calls).toEqual([
      ["onboarding_started", { trigger: "first_run", onboarding_version: ONBOARDING_VERSION }],
      ["onboarding_step_viewed", { step: "workspace", step_number: 1, trigger: "first_run" }],
    ]);
  });

  it("does not count the tour coming back from setup as a new view", () => {
    const { track, tour } = funnel();
    tour.viewStep("profile", "first_run");
    // The tour stepped aside to start a profile and remounted on the same step.
    tour.viewStep("profile", "replay");
    tour.viewStep("prompt", "replay");
    tour.viewStep("profile", "replay");

    expect(track.mock.calls.map(([name, params]) => [name, params.step, params.trigger])).toEqual([
      ["onboarding_started", undefined, "first_run"],
      ["onboarding_step_viewed", "profile", "first_run"],
      ["onboarding_step_viewed", "prompt", "first_run"],
      ["onboarding_step_viewed", "profile", "first_run"],
    ]);
  });

  it("completes a step once per run and says whether its criterion held", () => {
    const { track, tour } = funnel();
    tour.viewStep("agent", "first_run");
    track.mockClear();
    tour.completeStep("agent", "continue", notReady);
    tour.completeStep("agent", "continue", allReady);

    expect(track).toHaveBeenCalledExactlyOnceWith("onboarding_step_completed", {
      step: "agent",
      step_number: 2,
      via: "continue",
      ready: false,
      trigger: "first_run",
    });
  });

  it("closes with the run's progress and starts a new run after", () => {
    const { track, tour, advance } = funnel();
    tour.viewStep("workspace", "first_run");
    tour.completeStep("workspace", "continue", allReady);
    tour.viewStep("agent", "first_run");
    tour.completeStep("agent", "continue", allReady);
    advance(42_000);
    track.mockClear();
    tour.close("skipped", { lastStep: "profile", agentReady: true, profileCount: 3 });

    expect(track).toHaveBeenCalledExactlyOnceWith("onboarding_closed", {
      reason: "skipped",
      last_step: "profile",
      agent_ready: true,
      profile_count: 3,
      trigger: "first_run",
      steps_completed: 2,
      duration_ms: 42_000,
    });

    track.mockClear();
    tour.viewStep("workspace", "replay");
    tour.completeStep("workspace", "continue", allReady);
    expect(track.mock.calls.map(([name]) => name)).toEqual([
      "onboarding_started",
      "onboarding_step_viewed",
      "onboarding_step_completed",
    ]);
  });

  it("reports the tour returning from setup with or without a failure", () => {
    const { track, tour } = funnel();
    tour.viewStep("control", "first_run");
    track.mockClear();
    tour.resume("control", true);
    tour.resume(undefined, false);

    expect(track).toHaveBeenCalledExactlyOnceWith("onboarding_resumed", {
      step: "control",
      step_number: 5,
      failed: true,
      trigger: "first_run",
    });
  });

  it("never sends what the user typed or named", () => {
    const { track, tour } = funnel();
    tour.viewStep("profile", "first_run");
    tour.completeStep("profile", "continue", allReady);
    tour.resume("profile", true);
    tour.close("completed", { lastStep: "profile", agentReady: true, profileCount: 1 });

    for (const [, params] of track.mock.calls) {
      for (const value of Object.values(params as Record<string, unknown>)) {
        expect(["string", "number", "boolean", "undefined"]).toContain(typeof value);
        if (typeof value === "string") expect(value).toMatch(/^[a-z0-9_]+$/);
      }
    }
  });
});

describe("first task milestones", () => {
  it("marks the first task of a new install, and only that one", () => {
    expect(firstTaskStageAfterSubmit(undefined, false)).toEqual({ stage: "submitted", milestone: true });
    expect(firstTaskStageAfterSubmit("submitted", false)).toEqual({ stage: "submitted", milestone: false });
    expect(firstTaskStageAfterSubmit("succeeded", false)).toEqual({ stage: "succeeded", milestone: false });
  });

  it("keeps an install that sent tasks before out of the funnel", () => {
    expect(firstTaskStageAfterSubmit(undefined, true)).toEqual({ stage: "legacy", milestone: false });
    expect(firstTaskStageAfterSuccess("legacy", true)).toEqual({ stage: "legacy", milestone: false });
  });

  it("waits for a reply that ran with a browser profile", () => {
    expect(firstTaskStageAfterSuccess("submitted", false)).toEqual({ stage: "submitted", milestone: false });
    expect(firstTaskStageAfterSuccess("submitted", true)).toEqual({ stage: "succeeded", milestone: true });
    expect(firstTaskStageAfterSuccess("succeeded", true)).toEqual({ stage: "succeeded", milestone: false });
    expect(firstTaskStageAfterSuccess(undefined, true)).toEqual({ stage: undefined, milestone: false });
  });

  it("sends each milestone once per install", () => {
    const storage = memoryStorage({ onboardingVersion: ONBOARDING_VERSION });
    const track = vi.fn();
    const params = { agent: "claude", execution_target: "local", from_example: true };

    trackFirstTaskSubmitted(storage, false, params, track);
    trackFirstTaskSubmitted(storage, true, params, track);
    trackFirstTaskSucceeded(storage, false, params, track);
    trackFirstTaskSucceeded(storage, true, params, track);
    trackFirstTaskSucceeded(storage, true, params, track);

    expect(track.mock.calls).toEqual([
      ["first_task_submitted", { ...params, onboarding_done: true }],
      ["first_task_succeeded", { ...params, onboarding_done: true }],
    ]);
    expect(storage.values.get("nextbrowser.funnel.firstTask")).toBe("succeeded");
  });

  it("sends nothing for an install with earlier tasks", () => {
    const storage = memoryStorage();
    const track = vi.fn();
    trackFirstTaskSubmitted(storage, true, {}, track);
    trackFirstTaskSucceeded(storage, true, {}, track);

    expect(track).not.toHaveBeenCalled();
    expect(storage.values.get("nextbrowser.funnel.firstTask")).toBe("legacy");
  });

  it("stays silent and never throws when storage fails", () => {
    const track = vi.fn();
    const broken = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    };
    const readOnly = { getItem: () => null, setItem: () => { throw new Error("full"); } };

    expect(() => trackFirstTaskSubmitted(broken, false, {}, track)).not.toThrow();
    expect(() => trackFirstTaskSubmitted(readOnly, false, {}, track)).not.toThrow();
    expect(() => trackFirstTaskSucceeded(broken, true, {}, track)).not.toThrow();
    expect(track).not.toHaveBeenCalled();
  });

  it("sees a browser profile running at the start or the end of the task", () => {
    expect(browserProfileRunning(["work", "shop"], { shop: "running" }, undefined, 0)).toBe(true);
    expect(browserProfileRunning(["work"], { work: "stopped" }, undefined, 1)).toBe(true);
    expect(browserProfileRunning(["__default"], {}, "running", 0)).toBe(true);
    expect(browserProfileRunning(["work"], { work: "starting", other: "running" }, "running", 0)).toBe(false);
    expect(browserProfileRunning([], {}, undefined, 0)).toBe(false);
  });

  it("recognises the tour's example task without reading other prompts", () => {
    expect(isFirstTaskExample(`  ${FIRST_TASK_EXAMPLE}\n`)).toBe(true);
    expect(isFirstTaskExample("Open example.com")).toBe(false);
  });
});
