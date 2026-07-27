export const ONBOARDING_VERSION = "2";
export const ONBOARDING_VERSION_KEY = "onboardingVersion";
export const LEGACY_ONBOARDING_KEY = "onboardingComplete";

export interface OnboardingStep {
  id: "workspace" | "agent" | "profile" | "prompt" | "control";
  label: string;
  title: string;
  description: string;
  icon: string;
  tint: string;
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "workspace",
    label: "How it works",
    title: "How it works",
    description: "Set the goal. The agent uses your selected profile, and Live shows the browser.",
    icon: "sparkles",
    tint: "#8e8cff",
  },
  {
    id: "agent",
    label: "Your agent",
    title: "Setup agent",
    description: "",
    icon: "cpu.fill",
    tint: "#af52de",
  },
  {
    id: "profile",
    label: "Browser profile",
    title: "Setup profile",
    description: "Choose the profile the agent should use, then start it.",
    icon: "person.2.fill",
    tint: "#34c759",
  },
  {
    id: "prompt",
    label: "First task",
    title: "Try your first task",
    description: "Tell the agent what to do and what result you want.",
    icon: "scroll.fill",
    tint: "#ff9500",
  },
  {
    id: "control",
    label: "Live Streaming",
    title: "Watch the browser live",
    description: "When you ask the agent to use the browser, Live Streaming starts automatically.",
    icon: "video.fill",
    tint: "#32ade6",
  },
];

export const FIRST_TASK_EXAMPLE =
  "Open example.com in the selected profile and tell me the page title. Do not submit forms or change anything.";

export function onboardingProfileSummary(
  savedCount: number,
  runningCount: number,
): string {
  if (savedCount === 0) return "No saved profiles";
  return `${savedCount} saved · ${runningCount} running`;
}

export function hasCompletedCurrentOnboarding(
  storage: Pick<Storage, "getItem">,
): boolean {
  return storage.getItem(ONBOARDING_VERSION_KEY) === ONBOARDING_VERSION;
}

export function saveOnboardingCompletion(
  storage: Pick<Storage, "setItem">,
): void {
  storage.setItem(ONBOARDING_VERSION_KEY, ONBOARDING_VERSION);
  storage.setItem(LEGACY_ONBOARDING_KEY, "true");
}
