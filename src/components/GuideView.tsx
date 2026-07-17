import { useStore } from "../store";
import { brandName } from "../constants";
import { BrandLogo } from "./BrandLogo";
import { Icon } from "./Icon";
import { GuideUsageSection } from "./GuideUsageDemos";

const FEATURES = [
  { icon: "key.fill", title: "Sign in", caption: "Reuses your saved API key, or paste it once.", tint: "#007aff" },
  { icon: "chart.bar.fill", title: "Proxy usage", caption: "Live used / limit, like the dashboard.", tint: "#5ac8fa" },
  { icon: "person.2.fill", title: "Profiles", caption: "Search, start, stop, pick an active one.", tint: "#5856d6" },
  { icon: "globe", title: "Rotate country", caption: "••• menu moves proxy + identity abroad.", tint: "#34c759" },
  { icon: "trash.fill", title: "Delete profile", caption: "••• → Delete, with confirmation.", tint: "#ff3b30" },
  { icon: "cpu.fill", title: "Two agents", caption: "Claude Code & Codex — each its own tab.", tint: "#af52de" },
  { icon: "person.badge.key.fill", title: "Agent login", caption: "“Log in” / type /login — opens Terminal.", tint: "#ff9500" },
  { icon: "tray.full.fill", title: "Message queue", caption: "Send freely; replies run in order.", tint: "#ff2d55" },
  { icon: "timer", title: "Timeout", caption: "A stuck reply is killed; queue moves on.", tint: "#ffcc00" },
  { icon: "clock.arrow.circlepath", title: "Saved history", caption: "Multiple chats per agent, kept on disk.", tint: "#32ade6" },
  { icon: "square.grid.2x2.fill", title: "Skills", caption: "Apply by type; pulled from the API.", tint: "#63e6e2" },
  { icon: "video.fill", title: "Live view", caption: "Screencast a running profile over CDP.", tint: "#ff3b30" },
];

export function GuideView() {
  const showTour = useStore((s) => s.showOnboardingAgain);

  return (
    <div className="page guide-page">
      <div className="guide-header">
        <BrandLogo size={52} />
        <div>
          <h2>{brandName}</h2>
          <p className="muted">A native console over nextctl.</p>
        </div>
        <span className="spacer" />
        <button className="btn-bordered" onClick={showTour}>
          Replay tour
        </button>
      </div>

      <div className="quick-start claw-card">
        {["Sign in", "Connect an agent", "Pick a profile", "Chat & automate"].map((step, i) => (
          <span key={step} className="quick-step">
            <span className="step-num">{i + 1}</span>
            {step}
            {i < 3 && <Icon name="chevron.right" size={12} className="muted chev" />}
          </span>
        ))}
      </div>

      <GuideUsageSection />

      <h3 className="guide-section-title">
        <Icon name="square.grid.2x2.fill" size={20} />
        Features
      </h3>
      <div className="feature-grid">
        {FEATURES.map((f) => (
          <div key={f.title} className="feature-card claw-card">
            <span className="feature-icon" style={{ background: f.tint + "26", color: f.tint }}>
              <Icon name={f.icon} size={22} strokeWidth={2.25} />
            </span>
            <strong className="feature-title">{f.title}</strong>
            <p className="muted small feature-caption">{f.caption}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
