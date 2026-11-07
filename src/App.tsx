import { glassSurfaceClassName, IconButton, Tooltip } from "./shared/ui";
import { addPendingRuntimeInstall, downloadableBrowsers, runtimeInstalling } from "./lib/settingsUpdates";
import { RuntimeInstallationProgress } from "./components/RuntimeInstallationProgress";
import { BrowserRuntimeUpdatePrompt, ClawbrowserCloseProfilesPrompt, type BrowserRuntimeUpdateEntry } from "./components/BrowserRuntimeUpdatePrompt";
import { InstallationProgress, InstallationSpinner } from "./components/InstallationProgress";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { TitlebarActions } from "./components/DesktopShell";
import { CommunityControls } from "./components/CommunityControls";
import { MainViewNavigation } from "./components/MainViewNavigation";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { SkillsView } from "./components/SkillsView";
import { LiveView } from "./components/LiveView";
import { UsageView } from "./components/UsageView";
import { GuideView } from "./components/GuideView";
import { UtilityDialogs } from "./components/UtilityDialogs";
import { OnboardingView } from "./components/OnboardingView";
import { DashboardKeyModal } from "./components/DashboardKeyModal";
import { TrafficGateModal } from "./components/TrafficGateModal";
import { GitHubStarModal } from "./components/GitHubStarReward";
import { shouldAskForGitHubStar } from "./lib/githubStarReward";
import { ProfileCreateRequestModal } from "./components/ProfileCreateRequestModal";
import { BrandLogo } from "./components/BrandLogo";
import { Icon, Spinner } from "./components/Icon";
import { AgentPicker } from "./components/AgentPicker";
import { brandName, latestReleaseUrl } from "./constants";
import { trafficAllowanceBytes, trafficAllowanceFraction, trafficGateState, trafficGateStateLabel, trafficGateStateTone } from "./lib/trafficGate";
import { getPreviewMode, getPreviewNodeMavenState, getPreviewTab } from "./preview";
import { humanBytes, type AppTab, type Conversation } from "./types";
import { resolveTheme, type Theme } from "./theme";
import { confirmedBrowserRuntimeUpdates } from "./lib/browserRuntimeUpdate";
import { flushAnalyticsEngagement, initAnalytics, trackEvent, trackScreenView } from "./lib/analytics";
import {
  OPEN_AGENT_SETTINGS_EVENT,
  isUtilityDialogTab,
  appTabLabel,
  isAppBackShortcut,
  isPrimaryAppTab,
  popPreviousAppTab,
  previousAppTab,
  recordPreviousAppTab,
} from "./lib/appNavigation";
import { isBackgroundSyncFailure } from "./lib/userFacingError";
import { setErrorReportingView, unexpectedErrorDetail, unexpectedErrorReference } from "./lib/errorReporting";
import { deviceDataAppSetup } from "./lib/deviceData";
import { shouldDismissModalWithEscape, wrappedFocusTarget } from "./lib/modalKeyboard";
import { invoke, listen } from "./electronBridge";
import { agentById, isBuiltinAgent } from "./agents";
import { BuiltinAgentSetup } from "./components/BuiltinAgentSetup";
import { releaseDownloadUrl } from "./lib/releaseDownload";
import { UserFacingError } from "./components/UserFacingError";
import { AgentConnectionGate, agentGateVisible } from "./components/AgentConnectionGate";
import { WorkspaceSetupGate } from "./components/WorkspaceSetupGate";
import { AgentInstallLink } from "./components/AgentInstallLink";
import { DeviceDataSettings } from "./components/DeviceDataSettings";
import { SettingsPanel, SettingsRail } from "./components/SettingsSections";
import { SettingsUpdates } from "./components/SettingsUpdates";
import { availableRuntimeUpdates, latestRuntimeOperation, type AppUpdateStatus, type BrowserRuntimeUpdateStatus, type BrowserRuntimeUpdateInstallStatus } from "./lib/settingsUpdates";
import { settingsAttention, settingsSectionForUpdates, type SettingsSection } from "./lib/settingsSections";
import { AutomationStudio } from "./components/AutomationStudio";
import { FeedbackModal } from "./components/FeedbackModal";
import { feedbackPromptBlocked, feedbackPromptConfig, markFeedbackSubmitted, shouldPromptForFeedback } from "./lib/feedbackPrompt";
import { multiloginSelectionForWorkspace } from "./lib/multiloginSelection";
import { settingsStorage } from "./lib/settingsStorage";
import { countWorkspaceProfiles } from "./lib/workspaceProfiles";

const PREVIEW_TABS = new Set<string>(["chat", "automation", "skills", "connectors", "live", "usage", "guide", "scheduled"]);

interface BrowserRuntimeInstallStatus {
  runtime?: "clawbrowser" | "dasbrowser" | "camoufox";
  status?: "idle" | "downloading" | "installing" | "ready" | "failed";
  requestId?: string;
}


const APP_UPDATE_ERROR = "We couldn't update the Nextbrowser app. Please retry.";
const ERROR_REPORTING_HINT = "Sends crash and error details to Nextbrowser so problems can be fixed. Never includes page contents, typed text, cookies, or credentials.";

interface ErrorReportingStatus {
  enabled: boolean;
  available: boolean;
}

const UI_SCALE_MIN = 0.8;
const UI_SCALE_MAX = 1.3;
const UI_SCALE_STEP = 0.1;

function clampUiScale(value: number): number {
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(value * 100) / 100));
}

