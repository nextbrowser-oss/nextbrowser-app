import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { brandName, dashboardUrl, discordUrl, latestReleaseUrl, repoUrl } from "./constants";
import { trafficAllowanceBytes, trafficAllowanceFraction } from "./lib/trafficGate";
import { getPreviewMode, getPreviewTab } from "./preview";
import { humanBytes, type AppTab, type Conversation } from "./types";
import { resolveTheme, type Theme } from "./theme";
import { flushAnalyticsEngagement, initAnalytics, trackEvent, trackScreenView } from "./lib/analytics";
import {
  appTabLabel,
  isAppBackShortcut,
  isPrimaryAppTab,
  popPreviousAppTab,
  previousAppTab,
  recordPreviousAppTab,
} from "./lib/appNavigation";
import { errorReference } from "./lib/userFacingError";
import { invoke, listen } from "./electronBridge";
import { agentById } from "./agents";
import { releaseDownloadUrl } from "./lib/releaseDownload";
import { UserFacingError } from "./components/UserFacingError";
import { AgentConnectionGate } from "./components/AgentConnectionGate";
import { WorkspaceSetupGate } from "./components/WorkspaceSetupGate";
import { AgentInstallLink } from "./components/AgentInstallLink";
import { ConnectorsView } from "./components/ConnectorsView";
import { AutomationStudio } from "./components/AutomationStudio";

const TABS: { id: AppTab; label: string; icon?: string }[] = [
  { id: "chat", label: "Project", icon: "folder" },
  { id: "live", label: "Live", icon: "video.fill" },
  { id: "automation", label: "Automation", icon: "arrow.triangle.branch" },
];

const PREVIEW_TABS = new Set<string>(["chat", "automation", "skills", "connectors", "live", "usage", "guide", "scheduled"]);

interface AppUpdateStatus {
  status?: string;
  version?: string;
  percent?: number;
  message?: string;
}

interface BrowserRuntimeInstallStatus {
  runtime?: "clawbrowser" | "dasbrowser" | "camoufox";
  status?: "idle" | "downloading" | "installing" | "ready" | "failed";
  requestId?: string;
}

interface BrowserRuntimeUpdateEntry {
  runtime: "clawbrowser" | "dasbrowser" | "camoufox";
  name: string;
  status: "available" | "up-to-date" | "not-installed" | "unknown" | "error";
  currentVersion?: string;
  latestVersion?: string;
  releasePage: string;
  error?: string;
}

interface BrowserRuntimeUpdateStatus {
  status: "idle" | "checking" | "ready" | "partial" | "error";
  checkedAt?: number;
  message?: string;
  runtimes: BrowserRuntimeUpdateEntry[];
}

interface BrowserRuntimeUpdateInstallStatus {
  status: "idle" | "installing" | "ready" | "partial" | "failed";
  runtimes?: BrowserRuntimeUpdateEntry["runtime"][];
  completed?: BrowserRuntimeUpdateEntry["runtime"][];
  currentRuntime?: BrowserRuntimeUpdateEntry["runtime"];
  currentName?: string;
  currentVersion?: string;
  total?: number;
  progress?: number;
  message?: string;
  errors?: { runtime: BrowserRuntimeUpdateEntry["runtime"]; name: string; message: string }[];
}

const APP_UPDATE_ERROR = "We couldn't update NextBrowser. Please retry again.";

function BrowserRuntimeInstallModal({ status, onCancel }: { status: BrowserRuntimeInstallStatus; onCancel: () => void }) {
  const name = status.runtime === "dasbrowser" ? "DasBrowser" : status.runtime === "camoufox" ? "Camoufox" : "ClawBrowser";
  const installing = status.status === "installing";
  return (
    <div className="browser-install-overlay" role="status" aria-live="polite">
      <div className="modal-card browser-install-modal" aria-labelledby="browser-install-title">
        <div className="browser-install-mark"><Spinner size={22} /></div>
        <div className="browser-install-copy">
          <strong id="browser-install-title">{installing ? `Installing ${name}` : `Downloading ${name}`}</strong>
          <p className="muted small">
            {installing
              ? "Finishing the browser setup. This may take a moment."
              : `Preparing ${name} for its first profile. The download time depends on your connection.`}
          </p>
        </div>
        <div className="browser-install-progress" aria-hidden="true"><span /></div>
        <p className="muted browser-install-note">Keep NextBrowser open until setup is complete.</p>
        {status.requestId && <div className="modal-actions"><button className="secondary danger-text" type="button" onClick={onCancel}><Icon name="stop.fill" size={12} /> Stop download</button></div>}
      </div>
    </div>
  );
}

