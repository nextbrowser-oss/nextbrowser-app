import { useCallback, useEffect, useRef, useState } from "react";
import { agentById, PRIMARY_AGENTS } from "../agents";
import { trackEvent } from "../lib/analytics";
import {
  FIRST_TASK_EXAMPLE,
  ONBOARDING_STEPS,
  onboardingProfileChoices,
  onboardingProfileSummary,
} from "../lib/onboarding";
import { onboardingFunnel, onboardingTrigger, type OnboardingStepExit } from "../lib/onboardingFunnel";
import { openGuideChatDraft } from "../lib/guideDraft";
import { guideWorkspaceProfileNames } from "../lib/guideQuickStart";
import { workspaceHasNoLocalProfiles } from "../lib/workspaceProfiles";
import { useStore } from "../store";
import type { AppTab } from "../types";
import { AgentInstallLink } from "./AgentInstallLink";
import { BrandLogo } from "./BrandLogo";
import { GuideActionModal } from "./GuideActionModal";
import { Icon, Spinner } from "./Icon";
import { UserFacingError } from "./UserFacingError";

export function OnboardingView() {
  const finish = useStore((s) => s.finishOnboarding);
  const authorize = useStore((s) => s.authorizeAgent);
  const loginAgent = useStore((s) => s.loginAgent);
  const setTab = useStore((s) => s.setTab);
  const setTerminalChat = useStore((s) => s.setTerminalChat);
  const setSidebarCollapsed = useStore((s) => s.setSidebarCollapsed);
  const agentId = useStore((s) => s.agentId);
  const switchAgent = useStore((s) => s.switchAgent);
  const ready = useStore((s) => s.agentReady());
  const agentVersion = useStore((s) => s.agentVersion());
  const agentLoggedIn = useStore((s) => s.agentLoggedIn());
  const agentError = useStore((s) => s.agentError());
  const authorizing = useStore((s) => s.runtime[s.agentId]?.authorizing ?? false);
  const authed = useStore((s) => s.authed);
  const profiles = useStore((s) => s.profiles);
  const workspaces = useStore((s) => s.workspaces);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const statuses = useStore((s) => s.statuses);
  const selectedProfile = useStore((s) => s.selectedProfile);
  const selectProfile = useStore((s) => s.selectProfile);
  const workspaceProfileNames = guideWorkspaceProfileNames(activeWorkspaceId, workspaces, profiles);
  const profileChoices = onboardingProfileChoices(
    workspaceProfileNames,
    profiles,
    workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.profileToolsets ?? {},
    statuses,
  );
  const profileCount = workspaceProfileNames.length;
  const noLocalProfiles = useStore(workspaceHasNoLocalProfiles);
  const creatingDefaultProfiles = useStore((s) => s.defaultProfilesCreating);
  const defaultProfilesError = useStore((s) => s.defaultProfilesError);
  const createDefaultProfiles = useStore((s) => s.createDefaultProfiles);
  const runningProfileCount = workspaceProfileNames.filter((name) => statuses[name] === "running").length;
  const selectedWorkspaceProfile = selectedProfile && workspaceProfileNames.includes(selectedProfile)
    ? selectedProfile
    : workspaceProfileNames.length === 1 ? workspaceProfileNames[0] : undefined;
  const selectedSessionRunning = !!selectedWorkspaceProfile && statuses[selectedWorkspaceProfile] === "running";
  const selectedSessionStarting = !!selectedWorkspaceProfile && statuses[selectedWorkspaceProfile] === "starting";
  const setDashboardKeyPromptOpen = useStore((s) => s.setDashboardKeyPromptOpen);
  const stepIndex = useStore((s) => s.onboardingStepIndex);
  const setStepIndex = useStore((s) => s.setOnboardingStepIndex);
  const suspendForSetup = useStore((s) => s.suspendOnboardingForSetup);
  const setupError = useStore((s) => s.onboardingSetupError);
  const [tryChatConfirmOpen, setTryChatConfirmOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const current = ONBOARDING_STEPS[stepIndex];
  const agent = agentById(agentId);
  const agentDetected = !!agentVersion;
  const agentNeedsLogin = agentDetected && agentLoggedIn === false;
  const isLastStep = stepIndex === ONBOARDING_STEPS.length - 1;

  useEffect(() => {
    headingRef.current?.focus();
    setTryChatConfirmOpen(false);
    onboardingFunnel.viewStep(current.id, onboardingTrigger(localStorage));
  }, [current.id, stepIndex]);

  // A step counts as completed when the user leaves it forward. The event says
  // whether the step's own criterion held at that moment.
  const completeCurrentStep = (via: OnboardingStepExit) => {
    onboardingFunnel.completeStep(current.id, via, {
      accountConnected: authed,
      agentReady: ready,
      profileRunning: selectedSessionRunning,
    });
  };

  const goToStep = (index: number, via: OnboardingStepExit = "rail") => {
    if (index > stepIndex) completeCurrentStep(via);
    setStepIndex(Math.max(0, Math.min(ONBOARDING_STEPS.length - 1, index)));
  };

  const closeTutorial = useCallback((reason: "skipped" | "completed", destination?: AppTab) => {
    onboardingFunnel.close(reason, {
      lastStep: current.id,
      agentReady: ready,
      profileCount,
    });
    if (destination) setTab(destination);
    if (destination === "guide") setSidebarCollapsed(false);
    finish();
  }, [current.id, finish, profileCount, ready, setSidebarCollapsed, setTab]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    return () => previousFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (tryChatConfirmOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setTryChatConfirmOpen(false);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeTutorial("skipped");
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ) ?? []).filter((element) => element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        headingRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeTutorial, tryChatConfirmOpen]);

  const connectAgent = () => {
    trackEvent("onboarding_agent_action", {
      agent: agentId,
      action: agentNeedsLogin ? "login" : "connect",
    });
    if (agentNeedsLogin) void loginAgent();
    else void authorize();
  };

  const openAccountSetup = () => {
    trackEvent("onboarding_setup_opened", { setup: "account" });
    suspendForSetup();
    setDashboardKeyPromptOpen(true);
  };

  const openProfileSetup = () => {
    trackEvent("onboarding_setup_opened", { setup: "profile" });
    suspendForSetup();
    setTab("guide");
    setSidebarCollapsed(false);
    window.dispatchEvent(new CustomEvent("nextbrowser:open-profile-creator"));
  };

  const startSelectedProfile = () => {
    // The download prompt and start errors open under the tour, so step aside
    // like the profile creator does. The sidebar brings the tour back once the
    // start settles or the download is cancelled.
    suspendForSetup();
    setSidebarCollapsed(false);
    window.requestAnimationFrame(() => window.dispatchEvent(
      new CustomEvent("nextbrowser:start-selected-profile"),
    ));
  };

  const createDefaultProfilesHere = () => {
    trackEvent("onboarding_profile_action", { action: "create_defaults" });
    void createDefaultProfiles();
  };

  const chooseProfile = (name: string) => {
    trackEvent("onboarding_profile_action", { action: "select" });
    selectProfile(name);
  };

  const startChosenProfile = () => {
    trackEvent("onboarding_profile_action", { action: "start" });
    startSelectedProfile();
  };

  const startProfileForLive = () => {
    trackEvent("onboarding_live_profile_action", {
      action: profileCount > 0 ? "start" : "setup",
    });
    if (profileCount === 0) {
      openProfileSetup();
      return;
    }
    startSelectedProfile();
  };

  const openTryChatConfirmation = () => {
    trackEvent("onboarding_try_chat_requested");
    setTryChatConfirmOpen(true);
  };

  const confirmTryChat = () => {
    const prompt = openGuideChatDraft(localStorage, FIRST_TASK_EXAMPLE, {
      setTerminalChat,
      setTab,
      dispatch: (value) => window.dispatchEvent(
        new CustomEvent("nextbrowser:guide-draft", { detail: value }),
      ),
    });
    if (!prompt) return;
    trackEvent("onboarding_try_chat_confirmed");
    setTryChatConfirmOpen(false);
    completeCurrentStep("try_chat");
    closeTutorial("completed");
  };

  return (
    <div className="onboarding-overlay">
      <div
        ref={dialogRef}
        className="onboarding-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby={current.description ? "onboarding-description" : undefined}
      >
        <aside className="onboarding-rail">
          <div className="onboarding-brand">
            <BrandLogo size={38} />
            <div>
              <strong>Getting started</strong>
              <span>About 2 minutes</span>
            </div>
          </div>
          <nav className="onboarding-step-list" aria-label="Tutorial steps">
            {ONBOARDING_STEPS.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={
                  "onboarding-step-nav"
                  + (index === stepIndex ? " is-active" : "")
                  + (index < stepIndex ? " is-past" : "")
                }
                onClick={() => goToStep(index)}
                aria-current={index === stepIndex ? "step" : undefined}
              >
                <span className="onboarding-step-number">
                  {index < stepIndex ? <Icon name="checkmark" size={11} strokeWidth={2.6} /> : index + 1}
                </span>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="onboarding-rail-note">
            <Icon name="book.fill" size={14} />
            <span>You can replay this tutorial anytime from Guide.</span>
          </div>
        </aside>

        <section className="onboarding-main">
          <header className="onboarding-top">
            <div className="onboarding-mobile-progress">
              Step {stepIndex + 1} of {ONBOARDING_STEPS.length}
            </div>
            <span className="spacer" />
            <button
              type="button"
              className="onboarding-skip"
              onClick={() => closeTutorial("skipped")}
            >
              Skip tutorial
            </button>
          </header>

          <div className="onboarding-scroll">
            <div className="onboarding-copy">
              <span
                className="onboarding-icon-wrap"
                style={{ background: current.tint + "1f", color: current.tint }}
              >
                <Icon name={current.icon} size={24} strokeWidth={2.2} />
              </span>
              <div>
                <h2 id="onboarding-title" ref={headingRef} tabIndex={-1}>{current.title}</h2>
                {current.description && (
                  <p id="onboarding-description" className="muted">{current.description}</p>
                )}
              </div>
            </div>

            {current.id === "workspace" && (
              <div className="onboarding-step-content">
                <div className="onboarding-flow" aria-label="How a Nextbrowser task works">
                  {[
                    { icon: "person.crop.circle", title: "You", text: "Set the goal" },
                    { icon: "cpu.fill", title: "Agent", text: "Does the work" },
                    { icon: "person.2.fill", title: "Profile", text: "Provides browser context" },
                    { icon: "video.fill", title: "Live", text: "Shows the real page" },
                  ].map((item, index) => (
                    <div className="onboarding-flow-stage" key={item.title}>
                      <div className="onboarding-flow-card">
                        <Icon name={item.icon} size={19} />
                        <strong>{item.title}</strong>
                        <span>{item.text}</span>
                      </div>
                      {index < 3 && <Icon name="chevron.right" size={15} className="onboarding-flow-arrow" />}
                    </div>
                  ))}
                </div>
                <div className={"onboarding-account-status" + (authed ? " is-ready" : "")}>
                  <Icon name={authed ? "checkmark.circle.fill" : "info.circle"} size={16} />
                  <span>
                    <strong>{authed ? "Browser account connected" : "Browser account not connected yet"}</strong>
                    <span>{authed ? "Managed profiles and proxy controls are available." : "Connect in your browser to use managed profiles and proxy controls."}</span>
                  </span>
                  {!authed && (
                    <button type="button" className="mini" onClick={openAccountSetup}>
                      Connect account
                    </button>
                  )}
                </div>
              </div>
            )}

            {current.id === "agent" && (
              <div className="onboarding-step-content">
                <div className="onboarding-agent-options">
                  {PRIMARY_AGENTS.map((item) => {
                    const selected = item.id === agentId;
                    return (
                      <div className={"onboarding-agent-option" + (selected ? " is-selected" : "") + (selected && ready ? " is-connected" : "")} key={item.id}>
                        <button
                          type="button"
                          className="onboarding-agent-select"
                          onClick={() => switchAgent(item.id)}
                          aria-pressed={selected}
                        >
                          <span className="onboarding-agent-option-head">
                            <span className="onboarding-agent-icon"><Icon name="cpu.fill" size={18} /></span>
                            <strong>{item.name}</strong>
                            {selected && ready && <Icon name="checkmark.circle.fill" size={17} className="ok" />}
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>

                {!ready && <div className="onboarding-agent-connect">
                  <button type="button" className="btn-bordered-prominent" disabled={authorizing} onClick={connectAgent}>
                    {authorizing && <Spinner size={13} />}
                    {authorizing ? "Checking…" : agentNeedsLogin ? `Sign in to ${agent.name}` : `Connect ${agent.name}`}
                  </button>
                </div>}
                {agentError && (
                  <div className="onboarding-agent-error error small">
                    <UserFacingError message={agentError} surface="onboarding" />
                    <AgentInstallLink agent={agent} error={agentError} surface="onboarding" />
                  </div>
                )}
              </div>
            )}

            {current.id === "profile" && (
              <div className="onboarding-step-content">
                <div className={"onboarding-profile-status" + (selectedSessionRunning ? " is-ready" : "")}>
                  <Icon
                    name={selectedSessionRunning ? "checkmark.circle.fill" : "person.2.fill"}
                    size={18}
                  />
                  <span>
                    <strong>
                      {selectedSessionRunning
                        ? "Profile ready"
                        : noLocalProfiles
                          ? "No profiles on this computer"
                          : profileCount === 0
                            ? "Create a profile"
                            : selectedWorkspaceProfile
                              ? "Start a profile"
                              : "Choose a profile"}
                    </strong>
                    <span>
                      {noLocalProfiles
                        ? "Profiles stay on the computer where they were created."
                        : onboardingProfileSummary(profileCount, runningProfileCount)}
                    </span>
                  </span>
                  {noLocalProfiles ? (
                    <button
                      type="button"
                      className="btn-bordered-prominent"
                      disabled={creatingDefaultProfiles}
                      onClick={createDefaultProfilesHere}
                    >
                      {creatingDefaultProfiles && <Spinner size={13} />}
                      {creatingDefaultProfiles ? "Creating…" : "Create default profiles"}
                    </button>
                  ) : profileCount === 0 ? (
                    <button type="button" className="btn-bordered" onClick={openProfileSetup}>
                      Set up profile
                      <Icon name="chevron.right" size={13} />
                    </button>
                  ) : !selectedSessionRunning && (
                    <button
                      type="button"
                      className="btn-bordered-prominent"
                      disabled={!selectedWorkspaceProfile || selectedSessionStarting}
                      onClick={startChosenProfile}
                    >
                      {selectedSessionStarting && <Spinner size={13} />}
                      {selectedSessionStarting ? "Starting…" : "Start profile"}
                      {!selectedSessionStarting && <Icon name="chevron.right" size={13} />}
                    </button>
                  )}
                </div>
                {profileCount > 0 && (
                  <div className="onboarding-profile-options" role="group" aria-label="Workspace profiles">
                    {profileChoices.map((choice) => {
                      const chosen = choice.name === selectedWorkspaceProfile;
                      return (
                        <button
                          key={choice.name}
                          type="button"
                          className={"onboarding-profile-option" + (chosen ? " is-selected" : "")}
                          aria-pressed={chosen}
                          onClick={() => chooseProfile(choice.name)}
                        >
                          <span className={"dot " + (choice.state === "running" ? "green" : choice.state === "starting" ? "orange" : "gray")} />
                          <span>
                            <strong>{choice.label}</strong>
                            <span>{choice.detail}</span>
                          </span>
                          {chosen && <Icon name="checkmark.circle.fill" size={16} className="ok" />}
                        </button>
                      );
                    })}
                  </div>
                )}
                {setupError && (
                  <div className="onboarding-setup-error error small" role="alert">
                    <UserFacingError message={setupError} surface="onboarding" />
                  </div>
                )}
                {noLocalProfiles && defaultProfilesError && (
                  <div className="onboarding-setup-error error small" role="alert">
                    <UserFacingError message={defaultProfilesError} surface="onboarding" />
                  </div>
                )}
                {(profileCount > 0 || noLocalProfiles) && (
                  <button type="button" className="btn-bordered onboarding-profile-create" onClick={openProfileSetup}>
                    <Icon name="plus" size={13} />
                    Create a profile
                  </button>
                )}
                <p className="muted small">Saved profiles are browser settings. A browser toolset downloads separately when you first start it.</p>
              </div>
            )}

            {current.id === "prompt" && (
              <div className="onboarding-step-content">
                <div className="onboarding-prompt-example">
                  <div className="onboarding-example-heading">
                    <strong>Example task</strong>
                    <button type="button" className="btn-bordered-prominent" onClick={openTryChatConfirmation}>
                      Try in Chat
                      <Icon name="chevron.right" size={13} />
                    </button>
                  </div>
                  <p>{FIRST_TASK_EXAMPLE}</p>
                </div>
              </div>
            )}

            {current.id === "control" && (
              <div className="onboarding-step-content">
                <div className="onboarding-live-grid">
                  {[
                    {
                      icon: "play.circle",
                      title: "Follow the run",
                      text: "See each click, page change, and result.",
                    },
                    {
                      icon: "square.stack.3d.up.fill",
                      title: "Switch tabs",
                      text: "Move between the session’s open tabs.",
                    },
                    {
                      icon: "square.and.pencil",
                      title: "Take control",
                      text: "Click or type when the agent needs help.",
                    },
                  ].map((item) => (
                    <div className="onboarding-live-card" key={item.title}>
                      <Icon name={item.icon} size={19} />
                      <strong>{item.title}</strong>
                      <span>{item.text}</span>
                    </div>
                  ))}
                </div>
                <div className={"onboarding-live-status" + (selectedSessionRunning ? " is-ready" : "")}>
                  <Icon
                    name={selectedSessionRunning ? "checkmark.circle.fill" : "info.circle"}
                    size={16}
                  />
                  <strong>
                    {selectedSessionRunning
                      ? "Live Streaming is ready"
                      : "Start a profile to use Live Streaming"}
                  </strong>
                  {selectedSessionRunning ? (
                    <button
                      type="button"
                      className="btn-bordered-prominent"
                      onClick={() => { completeCurrentStep("open_live"); closeTutorial("completed", "live"); }}
                    >
                      Open Live
                      <Icon name="chevron.right" size={13} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-bordered"
                      disabled={selectedSessionStarting}
                      onClick={startProfileForLive}
                    >
                      {selectedSessionStarting && <Spinner size={13} />}
                      {profileCount === 0
                        ? "Set up profile"
                        : selectedSessionStarting
                          ? "Starting…"
                          : "Start profile"}
                      {!selectedSessionStarting && <Icon name="chevron.right" size={13} />}
                    </button>
                  )}
                </div>
                {setupError && (
                  <div className="onboarding-setup-error error small" role="alert">
                    <UserFacingError message={setupError} surface="onboarding" />
                  </div>
                )}
              </div>
            )}
          </div>

          <footer className="onboarding-footer">
            <span className="onboarding-footer-progress">
              {stepIndex + 1} / {ONBOARDING_STEPS.length}
            </span>
            {stepIndex > 0 && (
              <button type="button" className="btn-bordered" onClick={() => goToStep(stepIndex - 1)}>
                <Icon name="chevron.left" size={13} />
                Back
              </button>
            )}
            <span className="spacer" />
            {isLastStep ? (
              <button type="button" className="btn-bordered-prominent" onClick={() => { completeCurrentStep("finish"); closeTutorial("completed", "guide"); }}>
                Continue in Guide
                <Icon name="chevron.right" size={13} />
              </button>
            ) : (
              <button type="button" className="btn-bordered-prominent" onClick={() => goToStep(stepIndex + 1, "continue")}>
                Continue
                <Icon name="chevron.right" size={13} />
              </button>
            )}
          </footer>
        </section>
      </div>
      {tryChatConfirmOpen && (
        <GuideActionModal
          confirmation={{
            title: "Try this task in Chat?",
            confirmLabel: "Try in Chat",
            icon: "bubble.left.and.bubble.right.fill",
            tint: "#ff9500",
          }}
          onCancel={() => setTryChatConfirmOpen(false)}
          onConfirm={confirmTryChat}
        />
      )}
    </div>
  );
}
