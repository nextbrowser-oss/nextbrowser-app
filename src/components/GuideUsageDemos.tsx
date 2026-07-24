import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { saveGuideDraft } from "../lib/guideDraft";
import { useStore } from "../store";
import { Icon } from "./Icon";

const DURATION = 4.8;

function useDemoPhase(duration = DURATION) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      setPhase((t % duration) / duration);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration]);
  return phase;
}

function DemoPlayer({ children }: { children: (phase: number) => ReactNode }) {
  const phase = useDemoPhase();
  return <div className="demo-player">{children(phase)}</div>;
}

function DemoCanvas({ children }: { children: ReactNode }) {
  return <div className="demo-canvas">{children}</div>;
}

function DemoChatBubble({
  text,
  side = "user",
  opacity = 1,
}: {
  text: string;
  side?: "user" | "assistant";
  opacity?: number;
}) {
  return (
    <div className={"demo-bubble demo-bubble-" + side} style={{ opacity }}>
      {text}
    </div>
  );
}

function DemoBrowserChrome({ url }: { url: string }) {
  return (
    <div className="demo-browser-chrome">
      <div className="demo-traffic">
        <span className="r" />
        <span className="y" />
        <span className="g" />
      </div>
      <span className="demo-url">{url}</span>
    </div>
  );
}

function LaunchBrowserDemo({ phase }: { phase: number }) {
  const chatOpacity = phase < 0.5 ? 1 : Math.max(0, 1 - (phase - 0.5) * 5);
  const browserSlide = phase < 0.28 ? 1.15 : Math.max(0, 1.15 - (phase - 0.28) * 3.5);
  const browserOpacity = phase < 0.22 ? 0 : Math.min(1, (phase - 0.22) * 4);
  const replyOpacity = phase > 0.12 && phase < 0.65 ? 1 : 0;
  const pulse = 1 + Math.sin(phase * Math.PI * 4) * 0.015;

  return (
    <DemoCanvas>
      <div className="demo-launch">
        <div className="demo-chat-head">
          <span className="demo-accent-bar" />
          <span className="muted">Chat</span>
          <span className="spacer" />
          <span className="ok small">Agent</span>
        </div>
        <DemoChatBubble text="Open the selected profile and go to amazon.com/deals" opacity={chatOpacity} />
        <DemoChatBubble
          text="Plan: start the session, then open the page"
          side="assistant"
          opacity={replyOpacity}
        />
        <div
          className="demo-browser-panel"
          style={{
            opacity: browserOpacity,
            transform: `translateY(${browserSlide * 36}px) scale(${pulse})`,
          }}
        >
          <DemoBrowserChrome url="amazon.com/deals" />
          <div className="demo-page-mock">
            <div className="demo-banner" />
            <div className="demo-cards-row">
              <div />
              <div />
              <div />
            </div>
          </div>
        </div>
      </div>
    </DemoCanvas>
  );
}

function SpanishProxyDemo({ phase }: { phase: number }) {
  const menuOpen = phase > 0.1 && phase < 0.5;
  const esSelected = phase > 0.32;
  const badgeOpacity = phase > 0.52 ? Math.min(1, (phase - 0.52) * 5) : 0;

  return (
    <DemoCanvas>
      <div className="demo-proxy-split">
        <div className="demo-proxy-sidebar">
          <div className="muted small" style={{ fontWeight: 700 }}>
            Profiles
          </div>
          <div className="demo-profile-active">
            <Icon name="person.crop.circle.fill" size={10} />
            <span>selected-profile</span>
            <span className="spacer" />
            <span className="dot green" />
          </div>
          {menuOpen && (
            <div className="demo-menu">
              <div>↻ Rotate</div>
              <div className="highlight">
                <Icon name="globe" size={8} /> Rotate country
              </div>
              <div className="danger">Delete</div>
            </div>
          )}
        </div>
        <div className="demo-proxy-main">
          <DemoChatBubble text="Rotate this profile to ES, then verify it" />
          {esSelected && (
            <div className="demo-es-badge">🇪🇸 Spain ✓</div>
          )}
          <div className="demo-proxy-active" style={{ opacity: badgeOpacity }}>
            <Icon name="network" size={10} />
            <span>ES</span>
            <span className="muted small">verify country & IP</span>
          </div>
        </div>
      </div>
    </DemoCanvas>
  );
}

