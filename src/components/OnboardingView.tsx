import { useCallback, useEffect, useRef, useState } from "react";
import { agentById, agentInstallName, PRIMARY_AGENTS } from "../agents";
import { trackEvent } from "../lib/analytics";
import {
  canOpenOnboardingChat,
  FIRST_TASK_EXAMPLE,
  ONBOARDING_AGENT_SETUP,
  ONBOARDING_STEPS,
  onboardingProfileSummary,
} from "../lib/onboarding";
import { useStore } from "../store";
import type { AppTab } from "../types";
import { AgentInstallLink } from "./AgentInstallLink";
import { BrandLogo } from "./BrandLogo";
import { Icon, Spinner } from "./Icon";
import { UserFacingError } from "./UserFacingError";

type CopyState = "idle" | "copied" | "failed";

export function OnboardingView() {
  const finish = useStore((s) => s.finishOnboarding);
  const authorize = useStore((s) => s.authorizeAgent);
  const loginAgent = useStore((s) => s.loginAgent);
  const setTab = useStore((s) => s.setTab);
  const setSidebarCollapsed = useStore((s) => s.setSidebarCollapsed);
  const agentId = useStore((s) => s.agentId);
  const switchAgent = useStore((s) => s.switchAgent);
  const ready = useStore((s) => s.agentReady());
  const agentVersion = useStore((s) => s.agentVersion());
  const agentLoggedIn = useStore((s) => s.agentLoggedIn());
  const agentError = useStore((s) => s.agentError());
  const authorizing = useStore((s) => s.runtime[s.agentId]?.authorizing ?? false);
  const authed = useStore((s) => s.authed);
  const profileCount = useStore((s) => {
    const defaultKnown = !!s.defaultSession?.session?.name
      || (s.defaultSession?.status ?? "unknown") !== "unknown";
    const listedDefault = s.profiles.some((profile) => profile.name === "default");
    return s.profiles.length + (defaultKnown && !listedDefault ? 1 : 0);
  });
  const runningProfileCount = useStore((s) => {
    const listedDefault = s.profiles.some((profile) => profile.name === "default");
    const listedRunning = s.profiles.filter(
      (profile) => s.statuses[profile.name] === "running",
    ).length;
    return listedRunning
      + (!listedDefault && s.defaultSession?.status === "running" ? 1 : 0);
  });
  const selectedProfile = useStore((s) => s.selectedProfile);
  const selectedSessionRunning = useStore((s) =>
    s.selectedProfile
      ? s.statuses[s.selectedProfile] === "running"
      : s.defaultSession?.status === "running"
  );
  const setDashboardKeyPromptOpen = useStore((s) => s.setDashboardKeyPromptOpen);
  const stepIndex = useStore((s) => s.onboardingStepIndex);
  const setStepIndex = useStore((s) => s.setOnboardingStepIndex);
  const suspendForSetup = useStore((s) => s.suspendOnboardingForSetup);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const current = ONBOARDING_STEPS[stepIndex];
  const agent = agentById(agentId);
  const agentDetected = !!agentVersion;
  const agentNeedsLogin = agentDetected && agentLoggedIn === false;
  const isLastStep = stepIndex === ONBOARDING_STEPS.length - 1;
  const canOpenChat = canOpenOnboardingChat(ready, selectedSessionRunning);

  useEffect(() => {
    headingRef.current?.focus();
    setCopyState("idle");
    trackEvent("onboarding_step_viewed", {
      step: current.id,
      step_number: stepIndex + 1,
    });
  }, [current.id, stepIndex]);

  const goToStep = (index: number) => {
    setStepIndex(Math.max(0, Math.min(ONBOARDING_STEPS.length - 1, index)));
  };

  const closeTutorial = useCallback((reason: "skipped" | "completed", destination?: AppTab) => {
    trackEvent("onboarding_closed", {
      reason,
      last_step: current.id,
      agent_ready: ready,
      profile_count: profileCount,
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
  }, [closeTutorial]);

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
    setTab("guide");
    setSidebarCollapsed(false);
    suspendForSetup();
    window.dispatchEvent(new CustomEvent("nextbrowser:open-profile-creator"));
  };

  const copyExample = async () => {
    try {
      await navigator.clipboard.writeText(FIRST_TASK_EXAMPLE);
      setCopyState("copied");
      trackEvent("onboarding_example_copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div className="onboarding-overlay">
      <div
        ref={dialogRef}
        className="onboarding-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-description"
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
                <span className="onboarding-eyebrow">{current.label}</span>
                <h2 id="onboarding-title" ref={headingRef} tabIndex={-1}>{current.title}</h2>
                <p id="onboarding-description" className="muted">{current.description}</p>
              </div>
            </div>

            {current.id === "workspace" && (
              <div className="onboarding-step-content">
                <div className="onboarding-flow" aria-label="How a NextBrowser task works">
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
                <div className="onboarding-human-example">
                  <span className="onboarding-example-label">In plain English</span>
                  <p>
                    “Open a product page, collect the first 10 prices, and return a table — but do not buy or submit anything.”
                  </p>
                  <span className="muted small">
                    NextBrowser tells the agent which profile you selected. Check Sidebar or Live to confirm the correct session is running.
                  </span>
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
                    const setup = ONBOARDING_AGENT_SETUP[item.id as keyof typeof ONBOARDING_AGENT_SETUP];
                    const selected = item.id === agentId;
                    return (
                      <div className={"onboarding-agent-option" + (selected ? " is-selected" : "")} key={item.id}>
                        <button
                          type="button"
                          className="onboarding-agent-select"
                          onClick={() => switchAgent(item.id)}
                          aria-pressed={selected}
                        >
                          <span className="onboarding-agent-option-head">
                            <span className="onboarding-agent-icon"><Icon name="cpu.fill" size={18} /></span>
                            <strong>{item.name}</strong>
                            {selected && <Icon name="checkmark.circle.fill" size={17} className="ok" />}
                          </span>
                          <span className="onboarding-agent-kind">{setup.badge}</span>
                          <span className="muted small">{setup.requirement}</span>
                        </button>
                        {item.installUrl && (
                          <a href={item.installUrl} target="_blank" rel="noreferrer">
                            {setup.linkLabel}
                            <Icon name="arrow.up.forward.app" size={12} />
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="onboarding-agent-connect">
                  <div>
                    <span className="onboarding-example-label">Selected agent</span>
                    <strong>{agent.name}</strong>
                    <span className="muted small">
                      {ready
                        ? `${agentVersion || agent.name} is ready for tasks.`
                        : agentNeedsLogin
                          ? `${agent.name} is installed but needs sign-in.`
                          : `NextBrowser will look for ${
                            agent.id === "codex"
                              ? "Codex in the ChatGPT desktop app"
                              : agentInstallName(agent)
                          } on this computer.`}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={ready ? "btn-bordered" : "btn-bordered-prominent"}
                    disabled={ready || authorizing}
                    onClick={connectAgent}
                  >
                    {authorizing && <Spinner size={13} />}
                    {ready
                      ? "Connected"
                      : authorizing
                        ? "Checking…"
                        : agentNeedsLogin
                          ? `Sign in to ${agent.name}`
                          : `Connect ${agent.name}`}
                  </button>
                </div>
                {agentError && (
                  <div className="onboarding-agent-error error small">
                    <UserFacingError message={agentError} surface="onboarding" />
                    <AgentInstallLink agent={agent} error={agentError} surface="onboarding" />
                  </div>
                )}
                <p className="onboarding-fine-print">
                  Claude Code uses its CLI, not the Claude desktop app. Codex uses the executable bundled with the ChatGPT desktop app. Authentication stays with that agent.
                </p>
              </div>
            )}

            {current.id === "profile" && (
              <div className="onboarding-step-content">
                <div className="onboarding-concept-grid">
                  <div className="onboarding-concept-card">
                    <span className="onboarding-concept-icon"><Icon name="person.2.fill" size={18} /></span>
                    <div>
                      <strong>Profile = saved browser context</strong>
                      <span>It can keep cookies, logins, proxy settings, and browser state together.</span>
                    </div>
                  </div>
                  <div className="onboarding-concept-card">
                    <span className="onboarding-concept-icon"><Icon name="play.circle" size={18} /></span>
                    <div>
                      <strong>Session = running browser</strong>
                      <span>Start the profile’s session when you want the agent to use its pages.</span>
                    </div>
                  </div>
                </div>

                <div className="onboarding-profile-example">
                  <div className="onboarding-example-heading">
                    <div>
                      <span className="onboarding-example-label">Illustrative examples</span>
                      <strong>Use separate profiles when contexts must not mix</strong>
                    </div>
                    <span className={"onboarding-status-pill" + (runningProfileCount > 0 ? " is-ready" : "")}>
                      {onboardingProfileSummary(profileCount, runningProfileCount)}
                    </span>
                  </div>
                  <div className="onboarding-profile-rows" aria-label="Illustrative browser profile examples">
                    <div>
                      <span className="onboarding-profile-avatar">S</span>
                      <span><strong>shop-us</strong><small>Shopping research · United States</small></span>
                      <span className="onboarding-profile-state">● Running</span>
                    </div>
                    <div>
                      <span className="onboarding-profile-avatar alternate">C</span>
                      <span><strong>client-research</strong><small>Separate customer login · Germany</small></span>
                      <span className="muted small">Stopped</span>
                    </div>
                  </div>
                </div>

                <div className="onboarding-sequence" aria-label="Profile setup sequence">
                  {["Choose", "Start", "Open page", "Verify*"].map((label, index) => (
                    <div key={label}>
                      <span>{index + 1}</span>
                      <strong>{label}</strong>
                      {index < 3 && <Icon name="chevron.right" size={13} />}
                    </div>
                  ))}
                </div>
                <p className="onboarding-fine-print">
                  Create or select a profile first. Verify identity when country or proxy matters, especially after rotation.
                </p>
                <button type="button" className="btn-bordered" onClick={openProfileSetup}>
                  Set up a profile
                  <Icon name="chevron.right" size={13} />
                </button>
              </div>
            )}

            {current.id === "prompt" && (
              <div className="onboarding-step-content">
                <div className="onboarding-prompt-formula">
                  {[
                    ["Goal", "What should happen?"],
                    ["Context", "Which profile or page?"],
                    ["Limits", "What must not happen?"],
                    ["Result", "What should be returned?"],
                  ].map(([label, text]) => (
                    <div key={label}>
                      <strong>{label}</strong>
                      <span>{text}</span>
                    </div>
                  ))}
                </div>
                <div className="onboarding-prompt-example">
                  <div className="onboarding-example-heading">
                    <div>
                      <span className="onboarding-example-label">Safe first task</span>
                      <strong>A complete prompt you can reuse</strong>
                    </div>
                    <button type="button" className="mini" onClick={() => void copyExample()}>
                      <Icon name={copyState === "copied" ? "checkmark" : "doc.on.doc"} size={12} />
                      {copyState === "copied" ? "Copied" : copyState === "failed" ? "Select and copy" : "Copy prompt"}
                    </button>
                  </div>
                  <p>{FIRST_TASK_EXAMPLE}</p>
                </div>
                <div className="onboarding-tip">
                  <Icon name="info.circle" size={16} />
                  <span>
                    <strong>Prompt limits are instructions, not an approval lock.</strong>
                    Watch the page and stop the run before purchases, publishing, account changes, deletion, or anything else consequential.
                  </span>
                </div>
              </div>
            )}

            {current.id === "control" && (
              <div className="onboarding-step-content">
                <div className="onboarding-control-grid">
                  {[
                    {
                      icon: "bubble.left.and.bubble.right.fill",
                      title: "Chat",
                      text: "Read streamed output, queue follow-ups, edit waiting work, or stop the active run.",
                    },
                    {
                      icon: "video.fill",
                      title: "Live",
                      text: "See the actual browser page and switch between the open tabs in its running session.",
                    },
                    {
                      icon: "person.crop.circle",
                      title: "Sidebar",
                      text: "Confirm which profile is selected, whether its session is running, and which agent is active.",
                    },
                  ].map((item) => (
                    <div className="onboarding-control-card" key={item.title}>
                      <Icon name={item.icon} size={19} />
                      <strong>{item.title}</strong>
                      <span>{item.text}</span>
                    </div>
                  ))}
                </div>
                <div className="onboarding-readiness">
                  <span className={authed ? "is-ready" : ""}>
                    <Icon name={authed ? "checkmark.circle.fill" : "info.circle"} size={15} />
                    Browser account
                  </span>
                  <span className={ready ? "is-ready" : ""}>
                    <Icon name={ready ? "checkmark.circle.fill" : "info.circle"} size={15} />
                    Local agent
                  </span>
                  <span className={selectedSessionRunning ? "is-ready" : ""}>
                    <Icon name={selectedSessionRunning ? "checkmark.circle.fill" : "info.circle"} size={15} />
                    {selectedProfile ? "Selected session" : "Default session"}
                  </span>
                </div>
                <div className={"onboarding-safety-callout" + (canOpenChat ? " is-ready" : "")}>
                  <Icon
                    name={canOpenChat ? "checkmark.shield.fill" : "exclamationmark.triangle.fill"}
                    size={20}
                  />
                  <span>
                    <strong>{canOpenChat ? "Ready for a first browser task." : "Finish setup before a browser task."}</strong>
                    {canOpenChat
                      ? "Check the actual page before accepting important changes. Captchas may still require manual takeover."
                      : "Guide shows where to connect the agent and start the intended profile session."}
                  </span>
                </div>
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
              canOpenChat ? (
                <>
                  <button type="button" className="btn-bordered" onClick={() => closeTutorial("completed", "guide")}>
                    Open Guide
                  </button>
                  <button type="button" className="btn-bordered-prominent" onClick={() => closeTutorial("completed", "chat")}>
                    Open Chat
                    <Icon name="chevron.right" size={13} />
                  </button>
                </>
              ) : (
                <button type="button" className="btn-bordered-prominent" onClick={() => closeTutorial("completed", "guide")}>
                  Continue in Guide
                  <Icon name="chevron.right" size={13} />
                </button>
              )
            ) : (
              <button type="button" className="btn-bordered-prominent" onClick={() => goToStep(stepIndex + 1)}>
                Continue
                <Icon name="chevron.right" size={13} />
              </button>
            )}
          </footer>
        </section>
      </div>
    </div>
  );
}
