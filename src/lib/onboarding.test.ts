import { describe, expect, it } from "vitest";
import {
  FIRST_TASK_EXAMPLE,
  hasCompletedCurrentOnboarding,
  ONBOARDING_STEPS,
  ONBOARDING_VERSION,
  ONBOARDING_VERSION_KEY,
  onboardingProfileSummary,
  saveOnboardingCompletion,
} from "./onboarding";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

describe("first-run onboarding", () => {
  it("has a short, unique journey through the real product model", () => {
    expect(ONBOARDING_STEPS).toHaveLength(5);
    expect(new Set(ONBOARDING_STEPS.map((step) => step.id)).size).toBe(5);
    expect(ONBOARDING_STEPS.map((step) => step.id)).toEqual([
      "workspace",
      "agent",
      "profile",
      "prompt",
      "control",
    ]);
    expect(ONBOARDING_STEPS[0].title).toBe("How it works");
    expect(ONBOARDING_STEPS[1]).toMatchObject({
      title: "Setup agent",
      description: "",
    });
    expect(ONBOARDING_STEPS[2]).toMatchObject({
      title: "Setup profile",
      description: "Choose the profile the agent should use, then start it.",
    });
    expect(ONBOARDING_STEPS[3]).toMatchObject({
      title: "Try your first task",
      description: "Tell the agent what to do and what result you want.",
    });
    expect(ONBOARDING_STEPS[4]).toMatchObject({
      label: "Live Streaming",
      title: "Watch the browser live",
      description: "When you ask the agent to use the browser, Live Streaming starts automatically.",
    });
  });

  it("uses a short, safe example with a clear result", () => {
    expect(FIRST_TASK_EXAMPLE).toContain("selected profile");
    expect(FIRST_TASK_EXAMPLE).toContain("example.com");
    expect(FIRST_TASK_EXAMPLE).toContain("Do not submit forms");
    expect(FIRST_TASK_EXAMPLE).toContain("page title");
  });

  it("does not describe saved profiles as running sessions", () => {
    expect(onboardingProfileSummary(0, 0)).toBe("No saved profiles");
    expect(onboardingProfileSummary(3, 0)).toBe("3 saved · 0 running");
    expect(onboardingProfileSummary(3, 1)).toBe("3 saved · 1 running");
  });

  it("shows each onboarding revision once, including after the legacy tour", () => {
    const storage = memoryStorage({ onboardingComplete: "true" });
    expect(hasCompletedCurrentOnboarding(storage)).toBe(false);

    saveOnboardingCompletion(storage);

    expect(storage.values.get(ONBOARDING_VERSION_KEY)).toBe(ONBOARDING_VERSION);
    expect(hasCompletedCurrentOnboarding(storage)).toBe(true);
  });
});