function BrowserRuntimeUpdatePrompt({ runtimes, onLater, onConfirm }: {
  runtimes: BrowserRuntimeUpdateEntry[];
  onLater: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-overlay">
      <div className="modal-card runtime-update-prompt" role="dialog" aria-modal="true" aria-labelledby="runtime-update-title">
        <div className="modal-title-row">
          <Icon name="arrow.down.circle" size={19} className="warn" />
          <div>
            <strong id="runtime-update-title">Browser toolset update available</strong>
            <div className="muted small">Choose when NextBrowser may install it.</div>
          </div>
        </div>
        <div className="runtime-update-prompt-list">
          {runtimes.map((runtime) => (
            <div className="runtime-update-prompt-row" key={runtime.runtime}>
              <strong>{runtime.name}</strong>
              <span className="muted small">{runtime.currentVersion ?? "Installed"} → {runtime.latestVersion}</span>
            </div>
          ))}
        </div>
        <p className="muted small">Installation starts only after you confirm and continues in the background. Keep NextBrowser open until it finishes.</p>
        <div className="row settings-actions">
          <button className="secondary" onClick={onLater}>Later</button>
          <span className="spacer" />
          <button className="primary" onClick={onConfirm}>Update {runtimes.length > 1 ? `${runtimes.length} toolsets` : "now"}</button>
        </div>
      </div>
    </div>
  );
}

function BrowserRuntimeUpdateProgress({ status, onClose }: {
  status: BrowserRuntimeUpdateInstallStatus;
  onClose: () => void;
}) {
  const installing = status.status === "installing";
  const failed = status.status === "failed";
  const partial = status.status === "partial";
  return (
    <div className="runtime-update-progress-card" role="status" aria-live="polite">
      <div className={"runtime-update-progress-mark" + (failed || partial ? " is-error" : !installing ? " is-ready" : "")}>
        {installing ? <Spinner size={18} /> : <Icon name={failed || partial ? "exclamationmark.triangle.fill" : "checkmark.circle.fill"} size={18} />}
      </div>
      <div className="runtime-update-progress-copy">
        <strong>{installing ? `Updating ${status.currentName ?? "browser toolsets"}` : failed ? "Update failed" : partial ? "Update partly complete" : "Browser toolsets updated"}</strong>
        <span className="muted small">{status.message}</span>
        {installing && <div className="runtime-update-progress-track"><span style={{ width: `${Math.max(4, status.progress ?? 0)}%` }} /></div>}
        {!!status.errors?.length && <span className="error small" title={status.errors.map((error) => `${error.name}: ${error.message}`).join("\n")}>{status.errors.map((error) => error.name).join(", ")} could not be updated.</span>}
      </div>
      {!installing && (
        <button className="plain-icon-btn plain-icon-btn-compact" onClick={onClose} aria-label="Dismiss update status">
          <Icon name="xmark" size={12} />
        </button>
      )}
    </div>
  );
}

// macOS in-place auto-update needs a signed + notarized build (Squirrel.Mac
// rejects unsigned updates). Until signing lands we still detect and surface
// the new version, but send users to the release page to update manually.
// Flip this to `false` once mac builds are signed to re-enable in-place updates.
const MANUAL_UPDATE = /Macintosh|Mac OS X/i.test(navigator.userAgent);

function updateAvailable(status?: AppUpdateStatus | null): boolean {
  return status?.status === "available" || status?.status === "downloaded" || status?.status === "downloading";
}

function browserRuntimeUpdateAvailable(status?: BrowserRuntimeUpdateStatus | null): boolean {
  return status?.runtimes.some((runtime) => runtime.status === "available") ?? false;
}

