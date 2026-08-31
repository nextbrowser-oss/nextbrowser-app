import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { openGuideChatDraft } from "../lib/guideDraft";
import { useStore } from "../store";
import { GuideActionModal } from "./GuideActionModal";
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
        <DemoChatBubble text="Save the 5 newest Hacker News stories as JSON" opacity={chatOpacity} />
        <DemoChatBubble
          text="Opening the page and collecting title + URL"
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
          <DemoBrowserChrome url="news.ycombinator.com/newest" />
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

type GuideUsageAction =
  | { kind: "chat"; prompt: string }
  | { kind: "skills" };

export const GUIDE_USAGE_DEMOS: Array<{
  title: string;
  caption: string;
  tint: string;
  action: GuideUsageAction;
  actionLabel: string;
  Demo: ComponentType<{ phase: number }>;
}> = [
  {
    title: "Collect a live list",
    caption: "Prepare a Chat task that saves five live results as JSON.",
    tint: "#5ac8fa",
    action: {
      kind: "chat",
      prompt:
        "Using the selected NextBrowser profile, open https://news.ycombinator.com/newest, collect the first 5 story titles and URLs, and save them as hn-newest.json in Artifact Center. Verify that all 5 rows contain a title and an absolute URL.",
    },
    actionLabel: "Prepare in Chat",
    Demo: LaunchBrowserDemo,
  },
  {
    title: "Change proxy country",
    caption: "Prepare a Chat task that changes country and verifies the result.",
    tint: "#ff9500",
    action: {
      kind: "chat",
      prompt:
        "For the selected NextBrowser profile, rotate its proxy country to ES, start the session if needed, verify the resulting proxy country and IP, then report the result. Stop and report if rotation or verification fails.",
    },
    actionLabel: "Prepare in Chat",
    Demo: SpanishProxyDemo,
  },
  {
    title: "Run a reusable skill",
    caption: "Open Skills to choose a saved browser workflow.",
    tint: "#63e6e2",
    action: { kind: "skills" },
    actionLabel: "Browse skills",
    Demo: PublishedSkillDemo,
  },
];

export function GuideUsageSection() {
  const setTab = useStore((s) => s.setTab);
  const setTerminalChat = useStore((s) => s.setTerminalChat);
  const [pendingDemo, setPendingDemo] = useState<(typeof GUIDE_USAGE_DEMOS)[number]>();

  const openDemo = (demo: (typeof GUIDE_USAGE_DEMOS)[number]) => {
    if (demo.action.kind === "chat") {
      openGuideChatDraft(localStorage, demo.action.prompt, {
        setTerminalChat,
        setTab,
        dispatch: (prompt) => window.dispatchEvent(
          new CustomEvent("nextbrowser:guide-draft", { detail: prompt }),
        ),
      });
      return;
    }

    setTab("skills");
  };

  const actionLabelFor = (demo: (typeof GUIDE_USAGE_DEMOS)[number]) => demo.actionLabel;

  const confirmDemo = () => {
    if (!pendingDemo) return;
    const demo = pendingDemo;
    setPendingDemo(undefined);
    openDemo(demo);
  };

  return (
    <>
      <section className="guide-usage">
        <h3 className="guide-section-title">
          <Icon name="play.rectangle.on.rectangle.fill" size={20} />
          Examples
        </h3>
        <p className="muted">Choose an example to see the next step. Chat examples open a ready-to-review draft and do not run until you press Send.</p>
        <div className="usage-grid">
          {GUIDE_USAGE_DEMOS.map((demo) => {
            const actionLabel = actionLabelFor(demo);
            return (
              <button
                key={demo.title}
                type="button"
                className="usage-card claw-card"
                data-guide-demo={demo.title}
                aria-label={`${actionLabel}: ${demo.title}`}
                onClick={() => setPendingDemo(demo)}
              >
                <div className="demo-player-wrap">
                  <DemoPlayer>
                    {(phase) => <demo.Demo phase={phase} />}
                  </DemoPlayer>
                </div>
                <strong className="usage-card-title">{demo.title}</strong>
                <p className="muted small usage-card-caption">{demo.caption}</p>
                <span className="usage-card-action" style={{ color: demo.tint }}>
                  {actionLabel}
                  <Icon name="chevron.right" size={13} />
                </span>
              </button>
            );
          })}
        </div>
      </section>
      {pendingDemo && (
        <GuideActionModal
          confirmation={{
            title: `${actionLabelFor(pendingDemo)}?`,
            confirmLabel: actionLabelFor(pendingDemo),
            icon: pendingDemo.action.kind === "chat"
              ? "bubble.left.and.bubble.right.fill"
              : "square.grid.2x2.fill",
            tint: pendingDemo.tint,
          }}
          onCancel={() => setPendingDemo(undefined)}
          onConfirm={confirmDemo}
        />
      )}
    </>
  );
}
