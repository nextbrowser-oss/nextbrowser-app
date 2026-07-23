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
    title: "One task, one visible browser workflow",
    description: "You set the goal. A local agent receives the task and selected profile context; Sidebar and Live show the browser session it actually uses.",
    icon: "sparkles",
    tint: "#8e8cff",
  },
  {
    id: "agent",
    label: "Your agent",
    title: "Connect the agent you already use",
    description: "Choose the Claude Code CLI or ChatGPT desktop app with Codex, then check that the selected local agent is installed and signed in.",
    icon: "cpu.fill",
    tint: "#af52de",
  },
  {
    id: "profile",
    label: "Browser profile",
    title: "Choose a profile, then start its session",
    description: "A saved profile keeps browser context separate. It is ready for browser work only when its session is running.",
    icon: "person.2.fill",
    tint: "#34c759",
  },
  {
    id: "prompt",
    label: "First task",
    title: "Write the task like a short human brief",
    description: "The clearest prompts state the goal, browser context, limits, and expected result. You can queue follow-up instructions while work is running.",
    icon: "scroll.fill",
    tint: "#ff9500",
  },
  {
    id: "control",
    label: "Stay in control",
    title: "Watch the page and verify the result",
    description: "Use Chat for progress and run controls, Live for the actual page, and Sidebar to confirm the selected profile and session.",
    icon: "checkmark.shield.fill",
    tint: "#32ade6",
  },
];

export const ONBOARDING_AGENT_SETUP = {
  claude: {
    badge: "CLI",
    requirement: "Install and sign in to the Claude Code CLI.",
    linkLabel: "Claude Code setup guide",
  },
  codex: {
    badge: "DESKTOP APP",
    requirement: "Install the ChatGPT desktop app with Codex. No separate Codex CLI is required.",
    linkLabel: "Download ChatGPT desktop app",
  },
} as const;

export const FIRST_TASK_EXAMPLE = [
  "Using the selected browser profile, open https://example.com.",
  "Report the page title and main heading.",
  "Do not submit forms or change anything on the page.",
  "If the selected profile or its session is unavailable, stop and tell me.",
].join(" ");

export function onboardingProfileSummary(
  savedCount: number,
  runningCount: number,
): string {
  if (savedCount === 0) return "No saved profiles";
  return `${savedCount} saved · ${runningCount} running`;
}

export function canOpenOnboardingChat(
  agentReady: boolean,
  selectedSessionRunning: boolean,
): boolean {
  return agentReady && selectedSessionRunning;
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