function UIScaleSlider({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  return (
    <>
      <Tooltip content="Decrease interface size"><button
        className="plain-icon-btn plain-icon-btn-compact"
        onClick={() => onChange(clampUiScale(value - UI_SCALE_STEP))}
        disabled={value <= UI_SCALE_MIN}
        aria-label="Decrease interface size"
      >
        <Icon name="minus" size={12} />
      </button></Tooltip>
      <span className="muted small ui-scale-value">{Math.round(value * 100)}%</span>
      <Tooltip content="Increase interface size"><button
        className="plain-icon-btn plain-icon-btn-compact"
        onClick={() => onChange(clampUiScale(value + UI_SCALE_STEP))}
        disabled={value >= UI_SCALE_MAX}
        aria-label="Increase interface size"
      >
        <Icon name="plus" size={12} />
      </button></Tooltip>
    </>
  );
}

function UIScaleControl({ value, onChange, onDismiss, inline = false }: { value: number; onChange: (next: number) => void; onDismiss: () => void; inline?: boolean }) {
  return (
    <Tooltip content="Interface size"><div className={"ui-scale-control" + (inline ? " ui-scale-control-inline" : "")}>
      <Icon name="magnifyingglass" size={inline ? 11 : 13} />
      <UIScaleSlider value={value} onChange={onChange} />
      <Tooltip content="Hide this control (it stays in Settings)"><button
        className="plain-icon-btn plain-icon-btn-compact ui-scale-dismiss"
        onClick={onDismiss}
        aria-label="Hide the interface size control"
      >
        <Icon name="xmark" size={11} />
      </button></Tooltip>
    </div></Tooltip>
  );
}

function browserRuntimeInstallName(status: BrowserRuntimeInstallStatus): string {
  return status.runtime === "dasbrowser" ? "DasBrowser" : status.runtime === "camoufox" ? "Camoufox" : "Clawbrowser";
}

function browserRuntimeInstallKey(status: BrowserRuntimeInstallStatus): string {
  return status.requestId || status.runtime || "browser";
}

function BrowserRuntimeInstallModal({ status, onCancel, onHide }: { status: BrowserRuntimeInstallStatus; onCancel: () => void; onHide: () => void }) {
  const name = browserRuntimeInstallName(status);
  const installing = status.status === "installing";
  return (
    <div className="browser-install-overlay" role="status" aria-live="polite">
      <div className="modal-card browser-install-modal" aria-labelledby="browser-install-title">
        <Tooltip content="Hide — the download keeps running"><button
          className="plain-icon-btn plain-icon-btn-compact background-card-hide"
          onClick={onHide}
          aria-label={`Hide ${name} download progress`}
        >
          <Icon name="xmark" size={12} />
        </button></Tooltip>
        <InstallationSpinner />
        <div className="browser-install-copy">
          <strong id="browser-install-title">{installing ? `Installing ${name}` : `Downloading ${name}`}</strong>
          <p className="muted small">
            {installing
              ? "Finishing the browser setup. This may take a moment."
              : `Preparing ${name} for its first profile. The download time depends on your connection.`}
          </p>
        </div>
        <InstallationProgress label={installing ? `Installing ${name}` : `Downloading ${name}`} />
        <p className="muted browser-install-note">Keep Nextbrowser open until setup is complete.</p>
        {status.requestId && <div className="modal-actions"><button className="secondary danger-text" type="button" onClick={onCancel}><Icon name="stop.fill" size={12} /> Stop download</button></div>}
      </div>
    </div>
  );
}


// A long download or update the user hid keeps a small chip in the top bar, so
// it is still visibly running and one click brings the full card back.
function BackgroundTaskPill({ label, onShow }: { label: string; onShow: () => void }) {
  return (
    <Tooltip content={`${label} — show progress`}><button type="button" className="background-task-pill" onClick={onShow}>
      <Spinner size={11} />
      <span>{label}</span>
    </button></Tooltip>
  );
}

function BrowserRuntimeUpdateProgress({ status, onClose, onCancel, onRetry, onOpenManualGuide }: {
  status: BrowserRuntimeUpdateInstallStatus;
  onClose: () => void;
  onCancel: (runtime?: BrowserRuntimeUpdateEntry["runtime"]) => void;
  onRetry: (runtimes: BrowserRuntimeUpdateEntry["runtime"][]) => void;
  onOpenManualGuide: (url?: string) => void;
}) {
  const installing = status.status === "installing";
  const failed = status.status === "failed";
  const partial = status.status === "partial";
  const needsAttention = failed || partial;
  const errors = status.errors ?? [];
  const retryRuntimes = status.runtimes ?? [];
  // A failure with no per-runtime detail (for example the initial update check
  // could not reach the network) still needs an actionable retry.
  const canRetry = failed && errors.length === 0 && retryRuntimes.length > 0;
  const card = (
    <div className={"runtime-update-progress-card" + (needsAttention ? " needs-attention" : "") + (installing ? " is-running" : "")} role="status" aria-live="polite">
      {installing ? <InstallationSpinner /> : (
        <div className={"runtime-update-progress-mark" + (needsAttention ? " is-error" : " is-ready")}>
          <Icon name={needsAttention ? "exclamationmark.triangle.fill" : "checkmark.circle.fill"} size={needsAttention ? 15 : 18} />
        </div>
      )}
      <div className="runtime-update-progress-copy">
        <strong>{installing ? `Updating ${status.currentName ?? "browser toolsets"}` : status.status === "cancelled" ? "Updates stopped" : failed ? "Update failed" : partial ? "Update partly complete" : "Browser toolsets updated"}</strong>
        <span className="muted small">{status.message}</span>
        {installing && <>
          {status.percent !== undefined && <span className="small">{status.percent}% downloaded</span>}
          <button className="mini" disabled={status.cancelRequested} onClick={() => onCancel()}>{status.cancelRequested ? "Stopping…" : status.items?.length ? "Stop all installations" : status.canCancel ? "Cancel update" : "Stop after this component"}</button>
        </>}
        {!!errors.length && (
          <div className="runtime-update-errors">
            {errors.map((error) => (
              <section className="runtime-update-error" key={error.runtime}>
                <div className="runtime-update-error-heading">
                  <span>{error.name} couldn’t update</span>
                  {error.code && <Tooltip content={error.code}><span className="runtime-update-error-code">{error.category ?? "Update could not finish"}</span></Tooltip>}
                </div>
                {/* The next step is what the user needs first; the raw message is
                    supporting detail, not the headline. */}
                <p className="runtime-update-recovery">{error.recovery ?? "Keep Nextbrowser open, then try again."}</p>
                <p className="muted small runtime-update-detail">{error.message}</p>
                <div className="row runtime-update-error-actions">
                  {error.retryable !== false && <button className="secondary small" onClick={() => onRetry([error.runtime])}>Retry {error.name}</button>}
                  <button className="secondary small" onClick={() => onOpenManualGuide(error.releasePage)}>Update manually</button>
                </div>
              </section>
            ))}
          </div>
        )}
        {canRetry && (
          <div className="row runtime-update-error-actions">
            <button className="secondary small" onClick={() => onRetry(retryRuntimes)}>Retry</button>
          </div>
        )}
        {needsAttention && <p className="runtime-update-requirements">Before retrying: keep Nextbrowser open, use a stable connection, make sure there is free disk space, and close any running browser toolset.</p>}
      </div>
      {/* Hiding never cancels: the update keeps running behind a top-bar chip. */}
      <Tooltip content={installing ? "Hide — the update keeps running" : "Dismiss"}><button
        className="plain-icon-btn plain-icon-btn-compact"
        onClick={onClose}
        aria-label={installing ? "Hide update progress" : "Dismiss update status"}
      >
        <Icon name="xmark" size={12} />
      </button></Tooltip>
      {!!status.items?.length && <div className="runtime-install-items">{status.items.map((item) => <RuntimeInstallationProgress key={item.runtime} item={item} onCancel={onCancel} />)}</div>}
      {installing && !status.items?.length && <InstallationProgress label={`Updating ${status.currentName ?? "browser toolsets"}`} percent={status.percent} />}
    </div>
  );
  // A transient status (installing, or a clean success) is ambient and stays
  // out of the way as a floating card. Once it needs a decision, give it a
  // real backdrop instead of floating on top of whatever else is open —
  // otherwise it visually collides with any other open modal.
  if (!needsAttention) return card;
  return (
    <div className="runtime-update-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      {card}
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
    .filter((runtime) => runtime.status === "available" || runtime.status === "not-installed")
    .map((runtime) => `${runtime.runtime}:${runtime.latestVersion ?? "unknown"}`)
    .sort()
    .join("|");
}

function updateLabel(status?: AppUpdateStatus | null): string {
  if (!status) return "Check for updates";
  if (status.status === "available") return `Update to ${status.version ?? "new version"}`;
  if (status.status === "downloading") return `Downloading ${status.percent ?? 0}%`;
  if (status.status === "downloaded") return `Restart to install ${status.version ?? "update"}`;
  if (status.status === "not-available") return "Up to date";
  if (status.status === "checking") return "Checking...";
  if (status.status === "disabled") return "Updates unavailable in this build";
  if (status.status === "error") {
    // Surface the updater's own reason when the main process provided one,
    // instead of a generic message that hides what actually failed.
    const detail = status.message?.trim();
    if (!detail || detail === APP_UPDATE_ERROR) return APP_UPDATE_ERROR;
    return `We couldn't update the Nextbrowser app: ${detail}`;
  }
  return "Check for updates";
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return <IconButton appearance="plain" size="small" className="theme-toggle" label={label} onClick={onToggle}>
    <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
  </IconButton>;
}

function SettingsButton({ onClick, hasUpdate }: { onClick: () => void; hasUpdate?: boolean }) {
  return (
    <Tooltip content={hasUpdate ? "Settings — update available" : "Settings"}><button
      className="settings-toggle plain-icon-btn"
      onClick={onClick}
      aria-label={hasUpdate ? "Settings, update available" : "Settings"}
    >
      <Icon name="gearshape" size={18} />
      {hasUpdate && <span className="settings-update-dot" aria-hidden="true" />}
    </button></Tooltip>
  );
}

function FeedbackButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip content="Send feedback (⌘⇧F on macOS, Ctrl+Shift+F on Windows/Linux)"><button
      className="social-button feedback-button"
      onClick={onClick}
      aria-label="Send feedback. Shortcut: Command or Control, Shift, F"
    >
      <Icon name="bubble.left.and.bubble.right.fill" size={17} />
      <span>Feedback</span>
    </button></Tooltip>
  );
}

function GlobalErrorNotice({ error, onClose }: { error: { reference: string; detail: string }; onClose: () => void }) {
  return (
    <div className="global-error-notice" role="alert">
      <Icon name="exclamationmark.triangle.fill" size={15} />
      <span className="global-error-copy">
        <Tooltip content={error.detail}><span>
          <UserFacingError message={`Unexpected app error. Ref: ${error.reference}`} surface="unexpected_app_error" />
        </span></Tooltip>
      </span>
      <button className="plain-icon-btn plain-icon-btn-compact" onClick={onClose} aria-label="Dismiss error">
        <Icon name="xmark" size={12} />
      </button>
    </div>
  );
}

