import { useState } from "react";
import { agentById } from "../agents";
import { brandName } from "../constants";
import { trackEvent } from "../lib/analytics";
import {
  GUIDE_FEATURE_GROUPS,
  type GuideAction,
  type GuideFeature,
} from "../lib/guideFeatures";
import { useStore } from "../store";
import { sessionRunning } from "../types";
import { BrandLogo } from "./BrandLogo";
import { GuideUsageSection } from "./GuideUsageDemos";
import { Icon } from "./Icon";
import { VPSSetupModal } from "./VPSSetupModal";

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
  const setDashboardKeyPromptOpen = useStore((s) => s.setDashboardKeyPromptOpen);
  const setSidebarCollapsed = useStore((s) => s.setSidebarCollapsed);
  const authed = useStore((s) => s.authed);
  const agentId = useStore((s) => s.agentId);
  const agentReady = useStore((s) => s.agentReady());
  const profileCount = useStore((s) => {
    const defaultKnown = !!s.defaultSession?.session?.name ||
      (s.defaultSession?.status ?? "unknown") !== "unknown";
    const hasListedDefault = s.profiles.some((profile) => profile.name === "default");
    return s.profiles.length + (defaultKnown && !hasListedDefault ? 1 : 0);
  });
  const hasRunningSession = useStore((s) =>
    sessionRunning(s.defaultSession) ||
    Object.values(s.profileSessions).some(sessionRunning) ||
    Object.values(s.statuses).some((status) => status === "running"),
  );
  const conversationCount = useStore((s) =>
    s.conversations.filter((conversation) => conversation.agent === s.agentId).length,
  );
  const captchaCategory = useStore((s) =>
    s.skillCategories.find((category) =>
      category.entries.some((entry) => entry.selector.kind === "captcha"),
    ),
  );
  const [vpsSetupOpen, setVPSSetupOpen] = useState(false);
  const agentName = agentById(agentId).name;

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
      setSidebarCollapsed(false);
      dispatchGuideEvent("nextbrowser:focus-profiles");
      if (profileCount === 0) dispatchGuideEvent("nextbrowser:open-profile-creator");
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
    if (action === "captcha") {
      if (captchaCategory) {
        localStorage.setItem("openSkillsCategory", captchaCategory.id);
      }
      setTab("skills");
      if (captchaCategory) {
        window.requestAnimationFrame(() => window.dispatchEvent(
          new CustomEvent("nextbrowser:open-skills-category", { detail: captchaCategory.id }),
        ));
      }
      return;
    }
    if (action === "vps") {
      setVPSSetupOpen(true);
      return;
    }
    setTab(action);
  };

  const quickSteps = [
    {
      label: authed ? "Account connected" : "Connect account",
      detail: authed ? "Managed features are available" : "For profiles, traffic, and skills",
      complete: authed,
      action: "account" as GuideAction,
    },
    {
      label: agentReady ? `${agentName} connected` : "Connect agent",
      detail: agentReady ? "Ready" : "Claude Code or Codex",
      complete: agentReady,
      action: "agent" as GuideAction,
    },
    {
      label: hasRunningSession
        ? "Session running"
        : profileCount > 0
          ? "Start session"
          : "Create profile",
      detail: hasRunningSession
        ? "Ready for Chat and Live View"
        : profileCount > 0
          ? "Choose a profile and press Start"
          : "Managed or manual proxy",
      complete: hasRunningSession,
      action: "profiles" as GuideAction,
    },
    {
      label: conversationCount > 0 ? "Continue in Chat" : "Start a chat",
      detail: conversationCount > 0 ? `${agentName} conversation ready` : `Create one for ${agentName}`,
      complete: conversationCount > 0,
      action: "chat" as GuideAction,
    },
  ];

  return (
    <div className="page guide-page">
      <div className="guide-header">
        <BrandLogo size={52} />
        <div>
          <h2>{brandName}</h2>
          <p className="muted">Set up a browser profile and agent, then work from Chat or Live View.</p>
        </div>
        <span className="spacer" />
        <button className="btn-bordered" onClick={showTour}>
          <Icon name="play.circle" size={14} />
          Replay tour
        </button>
      </div>

      <section className="guide-start-section" aria-labelledby="guide-start-title">
        <div className="guide-section-heading">
          <div>
            <span className="guide-eyebrow">Start here</span>
            <h3 id="guide-start-title">Get ready in four steps</h3>
          </div>
          <span className="muted small">Finish the essentials, then explore examples and workflows.</span>
        </div>
        <div className="quick-start claw-card">
          {quickSteps.map((step, index) => (
            <button
              key={step.action}
              type="button"
              className={"quick-step" + (step.complete ? " is-complete" : "")}
              onClick={() => runAction(step.action, `quick_step_${index + 1}`)}
              aria-label={`${step.label}. ${step.detail}`}
            >
              <span className="step-num">
                {step.complete ? <Icon name="checkmark" size={12} strokeWidth={2.5} /> : index + 1}
              </span>
              <span className="quick-step-copy">
                <strong>{step.label}</strong>
                <span>{step.detail}</span>
              </span>
              <Icon name="chevron.right" size={13} className="quick-step-chevron" />
            </button>
          ))}
        </div>
      </section>

      <GuideUsageSection />

      <section className="guide-features" aria-labelledby="guide-features-title">
        <div className="guide-section-heading guide-features-heading">
          <div>
            <span className="guide-eyebrow">Explore</span>
            <h3 id="guide-features-title">Everything is one click away</h3>
          </div>
          <span className="muted small">Open a workspace, control, or setup flow directly from any card.</span>
        </div>
        {GUIDE_FEATURE_GROUPS.map((group) => (
          <section key={group.id} className="guide-feature-group" aria-labelledby={`guide-group-${group.id}`}>
            <div className="guide-feature-group-heading">
              <h4 id={`guide-group-${group.id}`}>{group.title}</h4>
              <p className="muted small">{group.description}</p>
            </div>
            <div className="feature-grid">
              {group.features.map((feature) => (
                <GuideFeatureCard
                  key={feature.id}
                  feature={feature}
                  actionLabel={
                    feature.action === "account"
                      ? authed ? "View usage" : "Connect account"
                      : feature.id === "identity" && profileCount === 0
                        ? "Create a profile first"
                        : feature.id === "captcha" && captchaCategory
                          ? `Open ${captchaCategory.title}`
                          : undefined
                  }
                  onActivate={() => runAction(feature.action, `feature_${feature.id}`)}
                />
              ))}
            </div>
          </section>
        ))}
      </section>

      {vpsSetupOpen && <VPSSetupModal onClose={() => setVPSSetupOpen(false)} />}
    </div>
  );
}
