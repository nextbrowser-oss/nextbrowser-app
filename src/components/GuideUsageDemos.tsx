import { useEffect, useState, type ReactNode } from "react";
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
          <span className="ok small">Claude Code</span>
        </div>
        <DemoChatBubble text="Open NextBrowser and go to amazon.com" opacity={chatOpacity} />
        <DemoChatBubble
          text="Starting session… opening amazon.com"
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
            <span>work-session</span>
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
          <DemoChatBubble text="Start NextBrowser with a proxy (ES)" />
          {esSelected && (
            <div className="demo-es-badge">🇪🇸 Spain ✓</div>
          )}
          <div className="demo-proxy-active" style={{ opacity: badgeOpacity }}>
            <Icon name="network" size={10} />
            <span>ES · Madrid</span>
            <span className="muted small">proxy active</span>
          </div>
        </div>
      </div>
    </DemoCanvas>
  );
}

function ParseListingsDemo({ phase }: { phase: number }) {
  const chipOpacity = phase < 0.7 ? 1 : Math.max(0, 1 - (phase - 0.7) * 6);
  const rowsVisible = Math.min(4, Math.floor(Math.max(0, phase - 0.22) * 6));
  const rows = [
    ["2BR · Downtown", "$1,850"],
    ["Studio · North", "$1,420"],
    ["3BR · Riverside", "$2,650"],
    ["Loft · West End", "$1,990"],
  ];

  return (
    <DemoCanvas>
      <div className="demo-parse">
        <div className="muted small">Skills → Use</div>
        <div className="demo-skill-chip" style={{ opacity: chipOpacity }}>
          <Icon name="sparkles" size={12} />
          <div>
            <div className="muted" style={{ fontSize: 8 }}>
              Use skill
            </div>
            <strong style={{ fontSize: 10 }}>Cian listings</strong>
            <div className="muted" style={{ fontSize: 8 }}>
              cian.ru
            </div>
          </div>
        </div>
        {rowsVisible > 0 && (
          <div className="demo-table">
            <div className="ok small" style={{ fontWeight: 600 }}>
              Extracted 12 listings
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
  const solving = phase > 0.28 && phase < 0.62;
  const solved = phase >= 0.62;

  return (
    <DemoCanvas>
      <div className="demo-captcha-wrap">
        <DemoBrowserChrome url="accounts.site.com/signup" />
        <div className="demo-captcha-body">
          <div className="demo-field" />
          <div className={"demo-captcha-box" + (solved ? " solved" : "")}>
            <div className="demo-checkbox">
              {solving && <span className="spin">◌</span>}
              {solved && <span className="ok">✓</span>}
            </div>
            <div>
              <strong style={{ fontSize: 9 }}>
                {solved ? "Captcha solved" : solving ? "Solving…" : "I'm not a robot"}
              </strong>
              {solved && <div className="ok small">reCAPTCHA v2 · auto</div>}
            </div>
            <Icon
              name="checkmark.shield.fill"
              size={16}
              className={solved ? "ok" : "muted"}
            />
          </div>
          <div className={"demo-submit" + (solved ? " on" : "")} />
        </div>
      </div>
    </DemoCanvas>
  );
}

const DEMOS = [
  {
    title: "Launch NextBrowser",
    caption: "Ask the agent in chat — it opens a managed browser session for you.",
    tint: "#5ac8fa",
    tryPrompt: "Open NextBrowser and navigate to amazon.com/deals",
    Demo: LaunchBrowserDemo,
  },
  {
    title: "Proxy",
    caption: "Rotate country to ES so the session exits through Spain.",
    tint: "#ff9500",
    tryPrompt: "Using the clawctl CLI, rotate the active browser profile to Spain (ES) with --verify, then start the session and confirm the proxy country.",
    Demo: SpanishProxyDemo,
  },
  {
    title: "Parse listings",
    caption: "Apply a skill, hit Use, and let the agent extract structured data.",
    tint: "#63e6e2",
    tryPrompt:
      "Use the Cian listings skill to extract structured apartment data from cian.ru.",
    Demo: ParseListingsDemo,
  },
  {
    title: "Solve captcha",
    caption: "Captcha skills unblock sign-up and form flows automatically.",
    tint: "#34c759",
    tryPrompt:
      "Sign up on the target site and auto-solve any reCAPTCHA using the installed captcha skill.",
    Demo: CaptchaSolveDemo,
  },
];

export function GuideUsageSection() {
  const tryPrompt = useStore((s) => s.tryGuidePrompt);

  return (
    <section className="guide-usage">
      <h3 className="guide-section-title">
        <Icon name="play.rectangle.on.rectangle.fill" size={20} />
        Usage
      </h3>
      <p className="muted">Animated walkthroughs — how a typical session looks.</p>
      <div className="usage-grid">
        {DEMOS.map((d) => (
          <div key={d.title} className="usage-card claw-card">
            <div className="demo-player-wrap">
              <DemoPlayer>
                {(phase) => <d.Demo phase={phase} />}
              </DemoPlayer>
              <span className="demo-live-badge" style={{ color: d.tint }}>
                <span className="live-dot" style={{ background: d.tint }} />
                LIVE
              </span>
            </div>
            <strong className="usage-card-title">{d.title}</strong>
            <p className="muted small usage-card-caption">{d.caption}</p>
            <button className="btn-bordered small usage-try-btn" onClick={() => tryPrompt(d.tryPrompt)}>
              Try in chat
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
