import { useState } from "react";
import { useStore } from "../store";
import { BrandLogo } from "./BrandLogo";
import { Icon } from "./Icon";
import { PRIMARY_AGENTS } from "../agents";

const STEPS = [
  {
    icon: "hand.wave.fill",
    tint: "#5856d6",
    title: "Welcome",
    subtitle: "A calm console for driving NextBrowser with Claude Code or Codex.",
    action: null as string | null,
  },
  {
    icon: "bolt.fill",
    tint: "#af52de",
    title: "Connect an agent",
    subtitle: "Choose Claude or Codex in the sidebar, then tap Connect to chat.",
    action: "Connect",
  },
  {
    icon: "globe.americas.fill",
    tint: "#ff9500",
    title: "Pick a session",
    subtitle: "Start a profile or rotate to the proxy country you need.",
    action: null,
  },
  {
    icon: "sparkles",
    tint: "#63e6e2",
    title: "Skills & chat",
    subtitle: "Apply a skill from the catalog, hit Use, and watch the agent work in Live.",
    action: "Skills",
  },
];

export function OnboardingView() {
  const finish = useStore((s) => s.finishOnboarding);
  const authorize = useStore((s) => s.authorizeAgent);
  const setTab = useStore((s) => s.setTab);
  const agentId = useStore((s) => s.agentId);
  const switchAgent = useStore((s) => s.switchAgent);
  const ready = useStore((s) => s.agentReady());
  const [step, setStep] = useState(0);
  const current = STEPS[step];

  const onAction = () => {
    if (current.action === "Connect") void authorize();
    if (current.action === "Skills") {
      setTab("skills");
      finish();
    }
  };

  const actionLabel = () => {
    if (current.action === "Connect") {
      const name = PRIMARY_AGENTS.find((a) => a.id === agentId)?.name ?? "agent";
      return ready ? `${name} connected ✓` : `Connect ${name} now`;
    }
    if (current.action === "Skills") return "Open Skills tab";
    return current.action ?? "";
  };

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        <div className="onboarding-top">
          <span className="onboarding-top-label">Quick tour</span>
          <button className="onboarding-skip" onClick={finish}>
            Skip
          </button>
        </div>
        <div className="onboarding-body">
          {step === 0 ? (
            <BrandLogo size={72} />
          ) : (
            <div className="onboarding-icon-wrap" style={{ background: current.tint + "26" }}>
              <Icon name={current.icon} size={34} style={{ color: current.tint }} strokeWidth={2.25} />
            </div>
          )}
          <h2>{current.title}</h2>
          <p className="muted onboarding-subtitle">{current.subtitle}</p>
          {current.action === "Connect" && (
            <div className="onboarding-agent-pick">
              {PRIMARY_AGENTS.map((a) => (
                <button
                  key={a.id}
                  className={"chip" + (agentId === a.id ? " chip-active" : "")}
                  onClick={() => switchAgent(a.id)}
                >
                  {a.name}
                </button>
              ))}
            </div>
          )}
          {current.action && (
            <button className="btn-bordered" onClick={onAction}>
              {actionLabel()}
            </button>
          )}
        </div>
        <div className="onboarding-footer">
          {step > 0 && (
            <button className="btn-bordered" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <span className="spacer" />
          {step < STEPS.length - 1 ? (
            <button className="btn-bordered-prominent" onClick={() => setStep(step + 1)}>
              Continue
            </button>
          ) : (
            <button className="btn-bordered-prominent" onClick={finish}>
              Get started
            </button>
          )}
        </div>
        <div className="onboarding-dots">
          {STEPS.map((_, i) => (
            <span key={i} className={"dot-pip" + (i === step ? " active" : "")} />
          ))}
        </div>
      </div>
    </div>
  );
}
