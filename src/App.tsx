import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { SkillsView } from "./components/SkillsView";
import { LiveView } from "./components/LiveView";
import { UsageView } from "./components/UsageView";
import { GuideView } from "./components/GuideView";
import { ScheduledRunsPanel } from "./components/ScheduledRunsPanel";
import { OnboardingView } from "./components/OnboardingView";
import { DashboardKeyModal } from "./components/DashboardKeyModal";
import { BrandLogo } from "./components/BrandLogo";
import { Icon, Spinner } from "./components/Icon";
import { AgentPicker } from "./components/AgentPicker";
import { brandName, dashboardUrl, discordUrl, latestReleaseUrl, repoApiUrl, repoUrl } from "./constants";
import { getPreviewMode, getPreviewTab } from "./preview";
import { humanBytes, proxyFraction, type AppTab, type Conversation } from "./types";
import { resolveTheme, type Theme } from "./theme";
import { flushAnalyticsEngagement, initAnalytics, trackEvent, trackScreenView } from "./lib/analytics";
import { isAppBackShortcut, isPrimaryAppTab, type PrimaryAppTab } from "./lib/appNavigation";
import { internalError } from "./lib/userFacingError";
import { invoke, listen } from "./electronBridge";
import { agentById } from "./agents";
import { UserFacingError } from "./components/UserFacingError";
import { AgentInstallLink } from "./components/AgentInstallLink";

const TABS: { id: AppTab; label: string; icon: string }[] = [
  { id: "chat", label: "Chat", icon: "bubble.left.and.bubble.right.fill" },
  { id: "live", label: "Live", icon: "video.fill" },
];

const PREVIEW_TABS = new Set<string>(["chat", "skills", "live", "usage", "guide", "scheduled"]);

interface AppUpdateStatus {
  status?: string;
  version?: string;
  percent?: number;
  message?: string;
}

// macOS in-place auto-update needs a signed + notarized build (Squirrel.Mac
// rejects unsigned updates). Until signing lands we still detect and surface
// the new version, but send users to the release page to update manually.
// Flip this to `false` once mac builds are signed to re-enable in-place updates.
const MANUAL_UPDATE = /Macintosh|Mac OS X/i.test(navigator.userAgent);

function updateAvailable(status?: AppUpdateStatus | null): boolean {
  return status?.status === "available" || status?.status === "downloaded" || status?.status === "downloading";
}

function updateLabel(status?: AppUpdateStatus | null): string {
  if (!status) return "Check for updates";
  if (status.status === "available") return `Update to ${status.version ?? "new version"}`;
  if (status.status === "downloading") return `Downloading ${status.percent ?? 0}%`;
  if (status.status === "downloaded") return `Restart to install ${status.version ?? "update"}`;
  if (status.status === "not-available") return "Up to date";
  if (status.status === "checking") return "Checking...";
  if (status.status === "disabled") return "Updates unavailable in this build";
  if (status.status === "error") return internalError("We couldn't update NextBrowser.");
  return "Check for updates";
}

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

function SettingsButton({ onClick, hasUpdate }: { onClick: () => void; hasUpdate?: boolean }) {
  return (
    <button
      className="settings-toggle plain-icon-btn"
      onClick={onClick}
      title={hasUpdate ? "Settings — update available" : "Settings"}
      aria-label={hasUpdate ? "Settings, update available" : "Settings"}
    >
      <Icon name="gearshape" size={18} />
      {hasUpdate && <span className="settings-update-dot" aria-hidden="true" />}
    </button>
  );
}

function GithubMark({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden focusable="false">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.02-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
    </svg>
  );
}

