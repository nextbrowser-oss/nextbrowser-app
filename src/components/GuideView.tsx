import { useState } from "react";
import { agentById } from "../agents";
import { brandName } from "../constants";
import { trackEvent } from "../lib/analytics";
import {
  GUIDE_FEATURE_GROUPS,
  type GuideAction,
  type GuideFeature,
} from "../lib/guideFeatures";
import { guideSessionSetupEvent, guideWorkspaceProfileNames } from "../lib/guideQuickStart";
import { sequentialProgress } from "../lib/sequentialProgress";
import { useStore } from "../store";
import { BrandLogo } from "./BrandLogo";
import {
  GuideActionModal,
  type GuideActionConfirmation,
} from "./GuideActionModal";
import { GuideUsageSection } from "./GuideUsageDemos";
import { Icon } from "./Icon";

export function GuideFeatureCard({
  feature,
  actionLabel,
  onActivate,
}: {
  feature: GuideFeature;
  actionLabel?: string;
  onActivate: () => void;
}) {
  const label = actionLabel ?? feature.actionLabel;

  return (
    <button
      type="button"
      className="feature-card claw-card"
      data-guide-feature={feature.id}
      aria-label={`${label}: ${feature.title}`}
      onClick={onActivate}
    >
      <span className="feature-card-accent" style={{ background: feature.tint }} />
      <span className="feature-card-main">
        <span className="feature-icon" style={{ background: feature.tint + "26", color: feature.tint }}>
          <Icon name={feature.icon} size={22} strokeWidth={2.25} />
        </span>
        <span className="feature-card-copy">
          <strong className="feature-title">{feature.title}</strong>
          <span className="muted small feature-caption">{feature.caption}</span>
        </span>
      </span>
      <span className="feature-action" style={{ color: feature.tint }}>
        {label}
        <Icon name="chevron.right" size={13} />
      </span>
    </button>
  );
}

