import { Children, isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The tests run without a DOM, so call the component as a function with inert
// hooks and press its buttons through their props.
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useCallback: <T,>(callback: T) => callback,
  useEffect: () => undefined,
  useRef: <T,>(value: T) => ({ current: value }),
  useState: <T,>(value: T) => [value, () => undefined],
}));

vi.mock("../lib/analytics", () => ({ trackEvent: vi.fn() }));

const { state } = vi.hoisted(() => ({
  state: {
    finishOnboarding: vi.fn(),
    authorizeAgent: vi.fn(),
    loginAgent: vi.fn(),
    setTab: vi.fn(),
    setTerminalChat: vi.fn(),
    setSidebarCollapsed: vi.fn(),
    agentId: "claude",
    switchAgent: vi.fn(),
    agentReady: () => true,
    agentVersion: () => "2.1.86",
    agentLoggedIn: () => true,
    agentError: () => undefined,
    runtime: { claude: { authorizing: false } },
    authed: true,
    profiles: [] as Array<{ name: string }>,
    workspaces: [] as Array<{ id: string; profileNames: string[]; profileToolsets?: Record<string, string> }>,
    activeWorkspaceId: "workspace",
    statuses: {} as Record<string, string>,
    selectedProfile: undefined as string | undefined,
    selectProfile: vi.fn(),
    setDashboardKeyPromptOpen: vi.fn(),
    onboardingStepIndex: 4,
    setOnboardingStepIndex: vi.fn(),
    suspendOnboardingForSetup: vi.fn(),
    onboardingSetupError: undefined as string | undefined,
    profilesLoaded: true,
    workspaceSetupAuto: "done",
    defaultProfilesCreating: false,
    createDefaultProfiles: vi.fn(),
  },
}));

vi.mock("../store", () => ({
  useStore: (selector: (value: typeof state) => unknown) => selector(state),
}));

import { trackEvent } from "../lib/analytics";
import { OnboardingView } from "./OnboardingView";

function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : "";
}

type ButtonProps = { children?: ReactNode; onClick: () => void; disabled?: boolean };

function button(node: ReactNode, matches: (caption: string) => boolean): ButtonProps | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<ButtonProps>(child)) continue;
    if (child.type === "button" && matches(text(child.props.children).trim())) return child.props;
    const match = button(child.props.children, matches);
    if (match) return match;
  }
}

function find(label: string) {
  return button(OnboardingView(), (caption) => caption === label);
}

function press(label: string) {
  const target = find(label);
  expect(target, `button "${label}"`).toBeDefined();
  expect(target!.disabled, `button "${label}" is enabled`).toBeFalsy();
  target!.onClick();
}

// A profile row reads as its name followed by its toolset and status.
function pressProfile(label: string) {
  const target = button(OnboardingView(), (caption) => caption.startsWith(label) && caption.includes(" · "));
  expect(target, `profile "${label}"`).toBeDefined();
  target!.onClick();
}

const dispatched = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", {
    requestAnimationFrame: (callback: FrameRequestCallback) => { callback(0); return 0; },
    dispatchEvent: (event: Event) => { dispatched(event.type); return true; },
  });
  state.onboardingStepIndex = 4;
  state.profiles = [{ name: "work" }];
  state.workspaces = [{ id: "workspace", profileNames: ["work"] }];
  state.selectedProfile = "work";
  state.statuses = { work: "stopped" };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Live step profile start", () => {
  it("steps the tour aside before the sidebar starts the profile", () => {
    press("Start profile");

    expect(state.suspendOnboardingForSetup).toHaveBeenCalledOnce();
    expect(state.setSidebarCollapsed).toHaveBeenCalledWith(false);
    expect(dispatched).toHaveBeenCalledExactlyOnceWith("nextbrowser:start-selected-profile");
    // Suspending first keeps the download prompt and start errors from opening
    // under the tour.
    expect(state.suspendOnboardingForSetup.mock.invocationCallOrder[0])
      .toBeLessThan(dispatched.mock.invocationCallOrder[0]);
  });

  it("opens the profile creator when the workspace has no profile", () => {
    state.profiles = [];
    state.workspaces = [{ id: "workspace", profileNames: [] }];
    state.selectedProfile = undefined;

    press("Set up profile");

    expect(state.suspendOnboardingForSetup).toHaveBeenCalledOnce();
    expect(dispatched).toHaveBeenCalledExactlyOnceWith("nextbrowser:open-profile-creator");
  });
});

