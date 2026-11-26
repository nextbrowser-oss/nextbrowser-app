import { translate } from "../shared/lib/i18n";
import { guideSessionState, type GuideSessionState } from "./guideQuickStart";
import type { BrowserToolset } from "../types";

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
    get label() { return translate("How it works"); },
    get title() { return translate("How it works"); },
    get description() { return translate("Set the goal. The agent uses your selected profile, and Live shows the browser."); },
    icon: "sparkles",
    tint: "var(--accent)",
  },
  {
    id: "agent",
    get label() { return translate("Your agent"); },
    get title() { return translate("Setup agent"); },
    description: "",
    icon: "cpu.fill",
    tint: "var(--purple)",
  },
  {
    id: "profile",
    get label() { return translate("Browser profile"); },
    get title() { return translate("Setup profile"); },
    get description() { return translate("Choose the profile the agent should use, then start it."); },
    icon: "person.2.fill",
    tint: "var(--success)",
  },
  {
    id: "prompt",
    get label() { return translate("First task"); },
    get title() { return translate("Try your first task"); },
    get description() { return translate("Tell the agent what to do and what result you want."); },
    icon: "scroll.fill",
    tint: "var(--warn)",
  },
  {
    id: "control",
    get label() { return translate("Live Streaming"); },
    get title() { return translate("Watch the browser live"); },
    get description() { return translate("When you ask the agent to use the browser, Live Streaming starts automatically."); },
    icon: "video.fill",
    tint: "var(--info)",
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

const TOOLSET_LABELS: Record<BrowserToolset, string> = {
  clawbrowser: "Clawbrowser",
  dasbrowser: "DasBrowser",
  camoufox: "Camoufox",
};

export interface OnboardingProfileChoice {
  name: string;
  label: string;
  detail: string;
  state: GuideSessionState;
}

/** The workspace profiles the profile step lets the user choose from. */
export function onboardingProfileChoices(
  names: readonly string[],
  profiles: ReadonlyArray<{ name: string; display_name?: string | null }>,
  toolsets: Readonly<Record<string, BrowserToolset | undefined>>,
  statuses: Readonly<Record<string, string | undefined>>,
): OnboardingProfileChoice[] {
  return names.map((name) => {
    const state = guideSessionState(statuses[name]);
    const toolset = TOOLSET_LABELS[toolsets[name] ?? "clawbrowser"];
    return {
      name,
      label: profiles.find((profile) => profile.name === name)?.display_name || name,
      detail: `${toolset} · ${state === "running" ? "Running" : state === "starting" ? "Starting…" : "Stopped"}`,
      state,
    };
  });
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