function browserRuntimeUpdateSignature(runtimes: BrowserRuntimeUpdateEntry[]): string {
  return runtimes
    .filter((runtime) => runtime.status === "available")
    .map((runtime) => `${runtime.runtime}:${runtime.latestVersion ?? "unknown"}`)
    .sort()
    .join("|");
}

function browserRuntimeUpdateLabel(runtime: BrowserRuntimeUpdateEntry): string {
  if (runtime.status === "available") return `${runtime.currentVersion ?? "Installed"} → ${runtime.latestVersion ?? "new version"}`;
  if (runtime.status === "up-to-date") return `${runtime.currentVersion ?? runtime.latestVersion ?? "Installed"} · Up to date`;
  if (runtime.status === "not-installed") return runtime.latestVersion ? `Not installed · Latest ${runtime.latestVersion}` : "Not installed";
  if (runtime.status === "error") return "Couldn't check";
  return runtime.currentVersion
    ? `${runtime.currentVersion} · Latest unknown`
    : runtime.latestVersion
      ? `Version unknown · Latest ${runtime.latestVersion}`
      : "Version unknown";
}

function updateLabel(status?: AppUpdateStatus | null): string {
  if (!status) return "Check for updates";
  if (status.status === "available") return `Update to ${status.version ?? "new version"}`;
  if (status.status === "downloading") return `Downloading ${status.percent ?? 0}%`;
  if (status.status === "downloaded") return `Restart to install ${status.version ?? "update"}`;
  if (status.status === "not-available") return "Up to date";
  if (status.status === "checking") return "Checking...";
  if (status.status === "disabled") return "Updates unavailable in this build";
  if (status.status === "error") return APP_UPDATE_ERROR;
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
  if (count == null) return "—";
  if (count < 1000) return `${count}`;
  const rounded = count < 10_000 ? Math.round(count / 100) / 10 : Math.round(count / 1000);
  return `${rounded}k`;
}