describe("profile step", () => {
  const names = ["Clawbrowser profile", "DasBrowser profile", "Camoufox profile"];

  beforeEach(() => {
    state.onboardingStepIndex = 2;
    state.profiles = names.map((name) => ({ name }));
    state.workspaces = [{
      id: "workspace",
      profileNames: names,
      profileToolsets: { "Clawbrowser profile": "clawbrowser", "DasBrowser profile": "dasbrowser", "Camoufox profile": "camoufox" },
    }];
    state.selectedProfile = undefined;
    state.statuses = {};
  });

  it("selects the profile the user picks without starting it", () => {
    expect(find("Start profile")?.disabled).toBe(true);

    pressProfile("DasBrowser profile");

    expect(state.selectProfile).toHaveBeenCalledExactlyOnceWith("DasBrowser profile");
    expect(state.suspendOnboardingForSetup).not.toHaveBeenCalled();
    expect(dispatched).not.toHaveBeenCalled();
  });

  it("starts the chosen profile from the step", () => {
    state.selectedProfile = "DasBrowser profile";

    press("Start profile");

    expect(state.suspendOnboardingForSetup).toHaveBeenCalledOnce();
    expect(state.setSidebarCollapsed).toHaveBeenCalledWith(false);
    expect(dispatched).toHaveBeenCalledExactlyOnceWith("nextbrowser:start-selected-profile");
  });

  it("keeps creating a profile as the secondary action", () => {
    state.selectedProfile = "DasBrowser profile";

    press("Create a profile");

    expect(state.suspendOnboardingForSetup).toHaveBeenCalledOnce();
    expect(dispatched).toHaveBeenCalledExactlyOnceWith("nextbrowser:open-profile-creator");
  });
});

describe("profile step on a computer without the workspace's profiles", () => {
  beforeEach(() => {
    state.onboardingStepIndex = 2;
    // The workspace synced from another computer, where its profile lives.
    state.profiles = [];
    state.workspaces = [{ id: "workspace", profileNames: ["work"] }];
    state.selectedProfile = undefined;
    state.statuses = {};
  });

  it("creates the default profiles here only when asked", () => {
    expect(state.createDefaultProfiles).not.toHaveBeenCalled();

    press("Create default profiles");

    expect(state.createDefaultProfiles).toHaveBeenCalledOnce();
    expect(state.suspendOnboardingForSetup).not.toHaveBeenCalled();
  });

  it("still offers to create a profile by hand", () => {
    press("Create a profile");

    expect(state.suspendOnboardingForSetup).toHaveBeenCalledOnce();
    expect(dispatched).toHaveBeenCalledExactlyOnceWith("nextbrowser:open-profile-creator");
  });
});

describe("onboarding funnel events", () => {
  const events = () => vi.mocked(trackEvent).mock.calls.map(([name, params]) => [name, params]);

  it("completes the step the user continues from and says whether it is done", () => {
    state.onboardingStepIndex = 2;
    state.statuses = { work: "running" };

    press("Continue");

    expect(state.setOnboardingStepIndex).toHaveBeenCalledExactlyOnceWith(3);
    expect(events()).toEqual([
      ["onboarding_step_completed", expect.objectContaining({ step: "profile", step_number: 3, via: "continue", ready: true })],
    ]);
  });

  it("marks a step the user passes without doing it as not ready", () => {
    state.onboardingStepIndex = 2;

    press("Continue");

    expect(events()).toEqual([
      ["onboarding_step_completed", expect.objectContaining({ step: "profile", ready: false })],
    ]);
  });

  it("completes nothing when the user goes back", () => {
    state.onboardingStepIndex = 2;

    press("Back");

    expect(state.setOnboardingStepIndex).toHaveBeenCalledExactlyOnceWith(1);
    expect(events()).toEqual([]);
  });

  it("completes the Live step before closing the tour into Live", () => {
    state.statuses = { work: "running" };

    press("Open Live");

    expect(events()).toEqual([
      ["onboarding_step_completed", expect.objectContaining({ step: "control", via: "open_live", ready: true })],
      ["onboarding_closed", expect.objectContaining({ reason: "completed", last_step: "control", agent_ready: true, profile_count: 1 })],
    ]);
    expect(state.setTab).toHaveBeenCalledWith("live");
    expect(state.finishOnboarding).toHaveBeenCalledOnce();
  });

  it("closes as skipped without completing the step on screen", () => {
    state.onboardingStepIndex = 1;

    press("Skip tutorial");

    expect(events()).toEqual([
      ["onboarding_closed", expect.objectContaining({ reason: "skipped", last_step: "agent" })],
    ]);
    expect(state.finishOnboarding).toHaveBeenCalledOnce();
  });
});
