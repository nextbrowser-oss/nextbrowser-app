import { useEffect, useState } from "react";
import { useStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { SkillsView } from "./components/SkillsView";
import { LiveView } from "./components/LiveView";
import { GuideView } from "./components/GuideView";
import { OnboardingView } from "./components/OnboardingView";
import { DashboardKeyModal } from "./components/DashboardKeyModal";
import { BrandLogo } from "./components/BrandLogo";
import { Icon, Spinner } from "./components/Icon";
import { brandName, dashboardUrl } from "./constants";
import { getPreviewMode, getPreviewTab } from "./preview";
import type { AppTab, Conversation } from "./types";
import { resolveTheme, type Theme } from "./theme";
import { flushAnalyticsEngagement, initAnalytics, trackEvent, trackScreenView } from "./lib/analytics";
import { listen } from "./electronBridge";
import { agentById } from "./agents";

const TABS: { id: AppTab; label: string; icon: string }[] = [
  { id: "chat", label: "Chat", icon: "bubble.left.and.bubble.right.fill" },
  { id: "skills", label: "Skills", icon: "square.grid.2x2.fill" },
  { id: "live", label: "Live", icon: "video.fill" },
  { id: "guide", label: "Guide", icon: "book.fill" },
];

const PREVIEW_TABS = new Set<string>(["chat", "skills", "live", "guide"]);

function ThemeToggle({ theme, onToggle, floating = false }: {
  theme: Theme;
  onToggle: () => void;
  floating?: boolean;
}) {
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button
      className={`theme-toggle plain-icon-btn${floating ? " theme-toggle-floating" : ""}`}
      onClick={onToggle}
      title={label}
      aria-label={label}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
    </button>
  );
}