// The Electron host resolves GitHub → local on-disk cache → this fallback.
const GITHUB_STARS_FALLBACK = 17;

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
  const [stars, setStars] = useState<number>(GITHUB_STARS_FALLBACK);

  useEffect(() => {
    let cancelled = false;
    invoke<number | null>("github_stars")
      .then((count) => {
        if (!cancelled && typeof count === "number") {
          setStars(count);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="social-buttons">
      <GithubStarButton stars={stars} />
      <DiscordButton />
    </div>
  );
}

function GlobalErrorNotice({ error, onClose }: { error: { reference: string; detail: string }; onClose: () => void }) {
  return (
    <div className="global-error-notice" role="alert">
      <Icon name="exclamationmark.triangle.fill" size={15} />
      <span className="global-error-copy">
        <span title={error.detail}>
          <UserFacingError message={`Unexpected app error. Ref: ${error.reference}`} surface="unexpected_app_error" />
        </span>
      </span>
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
  browserRuntimeUpdates,
  manualUpdate,
  onCheckUpdate,
  onCheckBrowserRuntimeUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  onOpenRelease,
  onRequestBrowserRuntimeUpdate,
}: {
  onClose: () => void;
  onOpenUsage: () => void;
  focus?: "agent" | null;
  appUpdate: AppUpdateStatus;
  browserRuntimeUpdates: BrowserRuntimeUpdateStatus;
  manualUpdate: boolean;
  onCheckUpdate: () => void;
  onCheckBrowserRuntimeUpdates: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
  onOpenRelease: () => void;
  onRequestBrowserRuntimeUpdate: (runtime: BrowserRuntimeUpdateEntry) => void;
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
  const proxyAllowance = trafficAllowanceBytes(proxy);
  const proxyUsed = proxy ? humanBytes(proxy.used_bytes) : "Locked";
  const proxyLimit = proxyAllowance != null ? humanBytes(proxyAllowance) : proxy ? "unlimited" : "Sign in";
  const proxyPercent = proxy?.limited ? Math.round(trafficAllowanceFraction(proxy) * 100) : null;
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
                    Download update
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

        <div className="settings-section settings-runtime-section">
          <div className="settings-runtime-heading">
            <div>
              <strong>Browser toolsets</strong>
              <div className="muted small">Installed runtimes and latest official releases</div>
            </div>
            <button
              className="plain-icon-btn plain-icon-btn-compact"
              onClick={onCheckBrowserRuntimeUpdates}
              disabled={browserRuntimeUpdates.status === "checking"}
              title="Check browser toolset updates"
              aria-label="Check browser toolset updates"
            >
              {browserRuntimeUpdates.status === "checking" ? <Spinner size={12} /> : <Icon name="arrow.clockwise" size={12} />}
            </button>
          </div>
          <div className="settings-runtime-list">
            {browserRuntimeUpdates.runtimes.length === 0 && (
              <div className="settings-runtime-empty muted small">
                {browserRuntimeUpdates.status === "checking" ? "Checking installed toolsets…" : "Update information has not been checked yet."}
              </div>
            )}
            {browserRuntimeUpdates.runtimes.map((runtime) => (
              <div className="settings-runtime-row" key={runtime.runtime}>
                <span className={"settings-runtime-dot " + (runtime.status === "available" ? "is-update" : runtime.status === "error" ? "is-error" : runtime.status === "up-to-date" ? "is-ready" : "")} />
                <div className="settings-runtime-copy">
                  <strong>{runtime.name}</strong>
                  <span className={runtime.status === "available" ? "warn small" : "muted small"} title={runtime.error}>
                    {browserRuntimeUpdateLabel(runtime)}
                  </span>
                </div>
                {runtime.status === "available" && (
                  <button className="mini primary-mini" onClick={() => onRequestBrowserRuntimeUpdate(runtime)}>
                    Update
                  </button>
                )}
              </div>
            ))}
          </div>
          {browserRuntimeUpdates.status === "partial" && (
            <div className="muted small settings-runtime-note">Some update sources could not be reached. Installed runtimes are unaffected.</div>
          )}
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
            ? "Download and install the new version."
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
            <button className="primary" onClick={onOpenRelease}>Download update</button>
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

export function App() {
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(
    localStorage.getItem("nextbrowser.theme"),
    window.matchMedia("(prefers-color-scheme: light)").matches,
  ));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsFocus, setSettingsFocus] = useState<"agent" | null>(null);
  const [appUpdate, setAppUpdate] = useState<AppUpdateStatus>({ status: "idle" });
  const [browserRuntimeUpdates, setBrowserRuntimeUpdates] = useState<BrowserRuntimeUpdateStatus>({ status: "idle", runtimes: [] });
  const [updatePromptDismissed, setUpdatePromptDismissed] = useState(false);
  const [runtimeUpdatePrompt, setRuntimeUpdatePrompt] = useState<BrowserRuntimeUpdateEntry[]>();
  const [runtimeUpdatePromptDismissed, setRuntimeUpdatePromptDismissed] = useState("");
  const [runtimeUpdateInstall, setRuntimeUpdateInstall] = useState<BrowserRuntimeUpdateInstallStatus>({ status: "idle" });
  const [runtimeUpdateProgressHidden, setRuntimeUpdateProgressHidden] = useState(false);
  const [unexpectedError, setUnexpectedError] = useState<{ reference: string; detail: string }>();
  const [browserRuntimeInstall, setBrowserRuntimeInstall] = useState<BrowserRuntimeInstallStatus>();
  const [agentGateDismissed, setAgentGateDismissed] = useState(false);
  const preview = getPreviewMode();
  const checking = useStore((s) => s.checking);
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const bootstrap = useStore((s) => s.bootstrap);
  const showOnboarding = useStore((s) => s.showOnboarding);
  const agentReady = useStore((s) => s.agentReady());
  const workspaceSetupRequired = useStore((s) => {
    return s.authed && s.workspacesLoaded && s.workspaceSetupRequired;
  });
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const setAppActive = useStore((s) => s.setAppActive);
  const didTrackThemeChange = useRef(false);
  const tabHistory = useRef<AppTab[]>([]);
  const observedTab = useRef(tab);
  const pendingBackTarget = useRef<AppTab | null>(null);
  const [backTarget, setBackTarget] = useState<AppTab>();
  useEffect(() => {
    const showUnexpectedError = (event: ErrorEvent | PromiseRejectionEvent) => {
      const detail = event instanceof PromiseRejectionEvent
        ? event.reason instanceof Error ? event.reason.message : String(event.reason ?? "")
        : event.message;
      // Cloud project sync is best-effort. Authentication failures there are
      // not fatal app errors and should not cover the active chat.
      if (/project sync failed\s*\(\d+\)|unauthorized.*project/i.test(detail)) {
        console.warn("Background workspace sync failed:", detail);
        return;
      }
      const normalized = detail.trim() || "Unknown renderer error";
      const reference = errorReference(normalized);
      console.error(`[${reference}] Unexpected renderer error:`, normalized);
      setUnexpectedError({ reference, detail: normalized });
    };
    window.addEventListener("error", showUnexpectedError);
    window.addEventListener("unhandledrejection", showUnexpectedError);
    return () => {
      window.removeEventListener("error", showUnexpectedError);
      window.removeEventListener("unhandledrejection", showUnexpectedError);
    };
  }, []);

  useEffect(() => {
    const applyStatus = (status: BrowserRuntimeInstallStatus) => {
      if (status.status === "downloading" || status.status === "installing") {
        setBrowserRuntimeInstall(status);
      } else {
        setBrowserRuntimeInstall((current) => current?.runtime === status.runtime ? undefined : current);
      }
    };
    void invoke<BrowserRuntimeInstallStatus>("browser_runtime_install_status").then(applyStatus).catch(() => undefined);
    let cleanup: (() => void) | undefined;
    void listen<BrowserRuntimeInstallStatus>("browser-runtime:install", (event) => applyStatus(event.payload))
      .then((off) => { cleanup = off; })
      .catch(() => undefined);
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    if (!unexpectedError) return;
    const timer = window.setTimeout(() => setUnexpectedError(undefined), 8_000);
    return () => window.clearTimeout(timer);
  }, [unexpectedError]);

  const checkAppUpdate = () => {
    void invoke<AppUpdateStatus>("app_check_for_update").then(setAppUpdate).catch(() => {
      setAppUpdate({ status: "error", message: APP_UPDATE_ERROR });
    });
  };
  const checkBrowserRuntimeUpdates = () => {
    void invoke<BrowserRuntimeUpdateStatus>("browser_runtime_check_for_updates").then(setBrowserRuntimeUpdates).catch(() => {
      setBrowserRuntimeUpdates((current) => ({ ...current, status: "error", message: "We couldn't check browser toolset updates." }));
    });
  };
  const downloadAppUpdate = () => {
    void invoke<AppUpdateStatus>("app_download_update").then(setAppUpdate).catch(() => {
      setAppUpdate({ status: "error", message: APP_UPDATE_ERROR });
    });
  };
  const installAppUpdate = () => {
    void invoke<boolean>("app_install_update").catch(() => {
      setAppUpdate({ status: "error", message: APP_UPDATE_ERROR });
    });
  };
  const openLatestRelease = async () => {
    trackEvent("app_update_open_release", { version: appUpdate.version ?? undefined });
    let url = latestReleaseUrl;
    try {
      const info = await invoke<{ platform: string; arch: string }>("app_platform");
      url = releaseDownloadUrl(appUpdate.version, info.platform, info.arch);
    } catch {
      // Browser previews and unsupported builds fall back to the releases page.
    }
    await invoke("open_external", { url }).catch(() => {
      window.open(url, "_blank", "noopener,noreferrer");
    });
  };
  const requestBrowserRuntimeUpdate = (runtime: BrowserRuntimeUpdateEntry) => {
    setRuntimeUpdatePrompt([runtime]);
  };
  const dismissBrowserRuntimeUpdatePrompt = () => {
    if (runtimeUpdatePrompt) setRuntimeUpdatePromptDismissed(browserRuntimeUpdateSignature(runtimeUpdatePrompt));
    setRuntimeUpdatePrompt(undefined);
  };
  const installBrowserRuntimeUpdates = () => {
    const runtimes = runtimeUpdatePrompt?.map((runtime) => runtime.runtime) ?? [];
    if (!runtimes.length) return;
    setRuntimeUpdatePromptDismissed(browserRuntimeUpdateSignature(browserRuntimeUpdates.runtimes));
    setRuntimeUpdatePrompt(undefined);
    setRuntimeUpdateProgressHidden(false);
    void invoke<BrowserRuntimeUpdateInstallStatus>("browser_runtime_install_updates", { runtimes })
      .then(setRuntimeUpdateInstall)
      .catch((error) => setRuntimeUpdateInstall({
        status: "failed",
        runtimes,
        message: error instanceof Error ? error.message : "The browser toolset update could not be installed.",
      }));
  };
  const openSettings = (focus: "agent" | null = null) => {
    if (browserRuntimeUpdates.status === "idle") checkBrowserRuntimeUpdates();
    setSettingsFocus(focus);
    setSettingsOpen(true);
  };
  const closeSettings = () => {
    setSettingsOpen(false);
    setSettingsFocus(null);
  };

  useLayoutEffect(() => {
    const previousTab = observedTab.current;
    if (previousTab === tab) return;

    if (pendingBackTarget.current === tab) {
      pendingBackTarget.current = null;
    } else {
      tabHistory.current = recordPreviousAppTab(tabHistory.current, previousTab);
    }
    observedTab.current = tab;
    setBackTarget(previousAppTab(tabHistory.current));
  }, [tab]);

  const navigateBack = useCallback(() => {
    const navigation = popPreviousAppTab(tabHistory.current);
    if (!navigation.target) return;

    tabHistory.current = navigation.history;
    pendingBackTarget.current = navigation.target;
    setBackTarget(previousAppTab(navigation.history));
    setTab(navigation.target);
  }, [setTab]);

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

      if (
        document.querySelector(".modal-overlay")
        || isPrimaryAppTab(tab)
        || !backTarget
      ) return;

      event.preventDefault();
      navigateBack();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [backTarget, navigateBack, settingsOpen, tab]);

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
    void invoke<BrowserRuntimeUpdateStatus>("browser_runtime_update_status").then(setBrowserRuntimeUpdates).catch(() => undefined);
    let cleanup: (() => void) | undefined;
    void listen<BrowserRuntimeUpdateStatus>("browser-runtime:update", (event) => {
      setBrowserRuntimeUpdates(event.payload);
    }).then((off) => {
      cleanup = off;
    }).catch(() => undefined);
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    const applyStatus = (status: BrowserRuntimeUpdateInstallStatus) => {
      setRuntimeUpdateInstall(status);
      if (status.status === "installing") setRuntimeUpdateProgressHidden(false);
    };
    void invoke<BrowserRuntimeUpdateInstallStatus>("browser_runtime_update_install_status").then(applyStatus).catch(() => undefined);
    let cleanup: (() => void) | undefined;
    void listen<BrowserRuntimeUpdateInstallStatus>("browser-runtime:update-install", (event) => applyStatus(event.payload))
      .then((off) => { cleanup = off; })
      .catch(() => undefined);
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    const available = browserRuntimeUpdates.runtimes.filter((runtime) => runtime.status === "available");
    const signature = browserRuntimeUpdateSignature(available);
    if (runtimeUpdatePrompt) {
      const promptStillCurrent = runtimeUpdatePrompt.every((prompted) => available.some((runtime) => (
        runtime.runtime === prompted.runtime && runtime.latestVersion === prompted.latestVersion
      )));
      if (!promptStillCurrent) {
        setRuntimeUpdatePrompt(undefined);
        return;
      }
    }
    if (
      !available.length
      || runtimeUpdateInstall.status === "installing"
      || signature === runtimeUpdatePromptDismissed
      || runtimeUpdatePrompt
    ) return;
    setRuntimeUpdatePrompt(available);
  }, [browserRuntimeUpdates, runtimeUpdateInstall.status, runtimeUpdatePrompt, runtimeUpdatePromptDismissed]);

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
    void invoke("app_set_theme", { theme }).catch(() => undefined);
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
          workspaceId: "preview-workspace",
          createdAt: Date.now() - 3600000,
          updatedAt: Date.now() - 600000,
          messages: [],
        },
        {
          id: "preview-conv-2",
          agent: "claude",
          title: "Proxy verification",
          workspaceId: "preview-workspace",
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
        workspaces: [{
          id: "preview-workspace",
          name: "Amazon research",
          profileNames: [],
          profileToolsets: {},
          createdAt: Date.now() - 86_400_000,
          updatedAt: Date.now(),
        }],
        activeWorkspaceId: "preview-workspace",
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
    const minSidebarWidth = 320;
    const maxSidebarWidth = 520;
    let dragging = false;
    let startX = 0;
    let startW = sidebarWidth;
    let settleAnimation: Animation | undefined;
    const rubberband = (overshoot: number, dimension: number, constant = 0.42) =>
      (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
    const projectedWidth = (rawWidth: number) => {
      if (rawWidth < minSidebarWidth) return minSidebarWidth + rubberband(rawWidth - minSidebarWidth, minSidebarWidth);
      if (rawWidth > maxSidebarWidth) return maxSidebarWidth + rubberband(rawWidth - maxSidebarWidth, maxSidebarWidth);
      return rawWidth;
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      if (sidebarCollapsed) return;
      setSidebarWidth(projectedWidth(startW + (e.clientX - startX)));
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("is-resizing-sidebar");
      const currentWidth = useStore.getState().sidebarWidth;
      const targetWidth = Math.min(maxSidebarWidth, Math.max(minSidebarWidth, currentWidth));
      if (Math.abs(targetWidth - currentWidth) < 0.5) return;
      const sidebar = document.querySelector<HTMLElement>(".sidebar");
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      settleAnimation?.cancel();
      if (sidebar && !reduceMotion) {
        settleAnimation = sidebar.animate(
          [{ width: `${currentWidth}px` }, { width: `${targetWidth}px` }],
          { duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        );
      }
      setSidebarWidth(targetWidth);
    };
    const handle = document.getElementById("sidebar-resize");
    const onDown = (e: PointerEvent) => {
      const sidebar = document.querySelector<HTMLElement>(".sidebar");
      const liveWidth = sidebar?.getBoundingClientRect().width ?? useStore.getState().sidebarWidth;
      settleAnimation?.cancel();
      settleAnimation = undefined;
      dragging = true;
      startX = e.clientX;
      startW = liveWidth;
      setSidebarWidth(liveWidth);
      document.body.classList.add("is-resizing-sidebar");
      handle?.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    handle?.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      settleAnimation?.cancel();
      document.body.classList.remove("is-resizing-sidebar");
      handle?.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [checking, sidebarCollapsed, setSidebarWidth]);

    if (checking && preview !== "login" && preview !== "main" && preview !== "onboarding") {
    return (
      <>
        <div className="floating-controls">
          <SocialButtons />
          <SettingsButton onClick={() => openSettings()} hasUpdate={updateAvailable(appUpdate) || browserRuntimeUpdateAvailable(browserRuntimeUpdates)} />
          <ThemeToggle theme={theme} onToggle={() => setTheme(theme === "dark" ? "light" : "dark")} />
        </div>
        {settingsOpen && (
          <SettingsModal
            onClose={closeSettings}
            onOpenUsage={() => setTab("usage")}
            focus={settingsFocus}
            appUpdate={appUpdate}
            browserRuntimeUpdates={browserRuntimeUpdates}
            manualUpdate={MANUAL_UPDATE}
            onCheckUpdate={checkAppUpdate}
            onCheckBrowserRuntimeUpdates={checkBrowserRuntimeUpdates}
            onDownloadUpdate={downloadAppUpdate}
            onInstallUpdate={installAppUpdate}
            onOpenRelease={openLatestRelease}
            onRequestBrowserRuntimeUpdate={requestBrowserRuntimeUpdate}
          />
        )}
        <div className="splash">
          <BrandLogo size={76} />
          <div className="splash-title">{brandName}</div>
          <Spinner size={18} />
          <div className="muted small">Checking saved credentials…</div>
        </div>
        {runtimeUpdatePrompt && (
          <BrowserRuntimeUpdatePrompt
            runtimes={runtimeUpdatePrompt}
            onLater={dismissBrowserRuntimeUpdatePrompt}
            onConfirm={installBrowserRuntimeUpdates}
          />
        )}
        {runtimeUpdateInstall.status !== "idle" && !runtimeUpdateProgressHidden && (
          <BrowserRuntimeUpdateProgress status={runtimeUpdateInstall} onClose={() => setRuntimeUpdateProgressHidden(true)} />
        )}
        {unexpectedError && <GlobalErrorNotice error={unexpectedError} onClose={() => setUnexpectedError(undefined)} />}
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
      {!sidebarCollapsed && <div id="sidebar-resize" className="resize-handle" title="Resize sidebar" aria-label="Resize sidebar" />}
      <main className="content">
        <nav className="tabbar">
          {!isPrimaryAppTab(tab) && backTarget && (
            <button
              className="tabbar-back"
              type="button"
              onClick={navigateBack}
              title={`Back to ${appTabLabel(backTarget)} · Esc`}
              aria-label={`Back to ${appTabLabel(backTarget)}`}
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
                aria-label={`Open ${t.label}`}
              >
                <span className={"tab-pill" + (tab === t.id ? " tab-pill-active" : "")}>
                  {t.icon && <Icon name={t.icon} size={16} strokeWidth={2.25} />}
                  {t.label}
                </span>
              </button>
            ))}
          </div>
          <span className="tabbar-spacer" />
          <div className="tabbar-controls">
            <SocialButtons />
            <SettingsButton onClick={() => openSettings()} hasUpdate={updateAvailable(appUpdate) || browserRuntimeUpdateAvailable(browserRuntimeUpdates)} />
            <ThemeToggle theme={theme} onToggle={() => setTheme(theme === "dark" ? "light" : "dark")} />
          </div>
        </nav>
        <hr className="divider" />
        <div className={"tab-content" + (tab === "skills" ? " tab-content-bleed" : "")}>
          <div className={"persistent-tab-panel" + (tab === "chat" ? "" : " is-hidden")}>
            <ChatView />
          </div>
          {tab === "skills" && <SkillsView onOpenAgentSettings={() => openSettings("agent")} />}
          {tab === "automation" && <AutomationStudio />}
          {tab === "connectors" && <ConnectorsView />}
          <div className={"persistent-tab-panel" + (tab === "live" ? "" : " is-hidden")}>
            <LiveView active={tab === "live"} />
          </div>
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
          browserRuntimeUpdates={browserRuntimeUpdates}
          manualUpdate={MANUAL_UPDATE}
          onCheckUpdate={checkAppUpdate}
          onCheckBrowserRuntimeUpdates={checkBrowserRuntimeUpdates}
          onDownloadUpdate={downloadAppUpdate}
          onInstallUpdate={installAppUpdate}
          onOpenRelease={openLatestRelease}
          onRequestBrowserRuntimeUpdate={requestBrowserRuntimeUpdate}
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
      {runtimeUpdatePrompt && (
        <BrowserRuntimeUpdatePrompt
          runtimes={runtimeUpdatePrompt}
          onLater={dismissBrowserRuntimeUpdatePrompt}
          onConfirm={installBrowserRuntimeUpdates}
        />
      )}
      <DashboardKeyModal />
      {!checking && !agentReady && !agentGateDismissed && preview !== "main" && (
        <AgentConnectionGate onDismiss={() => setAgentGateDismissed(true)} />
      )}
      {showOnboarding && agentReady && !workspaceSetupRequired && <OnboardingView />}
      {!checking && agentReady && workspaceSetupRequired && <WorkspaceSetupGate />}
      {browserRuntimeInstall && <BrowserRuntimeInstallModal status={browserRuntimeInstall} onCancel={() => {
        if (browserRuntimeInstall.requestId) void invoke("nextctl_cancel", { requestId: browserRuntimeInstall.requestId });
        setBrowserRuntimeInstall(undefined);
      }} />}
      {runtimeUpdateInstall.status !== "idle" && !runtimeUpdateProgressHidden && (
        <BrowserRuntimeUpdateProgress status={runtimeUpdateInstall} onClose={() => setRuntimeUpdateProgressHidden(true)} />
      )}
      {unexpectedError && <GlobalErrorNotice error={unexpectedError} onClose={() => setUnexpectedError(undefined)} />}
    </div>
  );
}
