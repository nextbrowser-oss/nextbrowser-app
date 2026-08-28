import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => {
  const runtime = {
    claude: {
      ready: true,
      authorizing: false,
      version: "2.1.86" as string | undefined,
      loggedIn: true as boolean | undefined,
      error: undefined as string | undefined,
    },
  };
  const state = {
    finishOnboarding: () => undefined,
    authorizeAgent: async () => undefined,
    loginAgent: async () => undefined,
    setTab: () => undefined,
    setTerminalChat: () => undefined,
    setSidebarCollapsed: () => undefined,
    agentId: "claude",
    switchAgent: () => undefined,
    agentReady: () => runtime.claude.ready && runtime.claude.loggedIn !== false,
    agentVersion: () => runtime.claude.version,
    agentLoggedIn: () => runtime.claude.loggedIn,
    agentError: () => runtime.claude.error,
    runtime,
    authed: true,
    profiles: [] as Array<{ name: string }>,
    workspaces: [] as Array<{ id: string; profileNames: string[] }>,
    activeWorkspaceId: undefined as string | undefined,
    statuses: {} as Record<string, string>,
    defaultSession: undefined,
    selectedProfile: undefined as string | undefined,
    setDashboardKeyPromptOpen: () => undefined,
    onboardingStepIndex: 1,
    setOnboardingStepIndex: () => undefined,
    suspendOnboardingForSetup: () => undefined,
  };
  return { state };
});

vi.mock("../store", () => ({
  useStore: (selector: (value: typeof state) => unknown) => selector(state),
}));

import { OnboardingView } from "./OnboardingView";

describe("agent onboarding step", () => {
  beforeEach(() => {
    state.onboardingStepIndex = 1;
    state.runtime.claude.ready = true;
    state.runtime.claude.version = "2.1.86";
    state.runtime.claude.loggedIn = true;
    state.runtime.claude.error = undefined;
    state.profiles = [];
    state.selectedProfile = undefined;
    state.statuses = {};
  });

  it("shows a compact connected state without setup copy or permanent links", () => {
    const html = renderToStaticMarkup(<OnboardingView />);

    expect(html).toContain(">Setup agent</h2>");
    expect(html).toContain("onboarding-agent-connected");
    expect(html).toContain("Connected");
    expect(html).not.toContain("Claude Code uses its CLI");
    expect(html).not.toContain("Claude Code setup guide");
    expect(html).not.toContain("Download ChatGPT desktop app");
    expect(html).not.toContain('href="https://code.claude.com');
    expect(html).not.toContain('href="https://chatgpt.com/download');
  });

  it("shows the selected agent install link only after a missing-agent error", () => {
    state.runtime.claude.ready = false;
    state.runtime.claude.version = undefined;
    state.runtime.claude.loggedIn = undefined;
    state.runtime.claude.error = "Claude Code CLI not found";

    const html = renderToStaticMarkup(<OnboardingView />);

    expect(html).toContain('href="https://code.claude.com/docs/en/installation"');
    expect(html).toContain("Install Claude Code CLI");
  });

  it("keeps profile setup to one real status and one action", () => {
    state.onboardingStepIndex = 2;

    const html = renderToStaticMarkup(<OnboardingView />);

    expect(html).toContain(">Setup profile</h2>");
    expect(html).toContain("Choose the profile the agent should use, then start it.");
    expect(html).toContain("Create a profile");
    expect(html).toContain("No saved profiles");
    expect(html).toContain("Set up profile");
    expect(html).not.toContain("Illustrative examples");
    expect(html).not.toContain("shop-us");
    expect(html).not.toContain("Profile setup sequence");
    expect(html).not.toContain("Verify identity when country");
  });

  it("keeps the first task compact and offers a cancellable Chat handoff", () => {
    state.onboardingStepIndex = 3;

    const html = renderToStaticMarkup(<OnboardingView />);

    expect(html).toContain(">Try your first task</h2>");
    expect(html).not.toContain("onboarding-eyebrow");
    expect(html).toContain("Tell the agent what to do and what result you want.");
    expect(html).toContain("Open example.com in the selected profile");
    expect(html).toContain("Try in Chat");
    expect(html).not.toContain("What should happen?");
    expect(html).not.toContain("Copy prompt");
    expect(html).not.toContain("Prompt limits are instructions");
  });

  it("explains Live Streaming without unrelated Chat or Sidebar detail", () => {
    state.onboardingStepIndex = 4;

    const html = renderToStaticMarkup(<OnboardingView />);

    expect(html).toContain("Live Streaming");
    expect(html).toContain(">Watch the browser live</h2>");
    expect(html).not.toContain("onboarding-eyebrow");
    expect(html).toContain("When you ask the agent to use the browser, Live Streaming starts automatically.");
    expect(html).toContain("Follow the run");
    expect(html).toContain("Switch tabs");
    expect(html).toContain("Take control");
    expect(html).toContain("Start a profile to use Live Streaming");
    expect(html).toContain("Set up profile");
    expect(html).not.toContain("Read streamed output");
    expect(html).not.toContain(">Sidebar<");
    expect(html).not.toContain("Finish setup before a browser task");
  });

  it("offers Live as the final action when the selected profile is running", () => {
    state.onboardingStepIndex = 4;
    state.profiles = [{ name: "work" }];
    state.selectedProfile = "work";
    state.statuses.work = "running";

    const html = renderToStaticMarkup(<OnboardingView />);

    expect(html).toContain("Live Streaming is ready");
    expect(html).toContain("Open Live");
    expect(html.match(/Open Live/g)).toHaveLength(1);
  });

  it("offers to start an existing profile before opening Live", () => {
    state.onboardingStepIndex = 4;
    state.profiles = [{ name: "work" }];
    state.selectedProfile = "work";
    state.statuses.work = "stopped";

    const html = renderToStaticMarkup(<OnboardingView />);

    expect(html).toContain("Start profile");
    expect(html).not.toContain("Set up profile");
  });
});
