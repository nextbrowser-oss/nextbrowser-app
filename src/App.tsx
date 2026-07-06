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
import { initAnalytics, trackEvent } from "./lib/analytics";
import { listen } from "./electronBridge";

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

export function App() {
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(
    localStorage.getItem("nextbrowser.theme"),
    window.matchMedia("(prefers-color-scheme: light)").matches,
  ));
  const preview = getPreviewMode();
  const checking = useStore((s) => s.checking);
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const bootstrap = useStore((s) => s.bootstrap);
  const showOnboarding = useStore((s) => s.showOnboarding);
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const setAppActive = useStore((s) => s.setAppActive);

  useEffect(() => {
    initAnalytics();
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
  }, [sidebarWidth, setSidebarWidth]);

  if (checking && preview !== "login" && preview !== "main" && preview !== "onboarding") {
    return (
      <>
        <ThemeToggle theme={theme} onToggle={() => setTheme(theme === "dark" ? "light" : "dark")} floating />
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
      <aside className="sidebar thin-material" style={{ width: sidebarWidth }}>
        <Sidebar />
      </aside>
      <div id="sidebar-resize" className="resize-handle" />
      <main className="content">
        <nav className="tabbar">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={"tab-hit" + (tab === t.id ? " tab-hit-active" : "")}
              onClick={() => setTab(t.id)}
            >
              <span className={"tab-pill" + (tab === t.id ? " tab-pill-active" : "")}>
                <Icon name={t.icon} size={16} strokeWidth={2.25} />
                {t.label}
              </span>
            </button>
          ))}
          <span className="tabbar-spacer" />
          <ThemeToggle theme={theme} onToggle={() => setTheme(theme === "dark" ? "light" : "dark")} />
        </nav>
        <hr className="divider" />
        <div className={"tab-content" + (tab === "skills" ? " tab-content-bleed" : "")}>
          {tab === "chat" && <ChatView />}
          {tab === "skills" && <SkillsView />}
          {tab === "live" && <LiveView />}
          {tab === "guide" && <GuideView />}
        </div>
      </main>
      <DashboardKeyModal />
      {showOnboarding && <OnboardingView />}
    </div>
  );
}