function ManualReleaseDownload({ onOpen, version, onLater }: { onOpen: () => Promise<void>; version?: string; onLater?: () => void }) {
  const [downloadUrl, setDownloadUrl] = useState(latestReleaseUrl);
  useEffect(() => {
    let active = true;
    void invoke<{ platform: string; arch: string }>("app_platform")
      .then(({ platform, arch }) => { if (active) setDownloadUrl(releaseDownloadUrl(version, platform, arch)); })
      .catch(() => { if (active) setDownloadUrl(latestReleaseUrl); });
    return () => { active = false; };
  }, [version]);
  const [state, setState] = useState<"idle" | "opening" | "opened" | "error">("idle");
  const open = async () => {
    if (state === "opening") return;
    setState("opening");
    try { await onOpen(); setState("opened"); }
    catch { setState("error"); }
  };
  return <div className="manual-release-download">
    <div className="manual-release-actions">
      {onLater && <button className="secondary" autoFocus onClick={onLater}>Later</button>}
      <Tooltip content={downloadUrl}><button className={onLater ? "primary release-download-button" : "mini primary-mini release-download-button"} disabled={state === "opening"} onClick={() => void open()}>
        {state === "opening" && <Spinner size={12} />}
        {state === "opening" ? "Opening download…" : "Download update"}
      </button></Tooltip>
    </div>
    {state === "opened" && <p className="muted small" role="status">Download opened in your browser. When it finishes, open the DMG from Downloads and drag Nextbrowser into Applications.</p>}
    {state === "error" && <p className="error small" role="alert">Could not open the download. Please try again.</p>}
  </div>;
}