function DiscordMark({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
      <path d="M20.32 4.37A19.8 19.8 0 0 0 15.36 2.8a.08.08 0 0 0-.09.04c-.21.38-.45.88-.62 1.27a18.38 18.38 0 0 0-5.5 0 12.38 12.38 0 0 0-.63-1.27.08.08 0 0 0-.09-.04 19.73 19.73 0 0 0-4.96 1.57.07.07 0 0 0-.03.03C.31 9.1-.55 13.68-.13 18.21c0 .02.01.05.03.06a19.9 19.9 0 0 0 6.08 3.07.08.08 0 0 0 .09-.03c.47-.64.88-1.31 1.24-2.01a.08.08 0 0 0-.04-.11 13.04 13.04 0 0 1-1.9-.91.08.08 0 0 1-.01-.13c.13-.09.25-.19.37-.29a.08.08 0 0 1 .08-.01c3.98 1.82 8.3 1.82 12.24 0a.08.08 0 0 1 .08.01c.12.1.25.2.38.29a.08.08 0 0 1-.01.13c-.6.36-1.23.66-1.9.91a.08.08 0 0 0-.04.11c.36.7.77 1.37 1.24 2.01a.08.08 0 0 0 .09.03 19.84 19.84 0 0 0 6.08-3.07.08.08 0 0 0 .03-.06c.5-5.23-.84-9.77-3.63-13.81a.06.06 0 0 0-.03-.03ZM8.02 15.45c-1.2 0-2.18-1.1-2.18-2.45s.96-2.45 2.18-2.45c1.23 0 2.2 1.11 2.18 2.45 0 1.35-.96 2.45-2.18 2.45Zm7.96 0c-1.2 0-2.18-1.1-2.18-2.45s.96-2.45 2.18-2.45c1.23 0 2.2 1.11 2.18 2.45 0 1.35-.95 2.45-2.18 2.45Z" />
    </svg>
  );
}

function formatStars(count?: number | null): string {
  if (count == null) return "5";
  if (count < 1000) return `${count}`;
  const rounded = count < 10_000 ? Math.round(count / 100) / 10 : Math.round(count / 1000);
  return `${rounded}k`;
}

function GithubStarButton({ stars }: { stars?: number | null }) {
  const label = "Star NextBrowser on GitHub";
  return (
    <button
      className="social-button github-star-btn"
      onClick={() => window.open(repoUrl, "_blank", "noopener,noreferrer")}
      title={label}
      aria-label={label}
    >
      <GithubMark size={17} />
      <span className="github-star-count">
        <Icon name="star.fill" size={11} fill="currentColor" className="github-star-glyph" />
        {formatStars(stars)}
      </span>
    </button>
  );
}

function DiscordButton() {
  return (
    <button
      className="social-button discord-button"
      onClick={() => window.open(discordUrl, "_blank", "noopener,noreferrer")}
      title="Join NextBrowser on Discord"
      aria-label="Join NextBrowser on Discord"
    >
      <DiscordMark size={18} />
    </button>
  );
}

function SocialButtons() {
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(repoApiUrl, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { stargazers_count?: number } | null) => {
        if (typeof data?.stargazers_count === "number") setStars(data.stargazers_count);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <div className="social-buttons">
      <GithubStarButton stars={stars} />
      <DiscordButton />
    </div>
  );
}

function GlobalErrorNotice({ onClose }: { onClose: () => void }) {
  return (
    <div className="global-error-notice" role="alert">
      <Icon name="exclamationmark.triangle.fill" size={15} />
      <UserFacingError message={internalError()} surface="unexpected_app_error" />
      <button className="plain-icon-btn plain-icon-btn-compact" onClick={onClose} aria-label="Dismiss error">
        <Icon name="xmark" size={12} />
      </button>
    </div>
  );
}