function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="settings-toggle plain-icon-btn"
      onClick={onClick}
      title="Settings"
      aria-label="Settings"
    >
      <Icon name="gearshape" size={18} />
    </button>
  );
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const clawctlVersion = useStore((s) => s.clawctlVersion);
  const clawctlSupportsSkill = useStore((s) => s.clawctlSupportsSkill);
  const agentId = useStore((s) => s.agentId);
  const agentReady = useStore((s) => s.agentReady());
  const agentVersion = useStore((s) => s.agentVersion());
  const profiles = useStore((s) => s.profiles.length);
  const proxy = useStore((s) => s.proxy);
  const logout = useStore((s) => s.logout);
  const agentName = agentById(agentId).name;

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-card settings-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <Icon name="gearshape" size={18} />
          <div>
            <strong>Settings</strong>
            <div className="muted small">Local app and runtime status</div>
          </div>
        </div>
        <div className="settings-health">
          <div>
            <span className="muted small">Desktop app</span>
            <strong>Operational</strong>
          </div>
          <span className="status-pill">v{__APP_VERSION__}</span>
        </div>
        <div className="settings-section">
          <div className="settings-row">
            <span className="muted small">NextBrowser</span>
            <strong>{__APP_VERSION__}</strong>
          </div>
          <div className="settings-row">
            <span className="muted small">clawctl</span>
            <strong>{clawctlVersion || "not detected"}</strong>
          </div>
          <div className="settings-row">
            <span className="muted small">Active agent</span>
            <strong>{agentName}</strong>
          </div>
          <div className="settings-row">
            <span className="muted small">Agent status</span>
            <span className={agentReady ? "ok small" : "muted small"}>
              {agentReady ? agentVersion || "connected" : "not connected"}
            </span>
          </div>
          <div className="settings-row">
            <span className="muted small">Skill install</span>
            <span className={clawctlSupportsSkill ? "ok small" : "warn small"}>
              {clawctlSupportsSkill ? "supported" : "needs update"}
            </span>
          </div>
          <div className="settings-row">
            <span className="muted small">Profiles</span>
            <strong>{profiles}</strong>
          </div>
          <div className="settings-row">
            <span className="muted small">Proxy</span>
            <span className={proxy ? "ok small" : "muted small"}>
              {proxy ? proxy.state : "locked"}
            </span>
          </div>
        </div>

        <div className="settings-section">
          <a
            className="settings-link"
            href={dashboardUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => trackEvent("dashboard_opened", { source: "settings" })}
          >
            <span>Open dashboard</span>
            <Icon name="arrow.up.forward.app" size={14} />
          </a>
          <button
            className="settings-link settings-link-danger"
            onClick={() => {
              logout();
              onClose();
            }}
          >
            <span>Sign out</span>
            <Icon name="rectangle.portrait.and.arrow.right" size={14} />
          </button>
        </div>

        <div className="row settings-actions">
          <span className="spacer" />
          <button className="secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function useButtonTooltips() {
  useEffect(() => {
    const apply = () => {
      document.querySelectorAll<HTMLButtonElement>("button:not([title])").forEach((button) => {
        const label = button.getAttribute("aria-label") || button.textContent?.replace(/\s+/g, " ").trim();
        if (label) button.title = label;
      });
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
}

export function App() {
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(
    localStorage.getItem("nextbrowser.theme"),
    window.matchMedia("(prefers-color-scheme: light)").matches,
  ));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const preview = getPreviewMode();
  const checking = useStore((s) => s.checking);
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const bootstrap = useStore((s) => s.bootstrap);
  const showOnboarding = useStore((s) => s.showOnboarding);
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const setAppActive = useStore((s) => s.setAppActive);
  useButtonTooltips();

  useEffect(() => {
    initAnalytics();
    trackScreenView(tab, { source: "app_start" }, { pageView: false });
    trackEvent("app_start", {
      preview_mode: preview ?? "none",
      theme,
    });
    let cleanup: (() => void) | undefined;
    void listen<{ status?: string; version?: string; percent?: number; message?: string }>("app:update", (event) => {
      trackEvent("app_update_status", {
        update_status: event.payload.status ?? "unknown",
        has_version: !!event.payload.version,
        percent: event.payload.percent ?? undefined,
        has_message: !!event.payload.message,
      });
    }).then((off) => {
      cleanup = off;
    }).catch(() => undefined);
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState === "visible") flushAnalyticsEngagement("heartbeat");
    }, 30_000);
    let closeTracked = false;
    const onVisibility = () => {
      const visible = document.visibilityState === "visible";
      trackEvent("app_visibility_changed", { visible });
      if (!visible) flushAnalyticsEngagement("hidden");
    };
    const onPageHide = () => {
      if (closeTracked) return;
      closeTracked = true;
      trackEvent("app_close", { reason: "pagehide" });
      flushAnalyticsEngagement("pagehide");
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onPageHide);
    return () => {
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onPageHide);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem("nextbrowser.theme", theme);
    trackEvent("theme_changed", { theme });
  }, [theme]);

  useEffect(() => {
    if (preview === "login") {
      useStore.setState({ checking: false, authed: false });
      return;
    }
    if (preview === "onboarding") {
      useStore.setState({ checking: false, authed: true, showOnboarding: true, clawctlVersion: "1.0.0" });
      return;
    }
    if (preview === "main") {
      const tabParam = getPreviewTab();
      const previewConvs: Conversation[] = [
        {
          id: "preview-conv-1",
          agent: "claude",
          title: "Amazon deals",
          createdAt: Date.now() - 3600000,
          updatedAt: Date.now() - 600000,
          messages: [],
        },
        {
          id: "preview-conv-2",
          agent: "claude",
          title: "Spanish proxy test",
          createdAt: Date.now() - 86400000,
          updatedAt: Date.now() - 7200000,
          messages: [],
        },
      ];
      useStore.setState({
        checking: false,
        authed: true,
        clawctlVersion: "1.0.0",
        clawctlSupportsSkill: true,
        agentId: "claude",
        conversations: previewConvs,
        activeConvId: { claude: "preview-conv-1", codex: "" },
        proxy: {
          limited: true,
          used_bytes: 1_200_000_000,
          limit_bytes: 5_000_000_000,
          percent_used: 24,
          state: "active",
          dashboard_url: dashboardUrl,
        },
        showOnboarding: false,
        ...(tabParam && PREVIEW_TABS.has(tabParam) ? { tab: tabParam as AppTab } : {}),
      });
      return;
    }
    bootstrap();
  }, [bootstrap, preview]);

  useEffect(() => {
    const onVis = () => setAppActive(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [setAppActive]);

  useEffect(() => {
    let dragging = false;
    let startX = 0;
    let startW = sidebarWidth;
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      if (sidebarCollapsed) return;
      setSidebarWidth(Math.min(480, Math.max(240, startW + (e.clientX - startX))));
    };
    const onUp = () => {
      dragging = false;
    };
    const handle = document.getElementById("sidebar-resize");
    const onDown = (e: MouseEvent) => {
      dragging = true;
      startX = e.clientX;
      startW = sidebarWidth;
    };
    handle?.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      handle?.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [sidebarCollapsed, sidebarWidth, setSidebarWidth]);

  if (checking && preview !== "login" && preview !== "main" && preview !== "onboarding") {
    return (
      <>
        <div className="floating-controls">
          <SettingsButton onClick={() => setSettingsOpen(true)} />
          <ThemeToggle theme={theme} onToggle={() => setTheme(theme === "dark" ? "light" : "dark")} />
        </div>
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
        <div className="splash">
          <BrandLogo size={76} />
          <div className="splash-title">{brandName}</div>
          <Spinner size={18} />
          <div className="muted small">Checking saved credentials…</div>
        </div>
      </>
    );
  }

  return (
    <div className="app">
      <aside
        className={"sidebar thin-material" + (sidebarCollapsed ? " sidebar-collapsed" : "")}
        style={{ width: sidebarCollapsed ? 68 : sidebarWidth }}
      >
        <Sidebar />
      </aside>
      {!sidebarCollapsed && <div id="sidebar-resize" className="resize-handle" />}
      <main className="content">
        <nav className="tabbar">
          <div className="tabbar-group" role="tablist" aria-label="Main views">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={"tab-hit" + (tab === t.id ? " tab-hit-active" : "")}
                onClick={() => setTab(t.id)}
                title={`Open ${t.label}`}
                aria-label={`Open ${t.label}`}
              >
                <span className={"tab-pill" + (tab === t.id ? " tab-pill-active" : "")}>
                  <Icon name={t.icon} size={16} strokeWidth={2.25} />
                  {t.label}
                </span>
              </button>
            ))}
          </div>
          <span className="tabbar-spacer" />
          <div className="tabbar-controls">
            <SettingsButton onClick={() => setSettingsOpen(true)} />
            <ThemeToggle theme={theme} onToggle={() => setTheme(theme === "dark" ? "light" : "dark")} />
          </div>
        </nav>
        <hr className="divider" />
        <div className={"tab-content" + (tab === "skills" ? " tab-content-bleed" : "")}>
          {tab === "chat" && <ChatView />}
          {tab === "skills" && <SkillsView />}
          {tab === "live" && <LiveView />}
          {tab === "guide" && <GuideView />}
        </div>
      </main>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <DashboardKeyModal />
      {showOnboarding && <OnboardingView />}
    </div>
  );
}