const DIALOG_FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function SettingsModal({
  onClose,
  section: requestedSection,
  appUpdate,
  browserRuntimeUpdates,
  runtimeOperation,
  bulkUpdating,
  bulkOutcome,
  onUpdateAll,
  onDownloadAllBrowsers,
  onShowProgress,
  onCancelUpdates,
  manualUpdate,
  onCheckUpdate,
  onCheckBrowserRuntimeUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  onOpenRelease,
  onRequestBrowserRuntimeUpdate,
  uiScale,
  onUiScaleChange,
  uiScaleFloatingHidden,
  onRestoreFloatingScale,
}: {
  onClose: () => void;
  section?: SettingsSection | null;
  appUpdate: AppUpdateStatus;
  browserRuntimeUpdates: BrowserRuntimeUpdateStatus;
  runtimeOperation: BrowserRuntimeUpdateInstallStatus;
  bulkUpdating: boolean;
  bulkOutcome?: string;
  onUpdateAll: () => void;
  onDownloadAllBrowsers: () => void;
  onShowProgress: () => void;
  onCancelUpdates: (runtime?: BrowserRuntimeUpdateEntry["runtime"]) => void;
  manualUpdate: boolean;
  onCheckUpdate: () => void;
  onCheckBrowserRuntimeUpdates: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
  onOpenRelease: () => Promise<void>;
  onRequestBrowserRuntimeUpdate: (runtime: BrowserRuntimeUpdateEntry) => void;
  uiScale: number;
  onUiScaleChange: (next: number) => void;
  uiScaleFloatingHidden: boolean;
  onRestoreFloatingScale: () => void;
}) {
  const [agentLogoutPending, setAgentLogoutPending] = useState(false);
  const [errorReporting, setErrorReporting] = useState<ErrorReportingStatus>();
  useEffect(() => {
    let active = true;
    void invoke<ErrorReportingStatus>("error_reporting_status")
      .then((status) => { if (active) setErrorReporting(status); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  const changeErrorReporting = (enabled: boolean) => {
    setErrorReporting((current) => current && { ...current, enabled });
    void invoke<ErrorReportingStatus>("error_reporting_set", { enabled })
      .then(setErrorReporting)
      .catch(() => setErrorReporting((current) => current && { ...current, enabled: !enabled }));
  };
  const nextctlVersion = useStore((s) => s.nextctlVersion);
  const nextctlUpdating = useStore((s) => s.nextctlUpdating);
  const nextctlUpdateError = useStore((s) => s.nextctlUpdateError);
  const nextctlUpdateStatus = useStore((s) => s.nextctlUpdateStatus);
  const checkNextctlUpdate = useStore((s) => s.checkNextctlUpdate);
  const agentId = useStore((s) => s.agentId);
  const agentReady = useStore((s) => s.agentReady());
  const agentVersion = useStore((s) => s.agentVersion());
  const agentError = useStore((s) => s.agentError());
  const agentLoggedIn = useStore((s) => s.agentLoggedIn());
  const authorizeAgent = useStore((s) => s.authorizeAgent);
  const loginAgent = useStore((s) => s.loginAgent);
  const logoutAgent = useStore((s) => s.logoutAgent);
  // The active workspace's profiles, as the sidebar counts them; the local
  // inventory also holds the profiles of every other workspace.
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const hasMultiloginProfile = !!multiloginSelectionForWorkspace(activeWorkspaceId);
  const profiles = useStore((s) => countWorkspaceProfiles(
    s.workspaces.find((workspace) => workspace.id === s.activeWorkspaceId),
    s.profiles,
    hasMultiloginProfile,
  ));
  const proxy = useStore((s) => s.proxy);
  const agentSpec = agentById(agentId);
  const agentName = agentSpec.name;
  const builtinAgent = isBuiltinAgent(agentSpec);
  const agentDetected = !!agentVersion;
  const agentNeedsLogin = agentDetected && agentLoggedIn === false;
  const proxyAllowance = trafficAllowanceBytes(proxy);
  const proxyUsed = proxy ? humanBytes(proxy.used_bytes) : "Locked";
  const proxyLimit = proxyAllowance != null ? humanBytes(proxyAllowance) : proxy ? "unlimited" : "Sign in";
  const proxyPercent = proxy?.limited ? Math.round(trafficAllowanceFraction(proxy) * 100) : null;
  // A paused account has nothing left of the 1 GiB it is shown; say so instead of the share used.
  const proxyPaused = trafficGateState(proxy) === "blocked";
  const handleAgentLogout = async () => {
    if (agentLogoutPending) return;
    setAgentLogoutPending(true);
    try {
      await logoutAgent();
    } finally {
      setAgentLogoutPending(false);
    }
  };

  const [section, setSection] = useState<SettingsSection>(requestedSection ?? "general");
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageVisited, setUsageVisited] = useState(false);
  useEffect(() => {
    if (requestedSection) setSection(requestedSection);
  }, [requestedSection]);
  const attention = settingsAttention({
    appUpdate: updateAvailable(appUpdate),
    toolsetUpdate: browserRuntimeUpdateAvailable(browserRuntimeUpdates),
    agentReady,
    agentNeedsLogin,
    builtinAgent,
    proxyTone: trafficGateStateTone(proxy),
  });

  // Focus starts on the open section's tab and Tab stays inside the dialog;
  // closing it returns focus to the control that opened it.
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    const keepFocusInside = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (event.key !== "Tab" || !dialog) return;
      // A dialog opened over Settings (a toolset update, the agent gate) and
      // the agent picker's list, drawn outside the dialog, keep their focus.
      const modals = document.querySelectorAll('[aria-modal="true"]');
      if (modals[modals.length - 1] !== dialog) return;
      const active = document.activeElement;
      const inside = !!active && dialog.contains(active);
      if (!inside && active && active !== document.body) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE)).filter((element) => element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const target = wrappedFocusTarget(focusable, active instanceof HTMLElement ? active : null, inside, event.shiftKey);
      if (!target) return;
      event.preventDefault();
      target.focus();
    };
    document.addEventListener("keydown", keepFocusInside);
    return () => {
      document.removeEventListener("keydown", keepFocusInside);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <div className="modal-overlay settings-overlay" onMouseDown={onClose}>
      <div ref={dialogRef} className={"modal-card settings-modal" + (section === "proxy" && usageOpen ? " has-usage" : "")} role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <strong id="settings-title">Settings</strong>
          <Tooltip content="Close"><button className="plain-icon-btn" onClick={onClose} aria-label="Close settings">
            <Icon name="xmark" size={16} />
          </button></Tooltip>
        </div>
        <div className="settings-layout">
          <SettingsRail section={section} attention={attention} onSelect={setSection} />

          <SettingsPanel section={section}>
            {section === "general" && (
              <div className="settings-group">
                <div className="settings-row"><span className="muted small">Nextbrowser</span><strong>{__APP_VERSION__}</strong></div>
                <button className="settings-feature-link" onClick={() => setSection("updates")}>
                  <Icon name="arrow.down.circle" size={17} /><span className="settings-feature-copy"><strong>Versions and updates</strong><span className="muted small">All components and Update all</span></span><Icon name="chevron.right" size={14} />
                </button>
                <div className="settings-row">
                  <span className="muted small">Interface size</span>
                  <div className="ui-scale-control ui-scale-control-settings">
                    <UIScaleSlider value={uiScale} onChange={onUiScaleChange} />
                    {uiScaleFloatingHidden && <Tooltip content="Return the quick-access control to the main screen"><button className="plain-icon-btn plain-icon-btn-compact" onClick={onRestoreFloatingScale} aria-label="Return the interface-size quick-access control to the main screen"><Icon name="arrow.uturn.left" size={12} /></button></Tooltip>}
                  </div>
                </div>
              </div>
            )}

            {section === "updates" && (
              <SettingsUpdates
                appVersion={__APP_VERSION__} appUpdate={appUpdate}
                appLabel={appUpdate.status === "error" ? <UserFacingError message={updateLabel(appUpdate)} surface="app_update" /> : updateLabel(appUpdate)}
                appActions={manualUpdate ? (updateAvailable(appUpdate) ? <ManualReleaseDownload onOpen={onOpenRelease} version={appUpdate.version} /> : null) : <>
                  {appUpdate.status === "available" && <button className="mini primary-mini" disabled={bulkUpdating || runtimeOperation.status === "installing" || nextctlUpdating} onClick={onDownloadUpdate}>Download</button>}
                  {appUpdate.status === "downloaded" && <button className="mini primary-mini" disabled={bulkUpdating || runtimeOperation.status === "installing" || nextctlUpdating} onClick={onInstallUpdate}>Restart and update</button>}
                </>}
                runtimes={browserRuntimeUpdates} operation={runtimeOperation}
                nextctlVersion={nextctlVersion} cliUpdating={nextctlUpdating} cliError={nextctlUpdateError} cliStatus={nextctlUpdateStatus}
                agentName={agentName} agentVersion={agentVersion || ""}
                bulkUpdating={bulkUpdating} bulkOutcome={bulkOutcome}
                onCheck={() => { onCheckUpdate(); onCheckBrowserRuntimeUpdates(); }}
                onUpdateAll={onUpdateAll} onDownloadAll={onDownloadAllBrowsers} onUpdateCli={() => { void checkNextctlUpdate(0, { manual: true }); }}
                onUpdateRuntime={onRequestBrowserRuntimeUpdate} onShowProgress={onShowProgress} onCancel={onCancelUpdates}
              />
            )}

            {section === "privacy" && (
              <>
                {errorReporting && (
                  <div className="settings-group">
                    <div className="settings-row">
                      <span className="small">Send error reports</span>
                      <Tooltip content={errorReporting.available ? ERROR_REPORTING_HINT : "Development builds do not send error reports."}><label className="toggle">
                        <input
                          type="checkbox"
                          aria-label="Send error reports"
                          checked={errorReporting.enabled}
                          onChange={(event) => changeErrorReporting(event.target.checked)}
                        />
                        <span className="toggle-track"><span className="toggle-knob" /></span>
                      </label></Tooltip>
                    </div>
                    <p className="muted small settings-group-note">
                      {ERROR_REPORTING_HINT}
                      {!errorReporting.available && " Development builds do not send error reports."}
                    </p>
                  </div>
                )}
                <DeviceDataSettings />
              </>
            )}

            {section === "agent" && (
              <div className="settings-agent-card">
                <div className="settings-agent-head">
                  <span className="settings-feature-icon">
                    <Icon name="cpu.fill" size={17} />
                  </span>
                  <span className="settings-feature-copy">
                    <strong>{agentName}</strong>
                    <span className="muted small">
                      {agentReady ? agentVersion || "connected" : agentNeedsLogin ? `${agentName} is signed out` : builtinAgent ? "Free and paid models, no install" : `${agentName} is not connected`}
                    </span>
                  </span>
                  <span className={"agent-state-pill" + (agentReady ? " is-ready" : "")}>
                    {agentReady ? "Ready" : agentNeedsLogin ? "Login required" : builtinAgent ? "Not set up" : "Offline"}
                  </span>
                </div>
                <div className="settings-agent-picker-row">
                  <AgentPicker label="Active" />
                  {!builtinAgent && <div className="settings-agent-actions">
                    {!agentDetected && (
                      <Tooltip content={`Connect ${agentName}`}><button className="mini primary-mini" onClick={() => authorizeAgent()}>
                        Connect
                      </button></Tooltip>
                    )}
                    {agentDetected && agentLoggedIn !== true && !agentLogoutPending && (
                      <Tooltip content={`Open ${agentName} login`}><button className="mini" onClick={() => loginAgent()}>
                        Login
                      </button></Tooltip>
                    )}
                    {agentDetected && agentLogoutPending && (
                      <button className="mini" disabled aria-live="polite">
                        <Spinner size={12} /> Signing out…
                      </button>
                    )}
                    {agentReady && agentLoggedIn === true && !agentLogoutPending && agentById(agentId).logoutArgs.length > 0 && (
                      <Tooltip content={`Sign out of ${agentName}`}><button className="mini" onClick={() => void handleAgentLogout()}>
                        Log out
                      </button></Tooltip>
                    )}
                  </div>}
                </div>
                {builtinAgent && <BuiltinAgentSetup />}
                {agentError && !builtinAgent && (
                  <div className="error small settings-agent-error">
                    <UserFacingError message={agentError} surface="agent_settings" />
                    <AgentInstallLink agent={agentSpec} error={agentError} surface="agent_settings" />
                  </div>
                )}
              </div>
            )}

            {section === "browser" && (
              <>
                <div className="settings-group">
                  <div className="settings-row">
                    <span className="muted small">nextctl</span>
                    <strong>{nextctlVersion || "not detected"}</strong>
                  </div>
                  <div className="settings-row">
                    <span className="muted small">Profiles</span>
                    <strong>{profiles}</strong>
                  </div>
                </div>
                <button className="settings-feature-link" onClick={() => setSection("updates")}><Icon name="arrow.down.circle" size={17} /><span className="settings-feature-copy"><strong>Browser toolsets and updates</strong><span className="muted small">Manage installed versions in Updates</span></span><Icon name="chevron.right" size={14} /></button>
              </>
            )}

            {section === "proxy" && !usageOpen && (
              <>
                <div className="settings-group">
                  <div className="settings-row">
                    <span className="muted small">Proxy</span>
                    {proxy ? (
                      <span className={`status-pill proxy-state ${trafficGateStateTone(proxy)}`}>
                        {trafficGateStateLabel(proxy)}
                      </span>
                    ) : (
                      <span className="muted small">locked</span>
                    )}
                  </div>
                </div>
                <button
                  className="settings-feature-link"
                  onClick={() => {
                    setUsageVisited(true);
                    setUsageOpen(true);
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
                  {proxyPercent != null && (
                    <span className={`status-pill${proxyPaused ? " proxy-state paused" : ""}`}>
                      {proxyPaused ? trafficGateStateLabel(proxy) : `${proxyPercent}%`}
                    </span>
                  )}
                  <Icon name="chevron.right" size={14} className="muted" />
                </button>
              </>
            )}
            {usageVisited && <div className="settings-proxy-usage" hidden={section !== "proxy" || !usageOpen}>
              <button className="secondary small" onClick={() => setUsageOpen(false)}><Icon name="chevron.left" size={12} /> Proxy settings</button>
              <UsageView />
            </div>}
          </SettingsPanel>
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
  onOpenRelease: () => Promise<void>;
}) {
  const downloading = status.status === "downloading";
  const downloaded = status.status === "downloaded";
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (!shouldDismissModalWithEscape(event)) return;
      event.preventDefault();
      onLater();
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [onLater]);
  return (
    <div className="modal-overlay">
      <div className="modal-card update-prompt" role="dialog" aria-modal="true" aria-labelledby="app-update-title">
        <div className="modal-title-row">
          <Icon name="sparkles" size={18} className="warn" />
          <div>
            <strong id="app-update-title">New Nextbrowser version available</strong>
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
        {downloading && <InstallationProgress label={`Downloading Nextbrowser ${status.percent ?? 0}%`} />}
        {manual ? (
          <ManualReleaseDownload onOpen={onOpenRelease} version={status.version} onLater={onLater} />
        ) : (
          <div className="row settings-actions">
            <button className="secondary" autoFocus onClick={onLater}>Later</button>
            <span className="spacer" />
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
          </div>
        )}
      </div>
    </div>
  );
}

export function App() {
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(
    settingsStorage.getItem("nextbrowser.theme"),
    window.matchMedia("(prefers-color-scheme: light)").matches,
  ));
  const [uiScale, setUiScale] = useState<number>(() => {
    const saved = Number(settingsStorage.getItem("nextbrowser.uiScale"));
    return Number.isFinite(saved) && saved >= UI_SCALE_MIN && saved <= UI_SCALE_MAX ? saved : 1;
  });
  // The floating quick-access control is a convenience on top of the real
  // setting in Settings; once dismissed there's no reason to keep offering
  // it back, so the choice is remembered per device like the scale itself.
  const [uiScaleFloatingHidden, setUiScaleFloatingHidden] = useState(
    () => settingsStorage.getItem("nextbrowser.uiScaleFloatingHidden") === "1",
  );
  const dismissUiScaleFloating = () => {
    setUiScaleFloatingHidden(true);
    settingsStorage.setItem("nextbrowser.uiScaleFloatingHidden", "1");
  };
  const restoreUiScaleFloating = () => {
    setUiScaleFloatingHidden(false);
    settingsStorage.removeItem("nextbrowser.uiScaleFloatingHidden");
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const [appUpdate, setAppUpdate] = useState<AppUpdateStatus>({ status: "idle" });
  const [browserRuntimeUpdates, setBrowserRuntimeUpdates] = useState<BrowserRuntimeUpdateStatus>({ status: "idle", runtimes: [] });
  const [updatePromptDismissedVersion, setUpdatePromptDismissedVersion] = useState<string>();
  const [runtimeUpdatePrompt, setRuntimeUpdatePrompt] = useState<BrowserRuntimeUpdateEntry[]>();
  const [runtimeUpdatePromptDismissed, setRuntimeUpdatePromptDismissed] = useState(
    () => localStorage.getItem("nextbrowser.runtimeUpdatePromptDismissed") ?? "",
  );
  const [clawbrowserCloseConfirm, setClawbrowserCloseConfirm] = useState<{
    runtimes: BrowserRuntimeUpdateEntry["runtime"][];
    currentName?: string;
    profileNames: string[];
  }>();
  const [runtimeUpdateInstall, setRuntimeUpdateInstall] = useState<BrowserRuntimeUpdateInstallStatus>({ status: "idle" });
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkOutcome, setBulkOutcome] = useState<string>();
  const bulkUpdateRunning = useRef(false);
  const runtimeUpdatesPending = useRef(new Set<BrowserRuntimeUpdateEntry["runtime"]>());
  const closeProfilesDecision = useRef<((confirmed: boolean) => void) | undefined>();

  const [runtimeUpdateProgressHidden, setRuntimeUpdateProgressHidden] = useState(false);
  const [unexpectedError, setUnexpectedError] = useState<{ reference: string; detail: string }>();
  const [browserRuntimeInstall, setBrowserRuntimeInstall] = useState<BrowserRuntimeInstallStatus>();
  const [browserInstallHiddenKey, setBrowserInstallHiddenKey] = useState<string>();
  const [agentGateDismissed, setAgentGateDismissed] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackPromptPending, setFeedbackPromptPending] = useState(false);
  const feedbackPromptEvaluated = useRef(false);
  const trafficGatePromptOpen = useStore((s) => s.trafficGatePromptOpen && trafficGateState(s.proxy) === "blocked");
  const githubStarPromptOpen = useStore((s) => s.githubStarPromptOpen && shouldAskForGitHubStar(s.githubStar));
  const githubStarPromptEvaluated = useRef(false);
  const githubStar = useStore((s) => s.githubStar);
  const setGitHubStarPromptOpen = useStore((s) => s.setGitHubStarPromptOpen);
  const preview = getPreviewMode();
  const checking = useStore((s) => s.checking);
  const authed = useStore((s) => s.authed);
  const startupPhase = useStore((s) => s.startupPhase);
  const startupLabel = startupPhase === "local"
    ? "Loading saved projects"
    : startupPhase === "setup"
      ? "Setting up Nextbrowser for first use"
      : "Checking account access";
  const startupError = useStore((s) => s.startupError);
  const feedbackAvailable = authed && !checking && !startupError;
  // Background sync happens constantly and isn't something the user needs
  // to watch; logout is the one time a sync becomes visible, since it's what
  // the sign-out flow is waiting on.
  const workspaceSyncing = useStore((s) => s.loggingOut && (s.projectsSyncing || s.isRefreshing));
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const bootstrap = useStore((s) => s.bootstrap);
  const showOnboarding = useStore((s) => s.showOnboarding);
  const agentReady = useStore((s) => s.agentReady());
  const agentGateDue = !checking && authed && !agentReady && !showOnboarding && !agentGateDismissed && preview !== "main";
  const agentChecking = useStore((s) => !!s.runtime[s.agentId]?.authorizing);
  const [agentGateShown, setAgentGateShown] = useState(false);
  const agentGateOpen = agentGateVisible(agentGateDue, agentChecking, agentGateShown);
  useEffect(() => { setAgentGateShown(agentGateOpen); }, [agentGateOpen]);
  const workspaceSetupRequired = useStore((s) => {
    return s.authed && s.workspacesLoaded && s.workspaceSetupRequired;
  });
  const workspaceSetupAuto = useStore((s) => s.workspaceSetupAuto);
  const ensureDefaultWorkspaceSetup = useStore((s) => s.ensureDefaultWorkspaceSetup);
  // Create the default workspace/project/profiles silently on first run instead
  // of blocking the user with the setup modal.
  useEffect(() => {
    if (!workspaceSetupRequired) return;
    if (workspaceSetupAuto === "running" || workspaceSetupAuto === "failed") return;
    void ensureDefaultWorkspaceSetup();
  }, [workspaceSetupRequired, workspaceSetupAuto, ensureDefaultWorkspaceSetup]);
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const setAppActive = useStore((s) => s.setAppActive);
  const didTrackThemeChange = useRef(false);
  const tabHistory = useRef<AppTab[]>([]);
  const observedTab = useRef(tab);
  const pendingBackTarget = useRef<AppTab | null>(null);
  const [backTarget, setBackTarget] = useState<AppTab>();
  // Error reports name the screen the user was on.
  const errorReportingView = showOnboarding ? "onboarding" : checking || startupError ? "startup" : settingsOpen ? "settings" : tab;
  useEffect(() => setErrorReportingView(errorReportingView), [errorReportingView]);
  // Device data: the main process learns connected agent types and workspace
  // and profile counts from here (compared as text so a reload with the same
  // values does not resend them).
  const appSetup = useStore((s) => JSON.stringify(deviceDataAppSetup(s) ?? null));
  useEffect(() => {
    const setup = JSON.parse(appSetup);
    if (setup) void invoke("client_environment_app_setup", setup).catch(() => undefined);
  }, [appSetup]);
  useEffect(() => {
    const showUnexpectedError = (event: ErrorEvent | PromiseRejectionEvent) => {
      const detail = unexpectedErrorDetail(event);
      // Cloud project sync is best-effort. Authentication failures there are
      // not fatal app errors and should not cover the active chat.
      if (isBackgroundSyncFailure(detail)) {
        console.warn("Background workspace sync failed:", detail);
        return;
      }
      const normalized = detail.trim() || "Unknown renderer error";
      const reference = unexpectedErrorReference(event);
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

  useEffect(() => {
    // Ask only after the app is usable. This keeps the fifth-open request out
    // of onboarding, recovery, and first-run setup flows, but does not make
    // feedback depend on which agent the user has selected.
    if (feedbackPromptEvaluated.current || !feedbackAvailable || showOnboarding || workspaceSetupRequired) return;
    feedbackPromptEvaluated.current = true;
    if (shouldPromptForFeedback(localStorage)) setFeedbackPromptPending(true);
  }, [feedbackAvailable, showOnboarding, workspaceSetupRequired]);

  const feedbackPromptWaiting = feedbackPromptBlocked({
    onboarding: showOnboarding || workspaceSetupRequired,
    agentGate: agentGateDue,
    trafficGate: trafficGatePromptOpen,
    githubStar: githubStarPromptOpen,
    appUpdate: updateAvailable(appUpdate) && appUpdate.version !== updatePromptDismissedVersion,
    runtimeUpdate: !!runtimeUpdatePrompt,
    settings: settingsOpen,
  });
  useEffect(() => {
    // The due ask waits until the start has settled and no other dialog is
    // open, so it never lands on top of the traffic gate or a setup step.
    if (!feedbackPromptPending || !feedbackAvailable || feedbackPromptWaiting) return;
    const timer = window.setTimeout(() => {
      setFeedbackPromptPending(false);
      setFeedbackOpen(true);
      trackEvent("feedback_prompt_shown", { trigger: "fifth_open" });
    }, feedbackPromptConfig.delayMs);
    return () => window.clearTimeout(timer);
  }, [feedbackPromptPending, feedbackAvailable, feedbackPromptWaiting]);

  useEffect(() => {
    // Opening feedback by hand answers this launch's ask.
    if (feedbackOpen) setFeedbackPromptPending(false);
  }, [feedbackOpen]);

  useEffect(() => {
    // Once per launch, once the app is usable: a GitHub sign-up that has not
    // claimed its star reward is asked to star the repository. The prompt can
    // be closed; the Usage page keeps the same ask next to the proxy traffic.
    if (githubStarPromptEvaluated.current || !feedbackAvailable || showOnboarding || workspaceSetupRequired) return;
    // Never on top of the agent connection gate: ask once that is out of the way.
    if (githubStar === undefined || agentGateDue) return;
    githubStarPromptEvaluated.current = true;
    if (shouldAskForGitHubStar(githubStar)) setGitHubStarPromptOpen(true);
  }, [feedbackAvailable, showOnboarding, workspaceSetupRequired, githubStar, agentGateDue, setGitHubStarPromptOpen]);

  useEffect(() => {
    if (!feedbackAvailable) setFeedbackOpen(false);
  }, [feedbackAvailable]);

  useEffect(() => {
    if (!feedbackAvailable) return;
    const openFeedbackWithShortcut = (event: KeyboardEvent) => {
      if ((!event.metaKey && !event.ctrlKey) || !event.shiftKey || event.altKey || event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      setFeedbackOpen(true);
      trackEvent("feedback_prompt_shown", { trigger: "keyboard_shortcut" });
    };
    window.addEventListener("keydown", openFeedbackWithShortcut);
    return () => window.removeEventListener("keydown", openFeedbackWithShortcut);
  }, [feedbackAvailable]);

  const checkAppUpdate = () => {
    void invoke<AppUpdateStatus>("app_check_for_update").then(setAppUpdate).catch(() => {
      setAppUpdate({ status: "error", message: APP_UPDATE_ERROR });
    });
  };
  const checkBrowserRuntimeUpdates = async () => {
    try {
      const status = await invoke<BrowserRuntimeUpdateStatus>("browser_runtime_check_for_updates");
      setBrowserRuntimeUpdates(status);
      return status;
    } catch {
      setBrowserRuntimeUpdates((current) => ({ ...current, status: "error", message: "We couldn't check browser toolset updates." }));
      return undefined;
    }
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
    await invoke("open_external", { url });
  };
  const requestBrowserRuntimeUpdate = (runtime: BrowserRuntimeUpdateEntry) => {
    setRuntimeUpdatePrompt([runtime]);
  };
  const openBrowserRuntimeManualGuide = (url?: string) => {
    const destination = url || "https://github.com/clawbrowser/clawbrowser/releases/latest";
    void invoke("open_external", { url: destination }).catch(() => {
      window.open(destination, "_blank", "noopener,noreferrer");
    });
  };
  const dismissBrowserRuntimeUpdatePrompt = () => {
    if (runtimeUpdatePrompt) {
      const signature = browserRuntimeUpdateSignature(browserRuntimeUpdates.runtimes);
      setRuntimeUpdatePromptDismissed(signature);
      localStorage.setItem("nextbrowser.runtimeUpdatePromptDismissed", signature);
    }
    setRuntimeUpdatePrompt(undefined);
  };
  const beginBrowserRuntimeInstall = async (runtimes: BrowserRuntimeUpdateEntry["runtime"][]) => {
    setRuntimeUpdateProgressHidden(false);
    setRuntimeUpdateInstall((current) => addPendingRuntimeInstall(current, runtimes, browserRuntimeUpdates.runtimes));
    try {
      const result = await invoke<BrowserRuntimeUpdateInstallStatus>("browser_runtime_install_updates", { runtimes });
      setRuntimeUpdateInstall((current) => latestRuntimeOperation(current, result));
      // Read back after the operation as well as subscribing to events: a
      // hidden card or a missed IPC event must never leave stale Update buttons.
      await checkBrowserRuntimeUpdates();
      return result;
    } catch (error) {
      const result: BrowserRuntimeUpdateInstallStatus = { status: "failed", runtimes, message: error instanceof Error ? error.message : "The browser toolset update could not be installed." };
      setRuntimeUpdateInstall((current) => current.status === "installing" && current.items?.some((item) => !runtimes.includes(item.runtime) && item.status === "installing") ? current : result);
      setBulkOutcome(result.message);
      return result;
    }
  };
  const installBrowserRuntimeUpdates = async (requestedRuntimes?: unknown): Promise<BrowserRuntimeUpdateInstallStatus | undefined> => {
    const runtimes = confirmedBrowserRuntimeUpdates<BrowserRuntimeUpdateEntry["runtime"]>(requestedRuntimes, runtimeUpdatePrompt?.map((runtime) => runtime.runtime) ?? [])
      .filter((runtime) => !runtimeUpdatesPending.current.has(runtime) && !runtimeInstalling(runtimeUpdateInstall, runtime));
    if (!runtimes.length) return undefined;
    for (const runtime of runtimes) runtimeUpdatesPending.current.add(runtime);
    setRuntimeUpdatePromptDismissed(browserRuntimeUpdateSignature(browserRuntimeUpdates.runtimes));
    setRuntimeUpdatePrompt(undefined);
    try {
      if (runtimes.includes("clawbrowser")) {
        const profileNames = await invoke<string[]>("browser_runtime_clawbrowser_active_sessions");
        if (Array.isArray(profileNames) && profileNames.length) {
          const confirmed = await new Promise<boolean>((resolve) => {
            closeProfilesDecision.current = resolve;
            setClawbrowserCloseConfirm({ runtimes, profileNames });
          });
          if (!confirmed) return { status: "cancelled", message: "Update cancelled; open profiles were left running." };
        }
      }
      return await beginBrowserRuntimeInstall(runtimes);
    } catch (error) {
      const result: BrowserRuntimeUpdateInstallStatus = { status: "failed", runtimes, message: error instanceof Error ? error.message : "Could not check open browser profiles. Close them and retry." };
      setRuntimeUpdateInstall((current) => current.status === "installing" ? current : result);
      setBulkOutcome(result.message);
      setRuntimeUpdateProgressHidden(false);
      return result;
    } finally {
      for (const runtime of runtimes) runtimeUpdatesPending.current.delete(runtime);
    }
  };
  const confirmCloseClawbrowserProfiles = () => {
    setClawbrowserCloseConfirm(undefined);
    closeProfilesDecision.current?.(true);
    closeProfilesDecision.current = undefined;
  };
  const cancelCloseClawbrowserProfiles = () => {
    setClawbrowserCloseConfirm(undefined);
    closeProfilesDecision.current?.(false);
    closeProfilesDecision.current = undefined;
  };
  const cancelRuntimeUpdates = (runtime?: BrowserRuntimeUpdateEntry["runtime"]) => {
    void invoke<BrowserRuntimeUpdateInstallStatus>("browser_runtime_cancel_updates", { runtime }).then((result) => setRuntimeUpdateInstall((current) => latestRuntimeOperation(current, result))).catch(() => {
      setBulkOutcome("Could not request cancellation. Open Updates to check the current operation and retry.");
    });
  };
  const downloadAllBrowsers = () => {
    const runtimes = downloadableBrowsers(browserRuntimeUpdates.runtimes, runtimeUpdateInstall).map((runtime) => runtime.runtime);
    if (runtimes.length) void installBrowserRuntimeUpdates(runtimes);
  };
  const updateAll = async () => {
    if (bulkUpdateRunning.current || runtimeUpdatesPending.current.size > 0 || runtimeUpdateInstall.status === "installing" || appUpdate.status === "downloading" || useStore.getState().nextctlUpdating) return;
    bulkUpdateRunning.current = true;
    setBulkUpdating(true);
    setBulkOutcome("Checking and updating nextctl…");
    const problems: string[] = [];
    try {
      const cliUpdated = await useStore.getState().checkNextctlUpdate(0, { manual: true });
      if (!cliUpdated) problems.push("nextctl: check its status above");
      setBulkOutcome("Checking browser toolsets and the Nextbrowser app…");
      const [browserStatus, appStatus] = await Promise.all([
        checkBrowserRuntimeUpdates(),
        invoke<AppUpdateStatus>("app_check_for_update"),
      ]);
      setAppUpdate(appStatus);
      if (!browserStatus || browserStatus.status === "error" || browserStatus.status === "partial") problems.push("some browser update checks failed");
      const runtimes = availableRuntimeUpdates(browserStatus?.runtimes ?? []);
      if (runtimes.length) {
        setBulkOutcome("Updating browser toolsets…");
        const result = await installBrowserRuntimeUpdates(runtimes);
        if (!result || result.status === "cancelled") {
          setBulkOutcome("Stopped. Completed updates were kept; the app download was not started.");
          return;
        }
        if (result.status !== "ready") problems.push("some browser updates need attention");
      }
      let appNotice = "";
      if (appStatus.status === "available" && !MANUAL_UPDATE) {
        setBulkOutcome("Downloading the Nextbrowser app update…");
        const result = await invoke<AppUpdateStatus>("app_download_update");
        setAppUpdate(result);
        if (result.status === "error") problems.push("the app download failed");
        else if (result.status === "downloaded") appNotice = " App update downloaded; choose Restart and update when ready.";
      } else if (appStatus.status === "downloaded") appNotice = " Choose Restart and update when ready.";
      else if (appStatus.status === "available" && MANUAL_UPDATE) appNotice = " Use the app download button above to update Nextbrowser on this Mac.";
      else if (appStatus.status === "error") problems.push("the app update check failed");
      else if (appStatus.status === "disabled") appNotice = " App self-updates are unavailable in this build.";
      setBulkOutcome((problems.length ? `Finished with items to review: ${problems.join("; ")}.` : "Installed components checked and available updates completed.") + appNotice);
    } catch (error) {
      setBulkOutcome(`Update all could not finish: ${error instanceof Error ? error.message : "please retry"}`);
    } finally {
      bulkUpdateRunning.current = false;
      setBulkUpdating(false);
    }
  };
  const openSettings = (section: SettingsSection | null = null) => {
    if (browserRuntimeUpdates.status === "idle") checkBrowserRuntimeUpdates();
    setSettingsSection(section);
    setSettingsOpen(true);
  };
  // The Settings button's dot announces an update; the button opens where it is.
  const openSettingsFromButton = () => openSettings(settingsSectionForUpdates(updateAvailable(appUpdate), browserRuntimeUpdateAvailable(browserRuntimeUpdates)));
  const openSettingsRef = useRef(openSettings);
  openSettingsRef.current = openSettings;
  useEffect(() => {
    const openAgentSettings = () => openSettingsRef.current("agent");
    window.addEventListener(OPEN_AGENT_SETTINGS_EVENT, openAgentSettings);
    return () => window.removeEventListener(OPEN_AGENT_SETTINGS_EVENT, openAgentSettings);
  }, []);
  const closeSettings = () => {
    setSettingsOpen(false);
    setSettingsSection(null);
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
        setSettingsSection(null);
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
    let previous: BrowserRuntimeUpdateInstallStatus["status"] | undefined;
    const applyStatus = (status: BrowserRuntimeUpdateInstallStatus) => {
      for (const item of status.items || []) {
        if (item.status === "installing") runtimeUpdatesPending.current.delete(item.runtime);
      }
      setRuntimeUpdateInstall((current) => latestRuntimeOperation(current, status));
      // Progress events arrive throughout an update; only a new update or a
      // result that needs a decision may bring back a card the user hid.
      if ((status.status === "installing" && previous !== "installing") || status.status === "failed" || status.status === "partial") {
        setRuntimeUpdateProgressHidden(false);
      }
      previous = status.status;
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
    const actionable = browserRuntimeUpdates.runtimes.filter((runtime) => (
      runtime.status === "available" || runtime.status === "not-installed"
    ));
    const signature = browserRuntimeUpdateSignature(actionable);
    if (runtimeUpdatePrompt) {
      const promptStillCurrent = runtimeUpdatePrompt.every((prompted) => actionable.some((runtime) => (
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
      || bulkUpdating
      || runtimeUpdatesPending.current.size > 0
      || signature === runtimeUpdatePromptDismissed
      || runtimeUpdatePrompt
    ) return;
    setRuntimeUpdatePrompt(available);
  }, [browserRuntimeUpdates, runtimeUpdateInstall.status, runtimeUpdatePrompt, runtimeUpdatePromptDismissed, bulkUpdating]);

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
    // Electron's native page zoom (Chromium's own Ctrl/Cmd+ mechanism),
    // requested through the main process — not the CSS `zoom` property,
    // which scales pixel values that were never meant to exceed the
    // window's own size and broke scrolling and fixed-position overlays
    // (like the Settings modal) at higher scales.
    void invoke("app_set_zoom_factor", { factor: uiScale }).catch(() => undefined);
    document.documentElement.style.setProperty("--window-zoom", String(uiScale));
    settingsStorage.setItem("nextbrowser.uiScale", String(uiScale));
  }, [uiScale]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    settingsStorage.setItem("nextbrowser.theme", theme);
    const palette = getComputedStyle(document.documentElement);
    void invoke("app_set_theme", { theme, background: palette.getPropertyValue("--bg").trim(), foreground: palette.getPropertyValue("--text").trim() }).catch(() => undefined);
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
      const nodeMavenState = getPreviewNodeMavenState();
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
          used_bytes: nodeMavenState === "exhausted" ? 1_000_000_000 : 240_000_000,
          limit_bytes: 1_000_000_000,
          remaining_bytes: nodeMavenState === "exhausted" ? 0 : 760_000_000,
          percent_used: nodeMavenState === "exhausted" ? 100 : 24,
          state: nodeMavenState === "exhausted" ? "exhausted" : "ok",
          dashboard_url: "https://dashboard.nodemaven.com/dashboard",
          provider: "nodemaven",
          provider_account_email: "customer@example.com",
          provider_access_method: "password_reset",
          provider_access_url: "https://dashboard.nodemaven.com/accounts/password/reset/",
          pricing_url: "https://dashboard.nodemaven.com/pricing?tab=MONTHLY_PLANS",
        },
        showOnboarding: false,
        ...(tabParam && isUtilityDialogTab(tabParam) ? { tab: "chat" as const, utilityDialog: tabParam }
          : tabParam && PREVIEW_TABS.has(tabParam) ? { tab: tabParam as AppTab } : {}),
      });
      return;
    }
    bootstrap();
  }, [bootstrap, preview]);

  useEffect(() => {
    if (preview) return;
    const refreshLogin = () => {
      if (document.visibilityState === "visible") void useStore.getState().recheckLogin();
    };
    const onVis = () => {
      setAppActive(document.visibilityState === "visible");
      refreshLogin();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", refreshLogin);
    const timer = window.setInterval(refreshLogin, 30_000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", refreshLogin);
      window.clearInterval(timer);
    };
  }, [setAppActive, preview]);

  useEffect(() => {
    // A recovered connection allows a later logout to reopen setup.
    if (agentReady) setAgentGateDismissed(false);
  }, [agentReady]);

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

  const browserInstallHidden = !!browserRuntimeInstall && browserInstallHiddenKey === browserRuntimeInstallKey(browserRuntimeInstall);
  const backgroundTaskPills = (
    <>
      {runtimeUpdateInstall.status === "installing" && runtimeUpdateProgressHidden && (
        <BackgroundTaskPill
          label={`Updating ${runtimeUpdateInstall.currentName ?? "browser toolsets"}`}
          onShow={() => setRuntimeUpdateProgressHidden(false)}
        />
      )}
      {browserRuntimeInstall && browserInstallHidden && (
        <BackgroundTaskPill
          label={`${browserRuntimeInstall.status === "installing" ? "Installing" : "Downloading"} ${browserRuntimeInstallName(browserRuntimeInstall)}`}
          onShow={() => setBrowserInstallHiddenKey(undefined)}
        />
      )}
    </>
  );
  const feedbackModal = feedbackAvailable && feedbackOpen ? <FeedbackModal onClose={() => setFeedbackOpen(false)} onSubmitted={(rating) => {
    markFeedbackSubmitted(localStorage);
    trackEvent("feedback_submitted", { rating });
  }} /> : null;

  const titlebarActions = <TitlebarActions>
    <CommunityControls />
    <ThemeToggle theme={theme} onToggle={() => setTheme(theme === "dark" ? "light" : "dark")} />
  </TitlebarActions>;

  if ((checking || startupError) && preview !== "login" && preview !== "main" && preview !== "onboarding") {
    return (
      <>
        {titlebarActions}
        <div className="floating-controls">
          {backgroundTaskPills}
          <SettingsButton onClick={openSettingsFromButton} hasUpdate={updateAvailable(appUpdate) || browserRuntimeUpdateAvailable(browserRuntimeUpdates)} />
        </div>
        {settingsOpen && (
          <SettingsModal
            onClose={closeSettings}
            section={settingsSection}
            appUpdate={appUpdate}
            browserRuntimeUpdates={browserRuntimeUpdates}
            runtimeOperation={runtimeUpdateInstall}
            bulkUpdating={bulkUpdating}
            bulkOutcome={bulkOutcome}
            onUpdateAll={() => { void updateAll(); }}
            onDownloadAllBrowsers={downloadAllBrowsers}
            onShowProgress={() => setRuntimeUpdateProgressHidden(false)}
            onCancelUpdates={cancelRuntimeUpdates}
            manualUpdate={MANUAL_UPDATE}
            onCheckUpdate={checkAppUpdate}
            onCheckBrowserRuntimeUpdates={checkBrowserRuntimeUpdates}
            onDownloadUpdate={downloadAppUpdate}
            onInstallUpdate={installAppUpdate}
            onOpenRelease={openLatestRelease}
            onRequestBrowserRuntimeUpdate={requestBrowserRuntimeUpdate}
            uiScale={uiScale}
            onUiScaleChange={setUiScale}
            uiScaleFloatingHidden={uiScaleFloatingHidden}
            onRestoreFloatingScale={restoreUiScaleFloating}
          />
        )}
        <div className="splash">
          <BrandLogo size={76} />
          <div className="splash-title">{brandName}</div>
          {startupError ? (
            <div className="startup-recovery" role="alert">
              <p className="muted small">{startupError}</p>
              <button className="primary" onClick={() => window.location.reload()}>Restart check</button>
            </div>
          ) : (
            <>
              <InstallationSpinner />
              <div className="muted small">{startupLabel}…</div>
              {startupPhase === "setup" && <div className="muted small">Nextbrowser is installing its command-line tool. This can take a few minutes on a slow connection.</div>}
              <div className="startup-progress"><InstallationProgress label={startupLabel} /></div>
            </>
          )}
        </div>
        {runtimeUpdatePrompt && (
          <BrowserRuntimeUpdatePrompt
            runtimes={runtimeUpdatePrompt}
            onLater={dismissBrowserRuntimeUpdatePrompt}
            onConfirm={() => installBrowserRuntimeUpdates()}
          />
        )}
        {clawbrowserCloseConfirm && (
          <ClawbrowserCloseProfilesPrompt
            profileNames={clawbrowserCloseConfirm.profileNames}
            onCancel={cancelCloseClawbrowserProfiles}
            onConfirm={confirmCloseClawbrowserProfiles}
          />
        )}
        {runtimeUpdateInstall.status !== "idle" && !runtimeUpdateProgressHidden && (
          <BrowserRuntimeUpdateProgress status={runtimeUpdateInstall} onCancel={cancelRuntimeUpdates} onClose={() => setRuntimeUpdateProgressHidden(true)} onRetry={installBrowserRuntimeUpdates} onOpenManualGuide={openBrowserRuntimeManualGuide} />
        )}
        {unexpectedError && <GlobalErrorNotice error={unexpectedError} onClose={() => setUnexpectedError(undefined)} />}
        {feedbackModal}
      </>
    );
  }

  return (
    <div className="app">
      {titlebarActions}
      <aside
        id="app-sidebar"
        className={`${glassSurfaceClassName} sidebar${sidebarCollapsed ? " sidebar-collapsed" : ""}`}
        style={{ width: sidebarCollapsed ? "var(--sidebar-rail-width)" : sidebarWidth }}
      >
        <Sidebar
          onOpenSettings={openSettingsFromButton}
          settingsAttention={updateAvailable(appUpdate) || browserRuntimeUpdateAvailable(browserRuntimeUpdates)}
          footerAccessory={!uiScaleFloatingHidden && !sidebarCollapsed
            ? <UIScaleControl inline value={uiScale} onChange={setUiScale} onDismiss={dismissUiScaleFloating} />
            : undefined}
        />
      </aside>
      {!sidebarCollapsed && <Tooltip content="Resize sidebar"><div id="sidebar-resize" className="resize-handle" aria-label="Resize sidebar" /></Tooltip>}
      <main className={"content" + (tab === "chat" ? " content-chat" : "")}>
        {tab !== "chat" && <nav className="tabbar">
          {!isPrimaryAppTab(tab) && backTarget && (
            <Tooltip content={`Back to ${appTabLabel(backTarget)} · Esc`}><button
              className="tabbar-back"
              type="button"
              onClick={navigateBack}
              aria-label={`Back to ${appTabLabel(backTarget)}`}
            >
              <Icon name="chevron.left" size={18} strokeWidth={2.25} />
            </button></Tooltip>
          )}
          <MainViewNavigation />
          <span className="tabbar-spacer" />
          <div className="tabbar-controls">
            {backgroundTaskPills}
            {feedbackAvailable && <FeedbackButton onClick={() => setFeedbackOpen(true)} />}
          </div>
        </nav>}
        <hr className="divider" />
        {workspaceSyncing && <div className="workspace-sync-status muted small" role="status">
          <Spinner size={12} /> Syncing workspace…
        </div>}
        <div className={"tab-content" + (tab === "skills" ? " tab-content-bleed" : "")}>
          <div className={"persistent-tab-panel" + (tab === "chat" ? "" : " is-hidden")}>
            <ChatView headerAccessory={<>{backgroundTaskPills}{feedbackAvailable && <FeedbackButton onClick={() => setFeedbackOpen(true)} />}</>} />
          </div>
          {tab === "skills" && <SkillsView onOpenAgentSettings={() => openSettings("agent")} />}
          {tab === "automation" && <AutomationStudio />}
          <div className={"persistent-tab-panel" + (tab === "live" ? "" : " is-hidden")}>
            <LiveView active={tab === "live"} />
          </div>
          {tab === "usage" && <UsageView />}
          {tab === "guide" && <GuideView onOpenAgentSettings={() => openSettings("agent")} />}
        </div>
      </main>
      <UtilityDialogs />
      {settingsOpen && (
        <SettingsModal
          onClose={closeSettings}
          section={settingsSection}
          appUpdate={appUpdate}
          browserRuntimeUpdates={browserRuntimeUpdates}
            runtimeOperation={runtimeUpdateInstall}
            bulkUpdating={bulkUpdating}
            bulkOutcome={bulkOutcome}
            onUpdateAll={() => { void updateAll(); }}
            onDownloadAllBrowsers={downloadAllBrowsers}
            onShowProgress={() => setRuntimeUpdateProgressHidden(false)}
            onCancelUpdates={cancelRuntimeUpdates}
          manualUpdate={MANUAL_UPDATE}
          onCheckUpdate={checkAppUpdate}
          onCheckBrowserRuntimeUpdates={checkBrowserRuntimeUpdates}
          onDownloadUpdate={downloadAppUpdate}
          onInstallUpdate={installAppUpdate}
          onOpenRelease={openLatestRelease}
          onRequestBrowserRuntimeUpdate={requestBrowserRuntimeUpdate}
          uiScale={uiScale}
          onUiScaleChange={setUiScale}
          uiScaleFloatingHidden={uiScaleFloatingHidden}
          onRestoreFloatingScale={restoreUiScaleFloating}
        />
      )}
      {updateAvailable(appUpdate) && appUpdate.version !== updatePromptDismissedVersion && !settingsOpen && (
        <AppUpdatePrompt
          status={appUpdate}
          manual={MANUAL_UPDATE}
          onLater={() => setUpdatePromptDismissedVersion(appUpdate.version)}
          onDownload={downloadAppUpdate}
          onInstall={installAppUpdate}
          onOpenRelease={openLatestRelease}
        />
      )}
      {runtimeUpdatePrompt && (
        <BrowserRuntimeUpdatePrompt
          runtimes={runtimeUpdatePrompt}
          onLater={dismissBrowserRuntimeUpdatePrompt}
          onConfirm={() => installBrowserRuntimeUpdates()}
        />
      )}
      {clawbrowserCloseConfirm && (
        <ClawbrowserCloseProfilesPrompt
          profileNames={clawbrowserCloseConfirm.profileNames}
          onCancel={cancelCloseClawbrowserProfiles}
          onConfirm={confirmCloseClawbrowserProfiles}
        />
      )}
      <DashboardKeyModal />
      <TrafficGateModal />
      <GitHubStarModal suppressed={agentGateDue} />
      <ProfileCreateRequestModal />
      {agentGateOpen && (
        <AgentConnectionGate onDismiss={() => setAgentGateDismissed(true)} />
      )}
      {showOnboarding && <OnboardingView />}
      {!checking && agentReady && workspaceSetupRequired && workspaceSetupAuto === "failed" && <WorkspaceSetupGate />}
      {browserRuntimeInstall && !browserInstallHidden && <BrowserRuntimeInstallModal status={browserRuntimeInstall} onHide={() => setBrowserInstallHiddenKey(browserRuntimeInstallKey(browserRuntimeInstall))} onCancel={() => {
        trackEvent("browser_runtime_download_stopped", { runtime: browserRuntimeInstall.runtime });
        if (browserRuntimeInstall.requestId) void invoke("nextctl_cancel", { requestId: browserRuntimeInstall.requestId });
        setBrowserRuntimeInstall(undefined);
      }} />}
      {runtimeUpdateInstall.status !== "idle" && !runtimeUpdateProgressHidden && (
        <BrowserRuntimeUpdateProgress status={runtimeUpdateInstall} onCancel={cancelRuntimeUpdates} onClose={() => setRuntimeUpdateProgressHidden(true)} onRetry={installBrowserRuntimeUpdates} onOpenManualGuide={openBrowserRuntimeManualGuide} />
      )}
      {unexpectedError && <GlobalErrorNotice error={unexpectedError} onClose={() => setUnexpectedError(undefined)} />}
      {feedbackModal}
      {/* Interface size stays in the expanded footer and Settings; it never floats over navigation. */}
    </div>
  );
}