function SettingsModal({
  onClose,
  onOpenUsage,
  focus,
  appUpdate,
  manualUpdate,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
  onOpenRelease,
}: {
  onClose: () => void;
  onOpenUsage: () => void;
  focus?: "agent" | null;
  appUpdate: AppUpdateStatus;
  manualUpdate: boolean;
  onCheckUpdate: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
  onOpenRelease: () => void;
}) {
  const [agentLogoutPending, setAgentLogoutPending] = useState(false);
  const nextctlVersion = useStore((s) => s.nextctlVersion);
  const agentId = useStore((s) => s.agentId);
  const agentReady = useStore((s) => s.agentReady());
  const agentVersion = useStore((s) => s.agentVersion());
  const agentError = useStore((s) => s.agentError());
  const agentLoggedIn = useStore((s) => s.agentLoggedIn());
  const authorizeAgent = useStore((s) => s.authorizeAgent);
  const loginAgent = useStore((s) => s.loginAgent);
  const logoutAgent = useStore((s) => s.logoutAgent);
  const profiles = useStore((s) => {
    const defaultKnown = !!s.defaultSession?.session?.name || (s.defaultSession?.status ?? "unknown") !== "unknown";
    const hasListedDefault = s.profiles.some((profile) => profile.name === "default");
    return s.profiles.length + (defaultKnown && !hasListedDefault ? 1 : 0);
  });
  const proxy = useStore((s) => s.proxy);
  const agentSpec = agentById(agentId);
  const agentName = agentSpec.name;
  const agentDetected = !!agentVersion;
  const agentNeedsLogin = agentDetected && agentLoggedIn === false;
  const proxyUsed = proxy ? humanBytes(proxy.used_bytes) : "Locked";
  const proxyLimit = proxy?.limit_bytes ? humanBytes(proxy.limit_bytes) : proxy ? "unlimited" : "Sign in";
  const proxyPercent = proxy?.limited ? Math.round(proxyFraction(proxy) * 100) : null;
  const handleAgentLogout = async () => {
    if (agentLogoutPending) return;
    setAgentLogoutPending(true);
    try {
      await logoutAgent();
    } finally {
      setAgentLogoutPending(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-card settings-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <Icon name="gearshape" size={18} />
          <div>
            <strong>Settings</strong>
            <div className="muted small">Local app and runtime status</div>
          </div>
          <span className="spacer" />
          <button className="plain-icon-btn" onClick={onClose} title="Close" aria-label="Close settings">
            <Icon name="xmark" size={17} className="error" />
          </button>
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
            <div className="settings-version-cell">
              <button
                className="plain-icon-btn plain-icon-btn-compact"
                onClick={onCheckUpdate}
                disabled={appUpdate.status === "checking" || appUpdate.status === "downloading"}
                title="Check for updates"
                aria-label="Check for updates"
              >
                {appUpdate.status === "checking" ? <Spinner size={12} /> : <Icon name="arrow.clockwise" size={12} />}
              </button>
              <strong>{__APP_VERSION__}</strong>
            </div>
          </div>
          <div className="settings-row settings-update-row">
            <span className="muted small">App update</span>
            <div className="settings-update-cell">
              <strong className={updateAvailable(appUpdate) ? "warn" : ""}>
                {appUpdate.status === "error"
                  ? <UserFacingError message={updateLabel(appUpdate)} surface="app_update" />
                  : updateLabel(appUpdate)}
              </strong>
              {manualUpdate ? (
                updateAvailable(appUpdate) ? (
                  <button className="mini primary-mini" onClick={onOpenRelease}>
                    Open release page
                  </button>
                ) : null
              ) : (
                <>
                  {appUpdate.status === "available" && (
                    <button className="mini" onClick={onDownloadUpdate}>
                      Download
                    </button>
                  )}
                  {appUpdate.status === "downloaded" && (
                    <button className="mini primary-mini" onClick={onInstallUpdate}>
                      Restart and update
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="settings-row">
            <span className="muted small">nextctl</span>
            <strong>{nextctlVersion || "not detected"}</strong>
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
          <div className={"settings-agent-card" + (focus === "agent" ? " settings-agent-card-focused" : "")}>
            <div className="settings-agent-head">
              <span className="settings-feature-icon">
                <Icon name="cpu.fill" size={17} />
              </span>
              <span className="settings-feature-copy">
                <strong>Agent</strong>
                <span className="muted small">Choose the local agent used for chats, skills, and scheduled runs.</span>
              </span>
              <span className={"agent-state-pill" + (agentReady ? " is-ready" : "")}>
                {agentReady ? "Ready" : agentNeedsLogin ? "Login required" : "Offline"}
              </span>
            </div>
            <div className="settings-agent-picker-row">
              <AgentPicker label="Active" />
              <span className="muted small">
                {agentReady ? agentVersion || "connected" : agentNeedsLogin ? `${agentName} is signed out` : `${agentName} is not connected`}
              </span>
            </div>
            <div className="settings-agent-actions">
              {!agentDetected && (
                <button className="mini primary-mini" title={`Connect ${agentName}`} onClick={() => authorizeAgent()}>
                  Connect
                </button>
              )}
              {agentDetected && agentLoggedIn !== true && !agentLogoutPending && (
                <button className="mini" title={`Open ${agentName} login`} onClick={() => loginAgent()}>
                  Login
                </button>
              )}
              {agentDetected && agentLogoutPending && (
                <button className="mini" disabled aria-live="polite">
                  <Spinner size={12} /> Signing out…
                </button>
              )}
              {agentReady && agentLoggedIn === true && !agentLogoutPending && agentById(agentId).logoutArgs.length > 0 && (
                <button className="mini" title={`Sign out of ${agentName}`} onClick={() => void handleAgentLogout()}>
                  Log out
                </button>
              )}
            </div>
            {agentError && (
              <div className="error small settings-agent-error">
                <UserFacingError message={agentError} surface="agent_settings" />
                <AgentInstallLink agent={agentSpec} error={agentError} surface="agent_settings" />
              </div>
            )}
          </div>
          <button
            className="settings-feature-link"
            onClick={() => {
              onOpenUsage();
              onClose();
            }}
          >
            <span className="settings-feature-icon">
              <Icon name="chart.bar.fill" size={17} />
            </span>
            <span className="settings-feature-copy">
              <strong>Proxy usage</strong>
              <span className="muted small">
                {proxy ? `${proxyUsed} / ${proxyLimit}` : "Traffic, allocation, and usage history"}
              </span>
            </span>
            {proxyPercent != null && <span className="status-pill">{proxyPercent}%</span>}
            <Icon name="chevron.right" size={14} className="muted" />
          </button>
        </div>

      </div>
    </div>
  );
}

function AppUpdatePrompt({
  status,
  manual,
  onLater,
  onDownload,
  onInstall,
  onOpenRelease,
}: {
  status: AppUpdateStatus;
  manual: boolean;
  onLater: () => void;
  onDownload: () => void;
  onInstall: () => void;
  onOpenRelease: () => void;
}) {
  const downloading = status.status === "downloading";
  const downloaded = status.status === "downloaded";
  return (
    <div className="modal-overlay">
      <div className="modal-card update-prompt">
        <div className="modal-title-row">
          <Icon name="sparkles" size={18} className="warn" />
          <div>
            <strong>New NextBrowser version available</strong>
            <div className="muted small">
              {status.version ? `Version ${status.version} is ready.` : "A newer build is available."}
            </div>
          </div>
        </div>
        <p className="muted">
          {manual
            ? "Open the releases page to download and install the new version."
            : downloaded
              ? "The update is downloaded. Restart to finish installing."
              : downloading
                ? "Downloading the update — you can keep working."
                : "Update now, or keep working and install it later from Settings."}
        </p>
        <div className="row settings-actions">
          <button className="secondary" onClick={onLater}>Later</button>
          <span className="spacer" />
          {manual ? (
            <button className="primary" onClick={onOpenRelease}>Open release page</button>
          ) : (
            <button
              className="primary"
              disabled={downloading}
              onClick={downloaded ? onInstall : onDownload}
            >
              {downloaded
                ? "Restart and update"
                : downloading
                  ? `Downloading ${status.percent ?? 0}%`
                  : "Download update"}
            </button>
          )}
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
  const [settingsFocus, setSettingsFocus] = useState<"agent" | null>(null);
  const [appUpdate, setAppUpdate] = useState<AppUpdateStatus>({ status: "idle" });
  const [updatePromptDismissed, setUpdatePromptDismissed] = useState(false);
  const [unexpectedError, setUnexpectedError] = useState(false);
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
  const didTrackThemeChange = useRef(false);
  const lastPrimaryTab = useRef<PrimaryAppTab>(isPrimaryAppTab(tab) ? tab : "chat");
  useButtonTooltips();

  useEffect(() => {
    const showUnexpectedError = () => setUnexpectedError(true);
    window.addEventListener("error", showUnexpectedError);
    window.addEventListener("unhandledrejection", showUnexpectedError);
    return () => {
      window.removeEventListener("error", showUnexpectedError);
      window.removeEventListener("unhandledrejection", showUnexpectedError);
    };
  }, []);

  const checkAppUpdate = () => {
    void invoke<AppUpdateStatus>("app_check_for_update").then(setAppUpdate).catch(() => {
      setAppUpdate({ status: "error", message: internalError("We couldn't check for updates.") });
    });
  };
  const downloadAppUpdate = () => {
    void invoke<AppUpdateStatus>("app_download_update").then(setAppUpdate).catch(() => {
      setAppUpdate({ status: "error", message: internalError("We couldn't download the update.") });
    });
  };
  const installAppUpdate = () => {
    void invoke<boolean>("app_install_update").catch(() => {
      setAppUpdate({ status: "error", message: internalError("We couldn't install the update.") });
    });
  };
  const openLatestRelease = () => {
    trackEvent("app_update_open_release", { version: appUpdate.version ?? undefined });
    window.open(latestReleaseUrl, "_blank", "noopener,noreferrer");
  };
  const openSettings = (focus: "agent" | null = null) => {
    setSettingsFocus(focus);
    setSettingsOpen(true);
  };
  const closeSettings = () => {
    setSettingsOpen(false);
    setSettingsFocus(null);
  };

  useEffect(() => {
    if (isPrimaryAppTab(tab)) lastPrimaryTab.current = tab;
  }, [tab]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !isAppBackShortcut(event)
        || event.defaultPrevented
        || event.repeat
        || event.isComposing
      ) return;

      if (settingsOpen) {
        event.preventDefault();
        setSettingsOpen(false);
        setSettingsFocus(null);
        return;
      }

      if (document.querySelector(".modal-overlay") || isPrimaryAppTab(tab)) return;

      event.preventDefault();
      setTab(lastPrimaryTab.current);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen, setTab, tab]);

  useEffect(() => {
    initAnalytics();
    void invoke<AppUpdateStatus>("app_update_status").then(setAppUpdate).catch(() => undefined);
    trackScreenView(tab, { source: "app_start" }, { pageView: false });
    trackEvent("app_start", {
      preview_mode: preview ?? "none",
      theme,
    });
    let cleanup: (() => void) | undefined;
    void listen<AppUpdateStatus>("app:update", (event) => {
      setAppUpdate(event.payload);
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
    if (!didTrackThemeChange.current) {
      didTrackThemeChange.current = true;
      return;
    }
    trackEvent("theme_changed", { theme });
  }, [theme]);

  useEffect(() => {
    if (preview === "login") {
      useStore.setState({ checking: false, authed: false });
      return;
    }
    if (preview === "onboarding") {
      useStore.setState({
        checking: false,
        authed: false,
        showOnboarding: true,
        nextctlVersion: "1.0.0",
        profiles: [],
        statuses: {},
        defaultSession: undefined,
        proxy: undefined,
      });
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
          title: "Proxy verification",
          createdAt: Date.now() - 86400000,
          updatedAt: Date.now() - 7200000,
          messages: [],
        },
      ];
      const previewUsage = [
        620_000_000,
        715_000_000,
        802_000_000,
        914_000_000,
        986_000_000,
        1_025_000_000,
        1_112_000_000,
        1_200_000_000,
      ].map((usedBytes, index) => ({
        id: `preview-usage-${index}`,
        date: Date.now() - (7 - index) * 86_400_000,
        usedBytes,
        limitBytes: 5_000_000_000,
      }));
      useStore.setState({
        checking: false,
        authed: true,
        nextctlVersion: "1.0.0",
        nextctlSupportsSkill: true,
        agentId: "claude",
        conversations: previewConvs,
        usageHistory: previewUsage,
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
          <SocialButtons />
          <SettingsButton onClick={() => openSettings()} hasUpdate={updateAvailable(appUpdate)} />
          <ThemeToggle theme={theme} onToggle={() => setTheme(theme === "dark" ? "light" : "dark")} />
        </div>
        {settingsOpen && (
          <SettingsModal
            onClose={closeSettings}
            onOpenUsage={() => setTab("usage")}
            focus={settingsFocus}
            appUpdate={appUpdate}
            manualUpdate={MANUAL_UPDATE}
            onCheckUpdate={checkAppUpdate}
            onDownloadUpdate={downloadAppUpdate}
            onInstallUpdate={installAppUpdate}
            onOpenRelease={openLatestRelease}
          />
        )}
        <div className="splash">
          <BrandLogo size={76} />
          <div className="splash-title">{brandName}</div>
          <Spinner size={18} />
          <div className="muted small">Checking saved credentials…</div>
        </div>
        {unexpectedError && <GlobalErrorNotice onClose={() => setUnexpectedError(false)} />}
      </>
    );
  }

  return (
    <div className="app">
      <aside
        className={"sidebar thin-material" + (sidebarCollapsed ? " sidebar-collapsed" : "")}
        style={{ width: sidebarCollapsed ? 68 : sidebarWidth }}
      >
        <Sidebar onOpenAgentSettings={() => openSettings("agent")} onHome={() => setTab("chat")} />
      </aside>
      {!sidebarCollapsed && <div id="sidebar-resize" className="resize-handle" />}
      <main className="content">
        <nav className="tabbar">
          {!isPrimaryAppTab(tab) && (
            <button
              className="tabbar-back"
              type="button"
              onClick={() => setTab(lastPrimaryTab.current)}
              title={`Back to ${lastPrimaryTab.current === "live" ? "Live" : "Chat"} · Esc`}
              aria-label={`Back to ${lastPrimaryTab.current === "live" ? "Live" : "Chat"}`}
            >
              <Icon name="chevron.left" size={18} strokeWidth={2.25} />
            </button>
          )}
          <div className="tabbar-group" role="tablist" aria-label="Main views">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={"tab-hit" + (tab === t.id ? " tab-hit-active" : "")}
                onClick={() => setTab(t.id)}
                data-tooltip={t.label}
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
            <SocialButtons />
            <SettingsButton onClick={() => openSettings()} hasUpdate={updateAvailable(appUpdate)} />
            <ThemeToggle theme={theme} onToggle={() => setTheme(theme === "dark" ? "light" : "dark")} />
          </div>
        </nav>
        <hr className="divider" />
        <div className={"tab-content" + (tab === "skills" ? " tab-content-bleed" : "")}>
          {tab === "chat" && <ChatView />}
          {tab === "skills" && <SkillsView onOpenAgentSettings={() => openSettings("agent")} />}
          {tab === "live" && <LiveView />}
          {tab === "usage" && <UsageView />}
          {tab === "guide" && <GuideView onOpenAgentSettings={() => openSettings("agent")} />}
          {tab === "scheduled" && (
            <div className="page scheduled-page">
              <ScheduledRunsPanel asPage />
            </div>
          )}
        </div>
      </main>
      {settingsOpen && (
        <SettingsModal
          onClose={closeSettings}
          onOpenUsage={() => setTab("usage")}
          focus={settingsFocus}
          appUpdate={appUpdate}
          manualUpdate={MANUAL_UPDATE}
          onCheckUpdate={checkAppUpdate}
          onDownloadUpdate={downloadAppUpdate}
          onInstallUpdate={installAppUpdate}
          onOpenRelease={openLatestRelease}
        />
      )}
      {updateAvailable(appUpdate) && !updatePromptDismissed && !settingsOpen && (
        <AppUpdatePrompt
          status={appUpdate}
          manual={MANUAL_UPDATE}
          onLater={() => setUpdatePromptDismissed(true)}
          onDownload={downloadAppUpdate}
          onInstall={installAppUpdate}
          onOpenRelease={openLatestRelease}
        />
      )}
      <DashboardKeyModal />
      {showOnboarding && <OnboardingView />}
      {unexpectedError && <GlobalErrorNotice onClose={() => setUnexpectedError(false)} />}
    </div>
  );
}