export function GuideView({ onOpenAgentSettings }: { onOpenAgentSettings: () => void }) {
  const showTour = useStore((s) => s.showOnboardingAgain);
  const setTab = useStore((s) => s.setTab);
  const setTerminalChat = useStore((s) => s.setTerminalChat);
  const setDashboardKeyPromptOpen = useStore((s) => s.setDashboardKeyPromptOpen);
  const setSidebarCollapsed = useStore((s) => s.setSidebarCollapsed);
  const authed = useStore((s) => s.authed);
  const agentId = useStore((s) => s.agentId);
  const agentReady = useStore((s) => s.agentReady());
  const profiles = useStore((s) => s.profiles);
  const workspaces = useStore((s) => s.workspaces);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const selectedProfile = useStore((s) => s.selectedProfile);
  const statuses = useStore((s) => s.statuses);
  const profileSessions = useStore((s) => s.profileSessions);
  const workspaceProfileNames = guideWorkspaceProfileNames(activeWorkspaceId, workspaces, profiles);
  const profileCount = workspaceProfileNames.length;
  const selectedWorkspaceProfile = selectedProfile && workspaceProfileNames.includes(selectedProfile)
    ? selectedProfile
    : workspaceProfileNames.length === 1 ? workspaceProfileNames[0] : undefined;
  const selectedSessionStatus = selectedWorkspaceProfile
    ? statuses[selectedWorkspaceProfile] ?? profileSessions[selectedWorkspaceProfile]?.status ?? "unknown"
    : "unknown";
  const selectedSessionRunning = selectedSessionStatus === "running";
  const selectedSessionStarting = selectedSessionStatus === "starting";
  const conversationCount = useStore((s) =>
    s.conversations.filter((conversation) => conversation.agent === s.agentId).length,
  );
  const [pendingAction, setPendingAction] = useState<{
    action: GuideAction;
    source: string;
    confirmation: GuideActionConfirmation;
  }>();
  const agentName = agentById(agentId).name;
  const readiness = [
    authed,
    agentReady,
    selectedSessionRunning,
    conversationCount > 0,
  ];
  const progress = sequentialProgress(readiness);

  const dispatchGuideEvent = (name: string) => {
    window.requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(name)));
  };

  const runAction = (action: GuideAction, source: string) => {
    trackEvent("guide_action_opened", { action, source });
    if (action === "account") {
      if (authed) setTab("usage");
      else setDashboardKeyPromptOpen(true);
      return;
    }
    if (action === "agent") {
      onOpenAgentSettings();
      return;
    }
    if (action === "profiles") {
      if (!authed) {
        setDashboardKeyPromptOpen(true);
        return;
      }
      setSidebarCollapsed(false);
      dispatchGuideEvent("nextbrowser:focus-profiles");
      if (profileCount === 0) dispatchGuideEvent("nextbrowser:open-profile-creator");
      return;
    }
    if (action === "start_session") {
      setSidebarCollapsed(false);
      dispatchGuideEvent("nextbrowser:focus-profiles");
      dispatchGuideEvent(guideSessionSetupEvent(profileCount));
      return;
    }
    if (action === "identity") {
      setSidebarCollapsed(false);
      dispatchGuideEvent("nextbrowser:focus-profiles");
      dispatchGuideEvent(
        profileCount === 0
          ? "nextbrowser:open-profile-creator"
          : "nextbrowser:open-profile-actions",
      );
      return;
    }
    if (action === "chat") setTerminalChat(false);
    setTab(action);
  };

  const quickSteps: Array<{
    label: string;
    detail: string;
    action: GuideAction;
    actionLabel: string;
    icon: string;
    tint: string;
  }> = [
    {
      label: authed ? "Account connected" : "Connect account",
      detail: authed ? "Ready" : "Profiles, traffic, and skills",
      action: "account",
      actionLabel: authed ? "View usage" : "Connect account",
      icon: "key.fill",
      tint: "#007aff",
    },
    {
      label: agentReady ? `${agentName} connected` : "Connect agent",
      detail: progress.states[1] === "locked"
        ? `Complete step ${progress.currentIndex + 1} first`
        : agentReady ? "Ready" : "Claude Code or Codex",
      action: "agent",
      actionLabel: "Open agent settings",
      icon: "cpu.fill",
      tint: "#af52de",
    },
    {
      label: selectedSessionRunning
        ? "Selected session running"
        : selectedSessionStarting
          ? "Starting session…"
        : profileCount > 0
          ? "Start session"
          : "Create profile",
      detail: progress.states[2] === "locked"
        ? `Complete step ${progress.currentIndex + 1} first`
        : selectedSessionRunning
        ? "Ready"
        : selectedSessionStarting
          ? "Starting…"
        : profileCount > 0
          ? "Start a browser profile"
          : "Create a browser profile",
      action: "start_session",
      actionLabel: profileCount > 0 ? "Open session setup" : "Create profile",
      icon: "play.circle",
      tint: "#34c759",
    },
    {
      label: conversationCount > 0 ? "Continue in Chat" : "Start a chat",
      detail: progress.states[3] === "locked"
        ? `Complete step ${progress.currentIndex + 1} first`
        : conversationCount > 0 ? "Ready" : `Chat with ${agentName}`,
      action: "chat",
      actionLabel: "Open Chat",
      icon: "bubble.left.and.bubble.right.fill",
      tint: "#ff2d55",
    },
  ];

  const requestAction = (
    action: GuideAction,
    source: string,
    confirmation: GuideActionConfirmation,
  ) => {
    setPendingAction({ action, source, confirmation });
  };

  const confirmAction = () => {
    if (!pendingAction) return;
    const { action, source } = pendingAction;
    setPendingAction(undefined);
    runAction(action, source);
  };

  const featureActionLabel = (feature: GuideFeature) => {
    if (feature.action === "account") return authed ? "View usage" : "Connect account";
    if (feature.id === "profiles") {
      if (!authed) return "Connect account";
      return profileCount === 0 ? "Create profile" : "Show profiles";
    }
    if (feature.id === "identity" && profileCount === 0) return "Create profile";
    return feature.actionLabel;
  };

  return (
    <div className="page guide-page">
      <div className="guide-header">
        <BrandLogo size={52} />
        <div>
          <h2>{brandName}</h2>
          <p className="muted">Connect what you need, then start a task.</p>
        </div>
        <span className="spacer" />
        <button className="btn-bordered" onClick={showTour}>
          <Icon name="play.circle" size={14} />
          Replay tour
        </button>
      </div>

      <section className="guide-start-section" aria-labelledby="guide-start-title">
        <div className="guide-section-heading">
          <h3 id="guide-start-title">Get started</h3>
          <span className="muted small">
            {progress.currentIndex === -1
              ? "Ready"
              : `Next: ${quickSteps[progress.currentIndex].label}`}
          </span>
        </div>
        <div className="quick-start claw-card">
          {quickSteps.map((step, index) => {
            const state = progress.states[index];
            return (
              <button
                key={step.action}
                type="button"
                className={`quick-step is-${state}`}
                data-step-state={state}
                disabled={state === "locked"}
                onClick={() => requestAction(
                  step.action,
                  `quick_step_${index + 1}`,
                  {
                    title: `${step.actionLabel}?`,
                    confirmLabel: step.actionLabel,
                    icon: step.icon,
                    tint: step.tint,
                  },
                )}
                aria-label={`${step.label}. ${step.detail}`}
              >
                <span className="step-num">
                  {state === "complete" ? <Icon name="checkmark" size={12} strokeWidth={2.5} /> : index + 1}
                </span>
                <span className="quick-step-copy">
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                  {state !== "locked" && <span className="quick-step-action">{step.actionLabel}</span>}
                </span>
                <Icon name={state === "locked" ? "lock.fill" : "chevron.right"} size={13} className="quick-step-chevron" />
              </button>
            );
          })}
        </div>
      </section>

      <GuideUsageSection />

      <section className="guide-features" aria-labelledby="guide-features-title">
        <div className="guide-section-heading guide-features-heading">
          <h3 id="guide-features-title">Explore</h3>
        </div>
        {GUIDE_FEATURE_GROUPS.map((group) => (
          <section key={group.id} className="guide-feature-group" aria-labelledby={`guide-group-${group.id}`}>
            <div className="guide-feature-group-heading">
              <h4 id={`guide-group-${group.id}`}>{group.title}</h4>
            </div>
            <div className="feature-grid">
              {group.features.map((feature) => {
                const actionLabel = featureActionLabel(feature);
                return (
                  <GuideFeatureCard
                    key={feature.id}
                    feature={feature}
                    actionLabel={actionLabel}
                    onActivate={() => requestAction(
                      feature.action,
                      `feature_${feature.id}`,
                      {
                        title: `${actionLabel}?`,
                        confirmLabel: actionLabel,
                        icon: feature.icon,
                        tint: feature.tint,
                      },
                    )}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </section>

      {pendingAction && (
        <GuideActionModal
          confirmation={pendingAction.confirmation}
          onCancel={() => setPendingAction(undefined)}
          onConfirm={confirmAction}
        />
      )}
    </div>
  );
}
