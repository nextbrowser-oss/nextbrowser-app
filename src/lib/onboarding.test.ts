import { describe, expect, it } from "vitest";
import {
  canOpenOnboardingChat,
  FIRST_TASK_EXAMPLE,
  hasCompletedCurrentOnboarding,
  ONBOARDING_AGENT_SETUP,
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
  });

  it("states the different Claude and Codex installation requirements", () => {
    expect(ONBOARDING_AGENT_SETUP.claude.requirement).toContain("Claude Code CLI");
    expect(ONBOARDING_AGENT_SETUP.codex.requirement).toContain("ChatGPT desktop app with Codex");
    expect(ONBOARDING_AGENT_SETUP.codex.requirement).toContain("No separate Codex CLI");
  });

  it("uses a safe example with context, limits, output, and a stopped-session fallback", () => {
    expect(FIRST_TASK_EXAMPLE).toContain("selected browser profile");
    expect(FIRST_TASK_EXAMPLE).toContain("https://example.com");
    expect(FIRST_TASK_EXAMPLE).toContain("Do not submit forms");
    expect(FIRST_TASK_EXAMPLE).toContain("page title and main heading");
    expect(FIRST_TASK_EXAMPLE).toContain("session is unavailable");
    expect(FIRST_TASK_EXAMPLE).toContain("stop and tell me");
  });

  it("does not describe saved profiles as running sessions", () => {
    expect(onboardingProfileSummary(0, 0)).toBe("No saved profiles");
    expect(onboardingProfileSummary(3, 0)).toBe("3 saved · 0 running");
    expect(onboardingProfileSummary(3, 1)).toBe("3 saved · 1 running");
  });

  it("opens Chat as a ready action only with an agent and selected running session", () => {
    expect(canOpenOnboardingChat(true, true)).toBe(true);
    expect(canOpenOnboardingChat(true, false)).toBe(false);
    expect(canOpenOnboardingChat(false, true)).toBe(false);
  });

  it("shows each onboarding revision once, including after the legacy tour", () => {
    const storage = memoryStorage({ onboardingComplete: "true" });
    expect(hasCompletedCurrentOnboarding(storage)).toBe(false);

    saveOnboardingCompletion(storage);

    expect(storage.values.get(ONBOARDING_VERSION_KEY)).toBe(ONBOARDING_VERSION);
    expect(hasCompletedCurrentOnboarding(storage)).toBe(true);
  });
});