function PublishedSkillDemo({ phase }: { phase: number }) {
  const chipOpacity = phase < 0.7 ? 1 : Math.max(0, 1 - (phase - 0.7) * 6);
  const rowsVisible = Math.min(4, Math.floor(Math.max(0, phase - 0.22) * 6));
  const rows = [
    ["Item A", "$18"],
    ["Item B", "$24"],
    ["Item C", "$31"],
    ["Item D", "$42"],
  ];

  return (
    <DemoCanvas>
      <div className="demo-parse">
        <div className="muted small">Skills → Apply</div>
        <div className="demo-skill-chip" style={{ opacity: chipOpacity }}>
          <Icon name="sparkles" size={12} />
          <div>
            <div className="muted" style={{ fontSize: 8 }}>
              Example skill
            </div>
            <strong style={{ fontSize: 10 }}>Data extractor</strong>
            <div className="muted" style={{ fontSize: 8 }}>
              published workflow
            </div>
          </div>
        </div>
        {rowsVisible > 0 && (
          <div className="demo-table">
            <div className="ok small" style={{ fontWeight: 600 }}>
              Example structured output
            </div>
            <div className="demo-table-head">
              <span>Listing</span>
              <span>Price</span>
            </div>
            {rows.slice(0, rowsVisible).map(([t, p]) => (
              <div key={t} className="demo-table-row">
                <span>{t}</span>
                <span className="mono">{p}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </DemoCanvas>
  );
}

function CaptchaSolveDemo({ phase }: { phase: number }) {
  const checking = phase > 0.28 && phase < 0.62;
  const needsHuman = phase >= 0.62;

  return (
    <DemoCanvas>
      <div className="demo-captcha-wrap">
        <DemoBrowserChrome url="accounts.site.com/signup" />
        <div className="demo-captcha-body">
          <div className="demo-field" />
          <div className="demo-captcha-box">
            <div className="demo-checkbox">
              {checking && <span className="spin">◌</span>}
              {needsHuman && <span>!</span>}
            </div>
            <div>
              <strong style={{ fontSize: 9 }}>
                {needsHuman ? "Human check needed" : checking ? "Checking support…" : "Challenge detected"}
              </strong>
              {needsHuman && <div className="muted small">continue in Live View</div>}
            </div>
            <Icon
              name="checkmark.shield.fill"
              size={16}
              className="muted"
            />
          </div>
          <div className="demo-submit" />
        </div>
      </div>
    </DemoCanvas>
  );
}

type GuideUsageAction =
  | { kind: "chat"; prompt: string }
  | { kind: "skills"; category?: "captcha" };

export const GUIDE_USAGE_DEMOS: Array<{
  title: string;
  caption: string;
  tint: string;
  action: GuideUsageAction;
  actionLabel: string;
  Demo: ComponentType<{ phase: number }>;
}> = [
  {
    title: "Open a browser",
    caption: "Review a ready-made prompt in Chat, then send it when your agent and profile are ready.",
    tint: "#5ac8fa",
    action: {
      kind: "chat",
      prompt:
        "Using the selected NextBrowser profile, start its browser session if needed and navigate to https://amazon.com/deals. Stop and report if the session cannot start or navigation fails.",
    },
    actionLabel: "Open in Chat",
    Demo: LaunchBrowserDemo,
  },
  {
    title: "Rotate proxy to Spain",
    caption: "Review a prompt that requests country ES and verifies the resulting country and IP.",
    tint: "#ff9500",
    action: {
      kind: "chat",
      prompt:
        "For the selected NextBrowser profile, rotate its proxy country to ES, start the session if needed, verify the resulting proxy country and IP, then report the result. Stop and report if rotation or verification fails.",
    },
    actionLabel: "Open in Chat",
    Demo: SpanishProxyDemo,
  },
  {
    title: "Use a published skill",
    caption: "See what's currently available, then apply a workflow before you run it.",
    tint: "#63e6e2",
    action: { kind: "skills" },
    actionLabel: "Browse skills",
    Demo: PublishedSkillDemo,
  },
  {
    title: "Handle a captcha",
    caption: "Check for a compatible handler, and use Live View when human input is needed.",
    tint: "#34c759",
    action: { kind: "skills", category: "captcha" },
    actionLabel: "Browse skills",
    Demo: CaptchaSolveDemo,
  },
];

export function GuideUsageSection() {
  const setTab = useStore((s) => s.setTab);
  const captchaCategory = useStore((s) =>
    s.skillCategories.find((category) =>
      category.entries.some((entry) => entry.selector.kind === "captcha"),
    ),
  );

  const openDemo = (demo: (typeof GUIDE_USAGE_DEMOS)[number]) => {
    if (demo.action.kind === "chat") {
      const prompt = saveGuideDraft(localStorage, demo.action.prompt);
      if (!prompt) return;
      window.dispatchEvent(new CustomEvent("nextbrowser:guide-draft", { detail: prompt }));
      setTab("chat");
      return;
    }

    if (demo.action.category === "captcha" && captchaCategory) {
      localStorage.setItem("openSkillsCategory", captchaCategory.id);
    }
    setTab("skills");
    if (demo.action.category === "captcha" && captchaCategory) {
      window.requestAnimationFrame(() => window.dispatchEvent(
        new CustomEvent("nextbrowser:open-skills-category", { detail: captchaCategory.id }),
      ));
    }
  };

  return (
    <section className="guide-usage">
      <h3 className="guide-section-title">
        <Icon name="play.rectangle.on.rectangle.fill" size={20} />
        Usage
      </h3>
      <p className="muted">Illustrative previews, not live results. Chat examples open as drafts; Skills shows what's available now.</p>
      <div className="usage-grid">
        {GUIDE_USAGE_DEMOS.map((d) => {
          const isCaptchaSkills = d.action.kind === "skills" && d.action.category === "captcha";
          const actionLabel = isCaptchaSkills && captchaCategory
            ? `Open ${captchaCategory.title}`
            : d.actionLabel;
          return (
            <button
              key={d.title}
              type="button"
              className="usage-card claw-card"
              data-guide-demo={d.title}
              aria-label={`${actionLabel}: ${d.title}`}
              onClick={() => openDemo(d)}
            >
              <div className="demo-player-wrap">
                <span className="demo-illustration-badge" style={{ color: d.tint }}>
                  ILLUSTRATION
                </span>
                <DemoPlayer>
                  {(phase) => <d.Demo phase={phase} />}
                </DemoPlayer>
              </div>
              <strong className="usage-card-title">{d.title}</strong>
              <p className="muted small usage-card-caption">{d.caption}</p>
              <span className="usage-card-action" style={{ color: d.tint }}>
                {actionLabel}
                <Icon name="chevron.right" size={13} />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
