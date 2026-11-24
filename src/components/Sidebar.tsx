import { Dialog, Popover, Select, Tooltip } from "../shared/ui";
import { AccountAvatar } from "./AccountAvatar";
import { PersonalProxyNavigation } from "./PersonalProxyNavigation";
import { PROFILE_ACTIONS_EVENT } from "../lib/profileNavigation";
import { RecentProjects } from "./RecentProjects";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { personalProxyUsers, useStore, type ManualProxyProfileInput } from "../store";
import { shouldDismissModalWithEscape } from "../lib/modalKeyboard";
import { trackEvent } from "../lib/analytics";
import { reportUserFacingError } from "../lib/errorReporting";
import { SidebarNavigation, SidebarSettingsButton } from "./SidebarNavigation";
import { PinnedMiniApps } from "./PinnedMiniApps";
import { CREATE_LIVE_PROFILE_EVENT } from "./LiveSessions";
import { clawbrowserTargetKey, multiloginTargetKey } from "../lib/liveProfileSwitch";
import { Icon, Spinner } from "./Icon";
import { withLocalScripts } from "../skillsCatalog";
import { countryFlag, countryLabel, ROTATION_COUNTRIES } from "../lib/countryFlag";
import { guideProfileTarget, guideWorkspaceProfileNames } from "../lib/guideQuickStart";
import { manualProxyDefaultName, manualProxyLimits, parseManualProxyBatch, parseManualProxyClipboard, validateManualProxyFields, type ManualProxyScheme } from "../lib/manualProxy";
import { actionFailureMessage, internalError } from "../lib/userFacingError";
import { userFacingBrowserError } from "../lib/userFacingBrowserError";
import { vpnSystemProxyHint } from "../lib/systemProxyHint";
import { isProxyTrafficExhaustedError, proxyTrafficLaunchRefusedMessage } from "../lib/proxyTraffic";
import { MULTILOGIN_APP_NOT_RUNNING, MULTILOGIN_TOKEN_EXPIRED, userFacingMultiloginError } from "../lib/userFacingMultiloginError";
import { openMultiloginApp } from "../lib/multiloginApp";
import { entityNameLimits, validateEntityName } from "../lib/entityValidation";
import { cancelNextctlRun } from "../nextctl";
import { type AppTab, type BrowserWorkflowAction, type BrowserWorkflowSkill } from "../types";
import { CountrySelect } from "./CountrySelect";
import { PersonalProxySelect } from "./PersonalProxySelect";
import { PersonalProxyTestStatus, type PersonalProxyTestState } from "./PersonalProxyTestStatus";
import { UserFacingError } from "./UserFacingError";
import { VPSSetupModal } from "./VPSSetupModal";
import { CONNECTOR_PROMPT_RESUMED_EVENT, CONNECTORS } from "../connectorsCatalog";
import { invoke, listen } from "../electronBridge";
import { uid } from "../lib/ids";
import { getPreviewMode } from "../preview";
import {
  multiloginSelectionForWorkspace,
  setMultiloginSelection,
  MULTILOGIN_SELECTION_EVENT,
  type MultiloginProfileKind,
  type MultiloginProfileSelection,
} from "../lib/multiloginSelection";
import {
  filterMultiloginProfiles,
  multiloginAccountLabel,
  multiloginProfileSelected,
  previewMultiloginConnectionStatus,
  type MultiloginConnectionStatus,
  type MultiloginProfileSummary,
} from "../lib/multiloginProfiles";
import {
  multiloginConnected,
  multiloginCreateCountry,
  multiloginProfileSelection,
  multiloginSubmitError,
  multiloginSubmitLabel,
  MULTILOGIN_OS_TYPES,
  type MultiloginCreatedProfile,
  type MultiloginCreateMode,
  type MultiloginOSType,
} from "../lib/multiloginProfileCreate";
import { activeAutomationRecording, AUTOMATION_RECORDING_EVENT, type ActiveAutomationRecording } from "../lib/automationRecording";
import { activeAutomationExecution, automationAgentAnswer, automationAgentBrowserActionCount, automationExecutionView, AUTOMATION_EXECUTION_EVENT, clearActiveAutomationExecution, executionWithRecipeProgress, setActiveAutomationExecution, withAutomationExecutionEvent, type AutomationExecution, type AutomationRecipeProgress } from "../lib/automationExecution";
import { automationRepairTask, parseAutomationRepairRecipe } from "../lib/automationRepair";

type ManualProxyInputMode = "url" | "fields" | "bulk";
type ProfileToolsetOption = "clawbrowser" | "dasbrowser" | "camoufox" | "multilogin";
const PROFILE_CREATE_TIMEOUT_MS = 120_000;
// How long a passed proxy test stays on screen; a failure stays until the next test.
const PROXY_TEST_RESULT_MS = 30_000;

function recordingDuration(startedAt: number, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function repairedRecipeEvidence(actions: BrowserWorkflowAction[]) {
  return actions.map((action) => `Called clawbrowser.${action.tool}(${JSON.stringify(action.arguments)})\n{"ok":true}`).join("\n");
}

function multiloginCreationError(error: unknown, kind: MultiloginProfileKind): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/workspace has no .*Default folder|workspace has multiple .*Default folder/i.test(message)) {
    const item = kind === "mobile" ? "cloud-phone" : "browser";
    return `This Multilogin workspace needs one ${item} folder named “Default” before Nextbrowser can create a new ${kind === "mobile" ? "cloud phone" : "browser profile"}. Create or rename that folder in Multilogin, then refresh here. You can still choose an existing shared profile.`;
  }
  return /timed out/i.test(message)
    ? "Multilogin profile creation took too long and was stopped. Check your connection, then try again."
    : userFacingMultiloginError(error, kind);
}

interface SidebarProps {
  projectsDock: HTMLElement | null;
  onOpenSettings: () => void;
  settingsAttention?: boolean;
  /** Profiles rail destination, including the hover preview. */
  liveDestination: ReactNode;
}

export function Sidebar({ onOpenSettings, settingsAttention, liveDestination, projectsDock }: SidebarProps) {
  const s = useStore();
  const [automationStatusOpen, setAutomationStatusOpen] = useState(false);
  const [projectsMenuOpen, setProjectsMenuOpen] = useState(false);
  useEffect(() => {
    const projects = () => setProjectsMenuOpen(true);
    const create = () => { setWorkspaceName(""); setWorkspaceError(null); setWorkspaceCreatorOpen(true); };
    const remove = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (typeof id !== "string") return;
      setWorkspaceDeleteError(null);
      setWorkspaceDeleteId(id);
    };
    window.addEventListener("nextbrowser:open-projects", projects);
    window.addEventListener("nextbrowser:create-workspace", create);
    window.addEventListener("nextbrowser:delete-workspace", remove);
    return () => { window.removeEventListener("nextbrowser:open-projects", projects); window.removeEventListener("nextbrowser:create-workspace", create); window.removeEventListener("nextbrowser:delete-workspace", remove); };
  }, []);
  const [menuProfile, setMenuProfile] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const { name, anchor } = (event as CustomEvent<{ name: string; anchor: HTMLElement }>).detail;
      if (!useStore.getState().workspaces.find(w => w.id === useStore.getState().activeWorkspaceId)?.profileNames.includes(name)) return;
      setMenuAnchor(anchor); setMenuProfile(name); setProfileMoveError(null);
    };
    window.addEventListener(PROFILE_ACTIONS_EVENT, open);
    return () => window.removeEventListener(PROFILE_ACTIONS_EVENT, open);
  }, []);
  useEffect(() => { setMenuProfile(null); }, [s.activeWorkspaceId]);
  useEffect(() => { if (s.tab !== "live") setMenuProfile(null); }, [s.tab]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [profileDeleting, setProfileDeleting] = useState(false);
  const [profileDeleteError, setProfileDeleteError] = useState<string | null>(null);
  const [confirmDeleteChat, setConfirmDeleteChat] = useState<string | null>(null);
  const [manualProxyOpen, setManualProxyOpen] = useState(false);
  const [manualProxyMode, setManualProxyMode] = useState<ManualProxyInputMode>("url");
  const [manualProxyUrl, setManualProxyUrl] = useState("");
  const [manualProxyBulk, setManualProxyBulk] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualScheme, setManualScheme] = useState<ManualProxyScheme>("http");
  const [manualHost, setManualHost] = useState("");
  const [manualPort, setManualPort] = useState("8080");
  const [manualUsername, setManualUsername] = useState("");
  const [manualPassword, setManualPassword] = useState("");
  const [manualPasswordVisible, setManualPasswordVisible] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualProxyEditing, setManualProxyEditing] = useState(false);
  const [manualProxyDeleting, setManualProxyDeleting] = useState<string | null>(null);
  const [manualProxyDeletePending, setManualProxyDeletePending] = useState(false);
  const [proxyTestResults, setProxyTestResults] = useState<Record<string, PersonalProxyTestState>>({});
  const [createProfileOpen, setCreateProfileOpen] = useState(false);
  const createForLive = useRef(false);
  const [vpsSetupOpen, setVPSSetupOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileCountry, setProfileCountry] = useState("US");
  const [profileConnection, setProfileConnection] = useState<"managed" | "direct" | "personal">("managed");
  const [profilePersonalProxyId, setProfilePersonalProxyId] = useState("");
  const [profileToolset, setProfileToolset] = useState<ProfileToolsetOption>("clawbrowser");
  const [multiloginStatus, setMultiloginStatus] = useState<MultiloginConnectionStatus | null>(null);
  const [multiloginChecking, setMultiloginChecking] = useState(false);
  const [multiloginError, setMultiloginError] = useState<string>();
  const [multiloginMode, setMultiloginMode] = useState<MultiloginCreateMode>("new");
  const [multiloginKind, setMultiloginKind] = useState<MultiloginProfileKind>("browser");
  const [multiloginQuery, setMultiloginQuery] = useState("");
  const [multiloginDraft, setMultiloginDraft] = useState<MultiloginProfileSelection>();
  const [multiloginOS, setMultiloginOS] = useState<MultiloginOSType>("windows");
  const [workspaceMultilogin, setWorkspaceMultilogin] = useState<MultiloginProfileSelection>();
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileCreationStage, setProfileCreationStage] = useState<string>();
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileActionError, setProfileActionError] = useState<string | null>(null);
  const [pendingRuntimeInstall, setPendingRuntimeInstall] = useState<{ profile: string; runtime: Exclude<ProfileToolsetOption, "multilogin">; onSettled?: (error?: string) => void }>();
  const [profileMoveError, setProfileMoveError] = useState<string | null>(null);
  const [profileConnectionEditor, setProfileConnectionEditor] = useState<{ name: string; connection: "managed" | "direct" | "personal"; country: string; proxyId: string } | null>(null);
  const [profileConnectionSaving, setProfileConnectionSaving] = useState(false);
  const [profileConnectionError, setProfileConnectionError] = useState<string | null>(null);
  const [workspaceCreatorOpen, setWorkspaceCreatorOpen] = useState(false);
  const [workspaceDeleteId, setWorkspaceDeleteId] = useState<string>();
  const [workspaceDeletePending, setWorkspaceDeletePending] = useState(false);
  const [workspaceDeleteProgress, setWorkspaceDeleteProgress] = useState<string | null>(null);
  const [workspaceDeleteError, setWorkspaceDeleteError] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [chatDeleteError, setChatDeleteError] = useState<string | null>(null);
  const [chatDeleting, setChatDeleting] = useState(false);
  const [activeRecording, setActiveRecording] = useState<ActiveAutomationRecording | undefined>(activeAutomationRecording);
  const [recordingClock, setRecordingClock] = useState(Date.now());
  const [recordingStopping, setRecordingStopping] = useState(false);
  const [recordingError, setRecordingError] = useState<string>();
  const [automationExecution, setAutomationExecution] = useState<AutomationExecution | undefined>(activeAutomationExecution);
  const [automationExecutionClock, setAutomationExecutionClock] = useState(Date.now());
  // The execution whose stalled AI repair was already stopped (see the stall effect).
  const stallHandledFor = useRef<string | undefined>(undefined);
  const [automationExecutionError, setAutomationExecutionError] = useState<string>();
  const profileCreateRequestRef = useRef<string | null>(null);
  const createdProfileRequests = useRef(new Map<string, string>());

  // Resolves with the message shown for a failure, or undefined on success.
  const runProfileAction = (label: string, code: string, action: () => Promise<void>): Promise<string | undefined> => {
    setProfileActionError(null);
    return action().then(() => undefined, async (error: unknown) => {
      if (isProxyTrafficExhaustedError(error)) {
        // nextctl refused the launch because the proxy traffic ran out. That
        // is not an internal error: a gated account has to ask in Discord.
        const message = proxyTrafficLaunchRefusedMessage(useStore.getState().proxy);
        setProfileActionError(message);
        return message;
      }
      const detail = error instanceof Error ? error.message.trim() : String(error ?? "").trim();
      console.error(`[${code}] ${label}`, detail);
      // A VPN in system-proxy mode does not carry the profile's own proxy
      // connection; when that is the likely cause, say what to change.
      const hint = code === "PROFILE_START_FAILED" ? await vpnSystemProxyHint(detail) : "";
      const message = actionFailureMessage(label, code, detail, hint);
      setProfileActionError(message);
      return message;
    });
  };

  // onSettled runs once the start finishes or fails, or when the download
  // prompt is cancelled, so a caller that waits on the start is never stuck.
  const startProfileWithConfirmation = async (
    profile: string,
    runtime: Exclude<ProfileToolsetOption, "multilogin">,
    onSettled?: (error?: string) => void,
  ) => {
    setProfileActionError(null);
    try {
      const available = await invoke<boolean>("browser_runtime_available", { runtime });
      if (!available) {
        trackEvent("browser_runtime_download_prompted", { runtime });
        setPendingRuntimeInstall({ profile, runtime, onSettled });
        return;
      }
      void runProfileAction(`We couldn't start “${profile}”.`, "PROFILE_START_FAILED", () => s.startProfile(profile)).then(onSettled);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProfileActionError(message);
      onSettled?.(message);
    }
  };

  const cancelRuntimeInstall = () => {
    const request = pendingRuntimeInstall;
    if (request) trackEvent("browser_runtime_download_decided", { runtime: request.runtime, decision: "cancel" });
    setPendingRuntimeInstall(undefined);
    request?.onSettled?.();
  };

  const confirmRuntimeInstall = () => {
    const request = pendingRuntimeInstall;
    if (!request) return;
    trackEvent("browser_runtime_download_decided", { runtime: request.runtime, decision: "download" });
    setPendingRuntimeInstall(undefined);
    void runProfileAction(`We couldn't start “${request.profile}”.`, "PROFILE_START_FAILED", () => s.startProfile(request.profile)).then(request.onSettled);
  };

  useEffect(() => {
    setProfileActionError(null);
    setProfileMoveError(null);
    setProfileConnectionError(null);
  }, [s.activeWorkspaceId]);

  useEffect(() => {
    if (!menuProfile) return;
    const dismissProfileMenu = (event: KeyboardEvent) => {
      if (!shouldDismissModalWithEscape(event)) return;
      event.preventDefault();
      setMenuProfile(null);
    };
    window.addEventListener("keydown", dismissProfileMenu);
    return () => window.removeEventListener("keydown", dismissProfileMenu);
  }, [menuProfile]);

  useEffect(() => {
    if (!workspaceCreatorOpen) return;
    const dismissWorkspaceCreator = (event: KeyboardEvent) => {
      if (!shouldDismissModalWithEscape(event)) return;
      event.preventDefault();
      setWorkspaceCreatorOpen(false);
      setWorkspaceError(null);
    };
    window.addEventListener("keydown", dismissWorkspaceCreator);
    return () => window.removeEventListener("keydown", dismissWorkspaceCreator);
  }, [workspaceCreatorOpen]);

  useEffect(() => {
    if (!manualProxyOpen || manualSaving || manualProxyDeletePending) return;
    const dismissManualProxy = (event: KeyboardEvent) => {
      if (!shouldDismissModalWithEscape(event)) return;
      event.preventDefault();
      setManualProxyOpen(false);
      setManualProxyDeleting(null);
    };
    window.addEventListener("keydown", dismissManualProxy);
    return () => window.removeEventListener("keydown", dismissManualProxy);
  }, [manualProxyOpen, manualSaving, manualProxyDeletePending]);

  useEffect(() => {
    if (!profileConnectionEditor || profileConnectionSaving) return;
    const dismissProfileConnectionEditor = (event: KeyboardEvent) => {
      if (!shouldDismissModalWithEscape(event)) return;
      event.preventDefault();
      setProfileConnectionEditor(null);
    };
    window.addEventListener("keydown", dismissProfileConnectionEditor);
    return () => window.removeEventListener("keydown", dismissProfileConnectionEditor);
  }, [profileConnectionEditor, profileConnectionSaving]);

  useEffect(() => {
    if (!pendingRuntimeInstall) return;
    const dismissRuntimeInstall = (event: KeyboardEvent) => {
      if (!shouldDismissModalWithEscape(event)) return;
      event.preventDefault();
      cancelRuntimeInstall();
    };
    window.addEventListener("keydown", dismissRuntimeInstall);
    return () => window.removeEventListener("keydown", dismissRuntimeInstall);
  }, [pendingRuntimeInstall]);

  useEffect(() => {
    if (!confirmDelete || profileDeleting) return;
    const dismissProfileDelete = (event: KeyboardEvent) => {
      if (!shouldDismissModalWithEscape(event)) return;
      event.preventDefault();
      setConfirmDelete(null);
    };
    window.addEventListener("keydown", dismissProfileDelete);
    return () => window.removeEventListener("keydown", dismissProfileDelete);
  }, [confirmDelete, profileDeleting]);

  useEffect(() => {
    if (!confirmDeleteChat) return;
    const dismissChatDelete = (event: KeyboardEvent) => {
      if (!shouldDismissModalWithEscape(event)) return;
      event.preventDefault();
      setConfirmDeleteChat(null);
    };
    window.addEventListener("keydown", dismissChatDelete);
    return () => window.removeEventListener("keydown", dismissChatDelete);
  }, [confirmDeleteChat]);

  const profiles = s.profiles;
  const projects = s.conversations.filter((project) => project.workspaceId === s.activeWorkspaceId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const activeWorkspace = s.workspaces.find((workspace) => workspace.id === s.activeWorkspaceId);
  const workspaceToDelete = s.workspaces.find(workspace => workspace.id === workspaceDeleteId);
  const projectsToDelete = workspaceToDelete ? s.conversations.filter(project => project.workspaceId === workspaceToDelete.id).length : 0;
  const manualProxyBatch = useMemo(() => parseManualProxyBatch(manualProxyBulk), [manualProxyBulk]);
  // The Guide picks its target from the same list, so a workspace entry whose
  // profile was deleted can never become the profile a Guide step starts.
  const guideProfileNames = guideWorkspaceProfileNames(s.activeWorkspaceId, s.workspaces, profiles);
  useEffect(() => {
    const handleProjectShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setProjectsMenuOpen(true);
        return;
      }
      const index = Number.parseInt(event.key, 10) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= Math.min(projects.length, 9)) return;
      event.preventDefault();
      s.selectConversation(projects[index].id);
      s.setTab("chat");
    };
    window.addEventListener("keydown", handleProjectShortcut);
    return () => window.removeEventListener("keydown", handleProjectShortcut);
  }, [projects, s]);
  const skillCount = withLocalScripts(s.skillCategories).reduce((total, category) => total + category.entries.length, 0);
  const defaultStatus = s.defaultSession?.status ?? "unknown";
  const defaultKnown = !!s.defaultSession?.session?.name || defaultStatus !== "unknown";
  const defaultRunning = defaultStatus === "running";
  const defaultBusy = s.nextctlUpdating || ["starting", "stopping", "rotating"].includes(defaultStatus);
  const defaultSessionDuplicate = defaultRunning && Object.values(s.profileSessions).some((session) =>
    session.status === "running" && (
      (!!session.pid && session.pid === s.defaultSession?.pid) ||
      (!!session.session?.endpoint && session.session.endpoint === s.defaultSession?.session?.endpoint)
    ),
  );
  const showDefaultProfile = !!activeWorkspace?.profileNames.includes("__default") && defaultKnown &&
    !defaultSessionDuplicate &&
    !s.profiles.some((p) => p.name === "default");
  const multiloginBrowserProfiles = multiloginStatus?.browserProfiles ?? [];
  const multiloginCloudPhones = multiloginStatus?.cloudPhones ?? [];
  const multiloginKindProfiles = multiloginKind === "browser" ? multiloginBrowserProfiles : multiloginCloudPhones;
  const multiloginVisibleProfiles = filterMultiloginProfiles(multiloginKindProfiles, multiloginQuery);
  const multiloginRawKindError = multiloginKind === "browser"
    ? multiloginStatus?.browserProfilesError
    : multiloginStatus?.cloudPhonesError;
  const multiloginKindError = multiloginRawKindError
    ? userFacingMultiloginError(multiloginRawKindError, multiloginKind === "browser" ? "browser" : "mobile")
    : undefined;
  const multiloginReady = multiloginConnected(multiloginStatus);
  const multiloginExisting = profileToolset === "multilogin" && multiloginMode === "existing";
  const proxyCountries = s.proxyCountries.length ? s.proxyCountries : ROTATION_COUNTRIES;
  const recordingWorkspace = activeRecording ? s.workspaces.find((workspace) => workspace.id === activeRecording.workspaceId) : undefined;
  const automationExecutionWorkspace = automationExecution ? s.workspaces.find((workspace) => workspace.id === automationExecution.workspaceId) : undefined;
  const automationExecutionState = automationExecution ? automationExecutionView(automationExecution, s.conversations, automationExecutionClock) : undefined;
  const automationExecutionLabel = automationExecution?.sourceKind === "recording" ? "Replay" : "Workflow";
  const automationAgentStatus = automationExecution?.engine === "agent" ? automationAgentAnswer(automationExecution, s.conversations)?.status : undefined;
  const recordingDestinationLabel = activeRecording?.destination === "workflow" ? "Workflow Builder" : "Recorder";
  const recordingMiniLabel = activeRecording ? `${recordingDestinationLabel} ${recordingDuration(activeRecording.startedAt, recordingClock)}` : "Recording";

  useEffect(() => {
    const sync = () => { setActiveRecording(activeAutomationRecording()); setRecordingClock(Date.now()); setRecordingError(undefined); };
    window.addEventListener(AUTOMATION_RECORDING_EVENT, sync);
    return () => window.removeEventListener(AUTOMATION_RECORDING_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!activeRecording || activeRecording.phase !== "recording") return;
    const timer = window.setInterval(() => setRecordingClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [activeRecording]);

  useEffect(() => {
    const sync = () => { setAutomationExecution(activeAutomationExecution()); setAutomationExecutionClock(Date.now()); setAutomationExecutionError(undefined); };
    window.addEventListener(AUTOMATION_EXECUTION_EVENT, sync);
    return () => window.removeEventListener(AUTOMATION_EXECUTION_EVENT, sync);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen<AutomationRecipeProgress>("automation:recipe-progress", ({ payload }) => {
      const current = activeAutomationExecution();
      if (!current || current.executionId !== payload.executionId) return;
      setActiveAutomationExecution(executionWithRecipeProgress(current, payload));
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    }).catch(() => undefined);
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    if (!automationExecution || !automationExecutionState || ["completed", "failed", "cancelled"].includes(automationExecutionState.phase)) return;
    const timer = window.setInterval(() => setAutomationExecutionClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [automationExecution, automationExecutionState?.phase]);

  useEffect(() => {
    if (!automationExecution || automationExecution.engine !== "agent" || !automationExecution.replyId || !automationExecution.repairValidationRequired) return;
    if (!["preparing", "running"].includes(automationExecution.phase) || automationExecutionClock - automationExecution.startedAt < 120_000) return;
    // Handle a stall once per execution. Stopping the reply writes to the
    // store, which re-renders and re-runs this effect before the execution
    // below reaches local state; without the guard each pass stopped the reply
    // and started another repair until React gave up (error #185, blank UI).
    if (stallHandledFor.current === automationExecution.executionId) return;
    const store = useStore.getState();
    const answer = automationAgentAnswer(automationExecution, store.conversations);
    if (!answer || !["queued", "streaming"].includes(answer.status) || automationAgentBrowserActionCount(automationExecution, store.conversations) > 0) return;
    stallHandledFor.current = automationExecution.executionId;
    const attempt = automationExecution.repairAttempt || 0;
    // The app stops the reply, not the user, so it is reported as a timeout.
    if (store.cancelQueuedReply(automationExecution.replyId) === false) store.stopReply(automationExecution.replyId, { reason: "timeout" });
    if (attempt >= 1 || !automationExecution.workflowSnapshot) {
      setActiveAutomationExecution({ ...automationExecution, phase: "failed", progress: 100, detail: "AI repair made no browser progress after two attempts. Retry when the agent is available.", error: "AI repair stalled before its first browser action." });
      reportUserFacingError({ surface: "automation-repair", code: "AUTOMATION_REPAIR_STALLED" });
      return;
    }
    const retrying: AutomationExecution = { ...automationExecution, executionId: uid(), replyId: undefined, startedAt: Date.now(), phase: "preparing", progress: 8, detail: "The first AI repair stalled. Restarting it once automatically…", repairAttempt: 1 };
    setActiveAutomationExecution(retrying);
    void store.runLocalSkill(automationExecution.workflowSnapshot, automationRepairTask(
      automationExecution.task,
      automationExecution.workflowSnapshot.actions,
      automationExecution.failedStep,
      `${automationExecution.error || automationExecution.detail || "The deterministic step failed."} The previous AI repair stalled before its first browser action. Start with the browser action immediately.`,
    )).then((replyId) => {
      const current = activeAutomationExecution();
      if (!current || current.executionId !== retrying.executionId) return;
      if (!replyId) {
        reportUserFacingError({ surface: "automation-repair", code: "AUTOMATION_REPAIR_RETRY_FAILED" });
        return setActiveAutomationExecution({ ...retrying, phase: "failed", progress: 100, detail: "The automatic AI retry could not be started." });
      }
      setActiveAutomationExecution({ ...retrying, replyId, phase: "running", detail: "AI repair restarted automatically…" });
    }).catch((error) => {
      reportUserFacingError({ surface: "automation-repair", code: "AUTOMATION_REPAIR_RETRY_FAILED" });
      setActiveAutomationExecution({ ...retrying, phase: "failed", progress: 100, detail: error instanceof Error ? error.message : String(error) });
    });
  }, [automationExecution?.executionId, automationExecution?.phase, automationExecution?.replyId, automationExecution?.startedAt, automationExecutionClock, s.conversations]);

  useEffect(() => {
    if (!automationExecution || automationExecution.engine !== "agent" || !automationExecution.repairValidationRequired || automationExecution.outputValidated || automationExecution.outputValidationError) return;
    if (automationAgentStatus !== "done") return;
    let cancelled = false;
    void (async () => {
      const answer = automationAgentAnswer(automationExecution, useStore.getState().conversations);
      if (!answer || /(?:could not|couldn't|unable to|failed to|did not complete|was not completed)/i.test(answer.text)) {
        throw new Error("AI repair did not complete the original workflow goal.");
      }
      let artifactVerified = !automationExecution.expectedArtifactName;
      for (let attempt = 0; attempt < 4 && !artifactVerified; attempt += 1) {
        const items = await invoke<Array<{ id: string; name: string; createdAt: number }>>("artifact_list", { workspaceId: automationExecution.workspaceId });
        const artifact = items.find((item) => item.name === automationExecution.expectedArtifactName && item.createdAt >= automationExecution.startedAt);
        if (artifact) {
          const validation = await invoke<{ valid: boolean; reason?: string }>("artifact_validate", { workspaceId: automationExecution.workspaceId, id: artifact.id });
          if (!validation.valid) throw new Error(validation.reason || `AI repair created ${automationExecution.expectedArtifactName}, but its data is incomplete.`);
          artifactVerified = true;
        }
        if (!artifactVerified && attempt < 3) await new Promise((resolve) => window.setTimeout(resolve, 400));
      }
      if (!artifactVerified) throw new Error(`AI repair finished, but it did not create ${automationExecution.expectedArtifactName}. The workflow result was not accepted.`);

      let persisted = false;
      let persistenceError: string | undefined;
      try {
        if (automationExecution.sourceKind === "workflow") {
          const workflows = await invoke<BrowserWorkflowSkill[]>("automation_workflows_list", { workspaceId: automationExecution.workspaceId });
          const workflow = workflows.find((item) => item.id === automationExecution.sourceId);
          if (!workflow) throw new Error("The repaired workflow no longer exists.");
          const repaired = parseAutomationRepairRecipe(answer.text, automationExecution.workflowSnapshot?.actions || workflow.actions, automationExecution.workflowSnapshot?.domain || workflow.domain);
          if (!repaired) throw new Error("AI completed the task but did not return a safe reusable recipe.");
          await invoke("automation_workflow_put", {
            workspaceId: automationExecution.workspaceId,
            workflow: {
              ...workflow,
              actions: repaired.actions,
              recipe: { ...workflow.recipe, actions: repaired.actions },
              instructions: `${workflow.instructions.replace(/\n*Automatically repaired on .*$/s, "").trim()}\n\nAutomatically repaired on ${new Date().toISOString()}; future runs use the updated deterministic steps.`,
            },
          });
          persisted = true;
        } else {
          type Recording = { id: string; revision: number; status: string; document: { run?: { evidence: string; captureSource?: string; answer: { text: string; toolEvents?: Array<{ id: string; name: string; detail?: string; createdAt: number }> } }; [key: string]: unknown } };
          const recordings = await invoke<Recording[]>("automation_recordings_list", { workspaceId: automationExecution.workspaceId });
          const recording = recordings.find((item) => item.id === automationExecution.sourceId);
          const originalRun = recording?.document.run;
          if (!recording || !originalRun) throw new Error("The repaired recording no longer exists.");
          const originalActions = [...originalRun.evidence.matchAll(/Called (?:clawbrowser|nextbrowser)\.([a-z_]+)\((\{[^\n]*\})\)/g)].flatMap((match) => {
            try { return [{ tool: match[1], arguments: JSON.parse(match[2]) as Record<string, unknown> }]; } catch { return []; }
          });
          const repaired = parseAutomationRepairRecipe(answer.text, originalActions, automationExecution.workflowSnapshot?.domain);
          if (!repaired) throw new Error("AI completed the task but did not return a safe reusable recipe.");
          const now = Date.now();
          await invoke("automation_recording_put", { recording: {
            id: recording.id,
            workspace_id: automationExecution.workspaceId,
            status: "completed",
            document: { ...recording.document, run: {
              ...originalRun,
              evidence: repairedRecipeEvidence(repaired.actions),
              captureSource: "hybrid",
              answer: {
                ...originalRun.answer,
                text: "Automatically repaired and verified against the original task.",
                toolEvents: repaired.actions.map((action, index) => ({ id: `${recording.id}-repair-${index}`, name: `clawbrowser.${action.tool}`, detail: JSON.stringify(action.arguments), createdAt: now + index })),
              },
            } },
            base_revision: recording.revision || 0,
          } });
          persisted = true;
        }
      } catch (error) {
        persistenceError = error instanceof Error ? error.message : String(error);
      }
      if (cancelled) return;
      if (persisted) window.dispatchEvent(new CustomEvent("nextbrowser:automation-library-change", { detail: { sourceKind: automationExecution.sourceKind } }));
      else reportUserFacingError({ surface: "automation-repair", code: "AUTOMATION_REPAIR_NOT_SAVED" });
      const detail = persisted
        ? `${automationExecution.sourceKind === "workflow" ? "Workflow" : "Recording"} completed. AI repaired the fast path and saved it for future runs.`
        : `The original task completed, but the repaired fast path was not saved: ${persistenceError}`;
      if (automationExecution.backendRunId) {
        await invoke("automation_run_update", { id: automationExecution.backendRunId, update: { status: "completed", output: { engine: "hybrid", repaired: true, fast_path_saved: persisted, detail } } }).catch(() => undefined);
      }
      setActiveAutomationExecution(withAutomationExecutionEvent({ ...automationExecution, phase: "completed", outputValidated: true, repairPersisted: persisted, repairPersistenceError: persistenceError, progress: 100, detail }, {
        kind: "repair",
        title: persisted ? "Repair verified and saved" : "Repair verified, but not saved",
        detail,
        state: persisted ? "success" : "failed",
      }));
    })().catch((error) => {
      if (cancelled) return;
      const detail = error instanceof Error ? error.message : String(error);
      reportUserFacingError({ surface: "automation-repair", code: "AUTOMATION_REPAIR_VALIDATION_FAILED" });
      if (automationExecution.backendRunId) void invoke("automation_run_update", { id: automationExecution.backendRunId, update: { status: "failed", output: { engine: "hybrid", repaired: false, detail } } }).catch(() => undefined);
      setActiveAutomationExecution(withAutomationExecutionEvent({ ...automationExecution, phase: "failed", progress: 100, outputValidationError: detail, detail }, {
        kind: "validation", title: "Repair result did not pass validation", detail, state: "failed",
      }));
    });
    return () => { cancelled = true; };
  }, [automationExecution?.executionId, automationExecution?.expectedArtifactName, automationExecution?.outputValidated, automationExecution?.outputValidationError, automationExecution?.repairValidationRequired, automationExecution?.startedAt, automationAgentStatus]);

  const openRecorder = () => {
    if (activeRecording?.workspaceId && activeRecording.workspaceId !== s.activeWorkspaceId) s.selectWorkspace(activeRecording.workspaceId);
    s.setTab("automation");
    const eventName = activeRecording?.destination === "workflow" ? "nextbrowser:open-workflow" : "nextbrowser:open-recorder";
    window.setTimeout(() => window.dispatchEvent(new CustomEvent(eventName)), 0);
  };

  const stopRecording = async () => {
    if (!activeRecording || activeRecording.phase !== "recording" || recordingStopping) return;
    setRecordingStopping(true);
    setRecordingError(undefined);
    sessionStorage.setItem("nextbrowser:automation-stop-request", activeRecording.id);
    openRecorder();
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("nextbrowser:request-stop-recording")), 0);
    window.setTimeout(() => setRecordingStopping(false), 1_000);
  };

  const openAutomationExecution = () => {
    if (!automationExecution) return;
    if (automationExecution.workspaceId !== s.activeWorkspaceId) s.selectWorkspace(automationExecution.workspaceId);
    s.setTab("automation");
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("nextbrowser:open-automation-execution", { detail: { sourceKind: automationExecution.sourceKind } })), 0);
  };

  const stopAutomationExecution = async () => {
    if (!automationExecution || automationExecution.phase === "stopping") return;
    setAutomationExecutionError(undefined);
    const stopping: AutomationExecution = { ...automationExecution, phase: "stopping" };
    setAutomationExecution(stopping);
    setActiveAutomationExecution(stopping);
    let cancelledWhileQueued = false;
    if (stopping.engine === "deterministic") {
      try { await invoke("automation_recipe_cancel", { executionId: stopping.executionId }); }
      catch (error) { setAutomationExecutionError(error instanceof Error ? error.message : String(error)); }
    } else {
      cancelledWhileQueued = !!stopping.replyId && s.cancelQueuedReply(stopping.replyId);
      if (!cancelledWhileQueued) {
        if (stopping.replyId) s.stopReply(stopping.replyId);
        else s.stopRunning();
      }
    }
    if (stopping.backendRunId) {
      try { await invoke("automation_run_update", { id: stopping.backendRunId, update: { status: "cancelled", output: { detail: "Stopped by user." } } }); }
      catch (error) { setAutomationExecutionError(error instanceof Error ? error.message : String(error)); }
    }
    if (cancelledWhileQueued) window.setTimeout(clearActiveAutomationExecution, 600);
  };

  const refreshMultiloginStatus = async () => {
    if (getPreviewMode()) {
      setMultiloginStatus(previewMultiloginConnectionStatus());
      return;
    }
    setMultiloginChecking(true);
    setMultiloginError(undefined);
    try {
      setMultiloginStatus(await invoke<MultiloginConnectionStatus>("multilogin_status"));
    } catch (error) {
      // A failed check is an app problem, not a verdict on the connection, so
      // it leaves the state unknown and never routes anyone to the connector.
      setMultiloginStatus(null);
      setMultiloginError(error instanceof Error ? error.message : String(error));
    } finally {
      setMultiloginChecking(false);
    }
  };

  const openProfileCreator = (options?: { toolset?: ProfileToolsetOption; forLive?: boolean }) => {
    if (!s.authed) {
      s.setDashboardKeyPromptOpen(true);
      return;
    }
    const toolset = options?.toolset ?? "clawbrowser";
    createForLive.current = options?.forLive === true;
    setProfileName("");
    setProfileCountry("US");
    setProfileConnection("managed");
    setProfilePersonalProxyId(s.personalProxies[0]?.id ?? "");
    setProfileToolset(toolset);
    setMultiloginMode("new");
    setMultiloginKind("browser");
    setMultiloginQuery("");
    setMultiloginDraft(undefined);
    setProfileError(null);
    setCreateProfileOpen(true);
    void Promise.all([
      s.loadProxyCountries().catch(() => undefined),
      s.loadPersonalProxies().catch(() => undefined),
    ]);
    if (toolset === "multilogin" || !multiloginStatus) void refreshMultiloginStatus();
  };

  const openProfileCreatorRef = useRef(openProfileCreator);
  useEffect(() => { openProfileCreatorRef.current = openProfileCreator; });
  useEffect(() => {
    const create = () => openProfileCreatorRef.current({ forLive: true });
    window.addEventListener(CREATE_LIVE_PROFILE_EVENT, create);
    return () => window.removeEventListener(CREATE_LIVE_PROFILE_EVENT, create);
  }, []);

  const routeToMultiloginConnector = () => {
    setCreateProfileOpen(false);
    setProfileToolset("clawbrowser");
    s.openConnectorPrompt("multilogin", "profile-create");
  };

  // Selecting Multilogin without a connection is a setup request: hand the
  // person to the connector and bring them back to profile creation after.
  useEffect(() => {
    if (!createProfileOpen || profileToolset !== "multilogin") return;
    if (multiloginChecking || !multiloginStatus || multiloginConnected(multiloginStatus)) return;
    routeToMultiloginConnector();
  }, [createProfileOpen, profileToolset, multiloginChecking, multiloginStatus]);

  useEffect(() => {
    const resumeProfileCreation = (event: Event) => {
      const detail = (event as CustomEvent).detail as { connector?: string; resume?: string } | undefined;
      if (detail?.connector !== "multilogin" || detail.resume !== "profile-create") return;
      void refreshMultiloginStatus();
      openProfileCreatorRef.current({ toolset: "multilogin", forLive: createForLive.current });
    };
    window.addEventListener(CONNECTOR_PROMPT_RESUMED_EVENT, resumeProfileCreation);
    return () => window.removeEventListener(CONNECTOR_PROMPT_RESUMED_EVENT, resumeProfileCreation);
  }, []);

  useEffect(() => {
    const refreshSelection = () => setWorkspaceMultilogin(multiloginSelectionForWorkspace(s.activeWorkspaceId));
    refreshSelection();
    window.addEventListener(MULTILOGIN_SELECTION_EVENT, refreshSelection);
    return () => window.removeEventListener(MULTILOGIN_SELECTION_EVENT, refreshSelection);
  }, [s.activeWorkspaceId]);

  // The Multilogin profile runs outside the local profile store, so its row
  // asks nextctl for its state instead of relying on the profile list poll.
  const workspaceMultiloginId = workspaceMultilogin?.id;
  useEffect(() => {
    if (!workspaceMultilogin || !s.authed) return;
    const refresh = () => { if (!document.hidden) void s.refreshMultiloginStatus(workspaceMultilogin); };
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceMultiloginId, s.authed]);

  useEffect(() => {
    if (s.authed) void s.loadPersonalProxies().catch(() => undefined);
  }, [s.authed]);

  useEffect(() => {
    if (profilePersonalProxyId || s.personalProxies.length === 0) return;
    setProfilePersonalProxyId(s.personalProxies[0].id);
  }, [profilePersonalProxyId, s.personalProxies]);



  useEffect(() => {
    setProfileMoveError(null);
    if (menuProfile) void s.loadProxyCountries().catch(() => {});
  }, [menuProfile]);

  useEffect(() => {
    const revealProject = () => setProjectsMenuOpen(true);
    window.addEventListener("nextbrowser:project-created", revealProject);
    return () => window.removeEventListener("nextbrowser:project-created", revealProject);
  }, []);

  useEffect(() => {
    const focusProfiles = () => {
      s.setProfileSearch(""); s.showLiveOverview();
    };
    const openCreator = () => {
      focusProfiles();
      if (!s.authed) {
        s.setDashboardKeyPromptOpen(true);
        return;
      }
      openProfileCreator();
    };
    const openActions = () => {
      focusProfiles();
      const profile = guideProfileTarget(s.selectedProfile, guideProfileNames, showDefaultProfile);
      if (profile) { setMenuAnchor(null); setMenuProfile(profile); }
    };
    const startSelectedProfile = () => {
      focusProfiles();
      s.setProfileSearch("");
      // The tour steps aside while it starts a profile, so the download prompt
      // and start errors are not hidden under it. Bring it back, with the
      // error, once the start settles. A no-op when the tour is not waiting.
      const resumeTour = (error?: string) => s.resumeOnboardingAfterSetup(error);
      const profile = guideProfileTarget(s.selectedProfile, guideProfileNames, showDefaultProfile);
      if (!profile) { openCreator(); return; }
      if (profile === "__default") {
        s.selectProfile(undefined);
        if (!defaultRunning && !defaultBusy) {
          void runProfileAction("We couldn't start the default profile.", "PROFILE_START_FAILED", s.startDefaultSession).then(resumeTour);
        } else {
          resumeTour();
        }
        return;
      }
      s.selectProfile(profile);
      const status = s.statuses[profile] ?? s.profileSessions[profile]?.status ?? "unknown";
      if (status !== "running" && !["starting", "stopping", "rotating"].includes(status)) {
        const runtime = activeWorkspace?.profileToolsets[profile] ?? "clawbrowser";
        void startProfileWithConfirmation(profile, runtime, resumeTour);
      } else {
        resumeTour();
      }
    };
    window.addEventListener("nextbrowser:focus-profiles", focusProfiles);
    window.addEventListener("nextbrowser:open-profile-creator", openCreator);
    window.addEventListener("nextbrowser:open-profile-actions", openActions);
    window.addEventListener("nextbrowser:start-selected-profile", startSelectedProfile);
    return () => {
      window.removeEventListener("nextbrowser:focus-profiles", focusProfiles);
      window.removeEventListener("nextbrowser:open-profile-creator", openCreator);
      window.removeEventListener("nextbrowser:open-profile-actions", openActions);
      window.removeEventListener("nextbrowser:start-selected-profile", startSelectedProfile);
    };
  }, [
    activeWorkspace,
    defaultBusy,
    defaultRunning,
    guideProfileNames.join("\u0000"),
    s.authed,
    s.profileSessions,
    s.profiles,
    s.selectedProfile,
    s.setDashboardKeyPromptOpen,
    s.setProfileSearch,
    s.startDefaultSession,
    s.startProfile,
    s.statuses,
    showDefaultProfile,
  ]);

  const badgeFor = (id: AppTab) => {
    if (id === "skills") return skillCount ? String(skillCount) : undefined;
    if (id === "connectors") return String(CONNECTORS.length);
    if (id === "scheduled") return String(s.scheduledRuns.length);
    return undefined;
  };

  const uniqueManualProxyName = (baseName: string, reservedNames?: Set<string>) => {
    const base = baseName.trim() || "manual-proxy";
    const existing = reservedNames ?? new Set(s.personalProxies.map((proxy) => proxy.name));
    if (!existing.has(base)) return base;
    for (let index = 2; index < 1000; index += 1) {
      const suffix = `-${index}`;
      const candidate = `${base.slice(0, manualProxyLimits.name - suffix.length)}${suffix}`;
      if (!existing.has(candidate)) return candidate;
    }
    const suffix = `-${Date.now()}`;
    return `${base.slice(0, manualProxyLimits.name - suffix.length)}${suffix}`;
  };

  const resetManualProxyForm = () => {
    setManualProxyMode("url");
    setManualProxyUrl("");
    setManualProxyBulk("");
    setManualName("");
    setManualScheme("http");
    setManualHost("");
    setManualPort("8080");
    setManualUsername("");
    setManualPassword("");
    setManualError(null);
  };

  const proxyTestRevertTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => () => {
    for (const timer of Object.values(proxyTestRevertTimers.current)) clearTimeout(timer);
  }, []);

  const runProxyTest = (id: string) => {
    if (proxyTestResults[id]?.status === "testing") return;
    clearTimeout(proxyTestRevertTimers.current[id]);
    setProxyTestResults((current) => ({ ...current, [id]: { status: "testing", detail: "" } }));
    const revertAfter = () => {
      proxyTestRevertTimers.current[id] = setTimeout(() => {
        setProxyTestResults((current) => {
          const { [id]: _removed, ...rest } = current;
          return rest;
        });
      }, PROXY_TEST_RESULT_MS);
    };
    s.testPersonalProxy(id)
      .then((result) => {
        setProxyTestResults((current) => ({
          ...current,
          [id]: { status: "ok", detail: result.ip ? `Alive · ${result.ip} · ${result.latencyMs}ms` : `Alive · ${result.latencyMs}ms` },
        }));
        revertAfter();
      })
      .catch((error: unknown) => {
        const message = userFacingBrowserError(error);
        setProxyTestResults((current) => ({ ...current, [id]: { status: "fail", detail: message } }));
      });
  };

  const closeProfileCreator = () => {
    createForLive.current = false;
    const requestId = profileCreateRequestRef.current;
    profileCreateRequestRef.current = null;
    if (requestId) void cancelNextctlRun(requestId);
    setProfileSaving(false);
    setProfileCreationStage(undefined);
    setCreateProfileOpen(false);
    s.resumeOnboardingAfterSetup();
  };

  const submitManualProxy = async (event: FormEvent) => {
    event.preventDefault();
    if (manualProxyMode === "bulk") {
      if (manualProxyBatch.errors.length) {
        const details = manualProxyBatch.errors.slice(0, 4)
          .map((error) => `${error.lineNumber ? `Line ${error.lineNumber}: ` : ""}${error.message}`)
          .join("\n");
        const remaining = manualProxyBatch.errors.length - 4;
        setManualError(`${details}${remaining > 0 ? `\n…and ${remaining} more.` : ""}`);
        return;
      }
      if (!manualProxyBatch.items.length) {
        setManualError("Enter at least one proxy, one per line.");
        return;
      }

      const reservedNames = new Set(s.personalProxies.map((proxy) => proxy.name));
      const inputs = manualProxyBatch.items.map(({ proxy }) => {
        const name = uniqueManualProxyName(manualProxyDefaultName(proxy), reservedNames);
        reservedNames.add(name);
        return { name, ...proxy };
      });
      setManualSaving(true);
      setManualError(null);
      try {
        const result = await s.savePersonalProxies(inputs);
        const lastSaved = result.saved.at(-1)?.proxy;
        if (lastSaved) {
          setProfilePersonalProxyId(lastSaved.id);
          setProfileConnectionEditor((current) => current?.connection === "personal" ? { ...current, proxyId: lastSaved.id } : current);
        }
        if (!result.failed.length) {
          resetManualProxyForm();
          setManualProxyEditing(false);
          return;
        }

        const failedItems = result.failed.map(({ index }) => manualProxyBatch.items[index]).filter(Boolean);
        setManualProxyBulk(failedItems.map(({ raw }) => raw).join("\n"));
        const firstFailures = result.failed.slice(0, 3).map(({ index, message }) => {
          const detail = message.replace(/^Error invoking remote method '[^']+': Error:\s*/, "").trim();
          return `Line ${manualProxyBatch.items[index]?.lineNumber ?? index + 1}: ${detail || "Could not save this proxy."}`;
        });
        setManualError(`${result.saved.length} saved; ${result.failed.length} failed. Only failed lines remain.\n${firstFailures.join("\n")}`);
      } catch (error) {
        const detail = (error instanceof Error ? error.message : String(error))
          .replace(/^Error invoking remote method '[^']+': Error:\s*/, "")
          .trim();
        setManualError(detail || internalError("We couldn't save the proxy list. Try again.", "PERSONAL_PROXY_BULK_SAVE_FAILED"));
      } finally {
        setManualSaving(false);
      }
      return;
    }

    const name = manualName.trim();
    let input: ManualProxyProfileInput;
    if (manualProxyMode === "url") {
      let parsed;
      try {
        parsed = parseManualProxyClipboard(manualProxyUrl);
      } catch (error) {
        setManualError(error instanceof Error ? error.message : String(error));
        return;
      }
      input = {
        name: name || uniqueManualProxyName(manualProxyDefaultName(parsed)),
        scheme: parsed.scheme,
        host: parsed.host,
        port: parsed.port,
        username: parsed.username,
        password: parsed.password,
      };
    } else {
      const port = Number(manualPort);
      try {
        validateManualProxyFields({ name, host: manualHost, port, username: manualUsername, password: manualPassword });
      } catch (error) {
        setManualError(error instanceof Error ? error.message : String(error));
        return;
      }
      input = {
        name,
        scheme: manualScheme,
        host: manualHost,
        port,
        username: manualUsername,
        password: manualPassword,
      };
    }
    try {
      validateManualProxyFields(input);
    } catch (error) {
      setManualError(error instanceof Error ? error.message : String(error));
      return;
    }
    setManualSaving(true);
    setManualError(null);
    try {
      const saved = await s.savePersonalProxy(input);
      setProfilePersonalProxyId(saved.id);
      setProfileConnectionEditor((current) => current?.connection === "personal" ? { ...current, proxyId: saved.id } : current);
      resetManualProxyForm();
      setManualProxyEditing(false);
    } catch (error) {
      const detail = (error instanceof Error ? error.message : String(error))
        .replace(/^Error invoking remote method '[^']+': Error:\s*/, "")
        .trim();
      setManualError(detail && !/^fetch failed$/i.test(detail)
        ? detail
        : internalError("We couldn't save the proxy. Check the format and your connection, then try again.", "PERSONAL_PROXY_SAVE_FAILED"));
    } finally {
      setManualSaving(false);
    }
  };

  const importManualProxyFromClipboard = async () => {
    setManualError(null);
    try {
      const clipboard = await navigator.clipboard.readText();
      if (manualProxyMode === "bulk") {
        setManualProxyBulk(clipboard);
        return;
      }
      const parsed = parseManualProxyClipboard(clipboard);
      setManualProxyMode(parsed.source === "fields" ? "fields" : "url");
      setManualScheme(parsed.scheme);
      setManualHost(parsed.host);
      setManualPort(String(parsed.port));
      setManualUsername(parsed.username);
      setManualPassword(parsed.password);
      if (parsed.source === "url") {
        setManualProxyUrl(`${parsed.scheme}://${parsed.username ? `${encodeURIComponent(parsed.username)}:${encodeURIComponent(parsed.password)}@` : ""}${parsed.host}:${parsed.port}`);
      }
      if (!manualName.trim()) setManualName(uniqueManualProxyName(manualProxyDefaultName(parsed)));
    } catch (error) {
      setManualError(error instanceof Error ? error.message : "Clipboard does not contain a supported proxy.");
    }
  };

  const applyMultiloginSelection = (selection: MultiloginProfileSelection) => {
    const workspaceId = s.activeWorkspaceId;
    if (!workspaceId) return false;
    // The Multilogin profile becomes this workspace's browser default, so the
    // local profile selection has to step aside exactly as in the connector.
    s.selectProfile(undefined);
    setMultiloginSelection(workspaceId, selection);
    return true;
  };

  const finishMultiloginProfile = (selection: MultiloginProfileSelection) => {
    setCreateProfileOpen(false);
    setProfileName("");
    setProfileCountry("US");
    setProfileConnection("managed");
    setProfileToolset("clawbrowser");
    setMultiloginDraft(undefined);
    setMultiloginQuery("");
    s.resumeOnboardingAfterSetup();
    if (createForLive.current) s.openLiveSession(multiloginTargetKey(selection));
    createForLive.current = false;
  };

  const submitMultiloginProfile = async () => {
    if (profileSaving) return;
    if (!s.activeWorkspaceId) {
      setProfileError("Create a workspace before adding a Multilogin profile.");
      return;
    }
    const multiloginConnection = multiloginKind === "browser" && profileConnection === "personal" ? "personal" : "managed";
    const invalid = multiloginSubmitError(multiloginMode, multiloginConnection, profileCountry, multiloginDraft, multiloginKind, profilePersonalProxyId);
    if (invalid) {
      setProfileError(invalid);
      return;
    }
    if (multiloginMode === "existing") {
      if (!multiloginDraft || !applyMultiloginSelection(multiloginDraft)) return;
      finishMultiloginProfile(multiloginDraft);
      return;
    }
    let createdName: string;
    try {
      createdName = validateEntityName("profile", profileName);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : String(error));
      return;
    }
    const requestId = `profile-create-${crypto.randomUUID()}`;
    profileCreateRequestRef.current = requestId;
    setProfileSaving(true);
    const creatingPhone = multiloginKind === "mobile";
    setProfileCreationStage(creatingPhone ? "Creating Multilogin cloud phone" : "Creating Multilogin profile");
    setProfileError(null);
    const proxyStageTimer = window.setTimeout(() => setProfileCreationStage("Attaching Multilogin proxy"), 4_000);
    try {
      const created = await invoke<MultiloginCreatedProfile>(creatingPhone ? "multilogin_mobile_profile_create" : "multilogin_profile_create", {
        name: createdName,
        country: multiloginCreateCountry(multiloginConnection, profileCountry),
        ...(multiloginConnection === "personal" ? { proxyId: profilePersonalProxyId } : {}),
        osType: multiloginOS,
        requestId,
        timeoutMs: PROFILE_CREATE_TIMEOUT_MS,
      });
      if (profileCreateRequestRef.current !== requestId) return;
      const selection = multiloginProfileSelection(creatingPhone ? "mobile" : "browser", created);
      if (useStore.getState().activeWorkspaceId !== s.activeWorkspaceId || !applyMultiloginSelection(selection)) return;
      void refreshMultiloginStatus();
      setProfileCreationStage("Ready");
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      if (profileCreateRequestRef.current !== requestId) return;
      if (useStore.getState().activeWorkspaceId !== s.activeWorkspaceId) createForLive.current = false;
      finishMultiloginProfile(selection);
    } catch (error) {
      if (profileCreateRequestRef.current !== requestId) return;
      setProfileError(multiloginCreationError(error, multiloginKind));
    } finally {
      window.clearTimeout(proxyStageTimer);
      if (profileCreateRequestRef.current === requestId) {
        profileCreateRequestRef.current = null;
        setProfileSaving(false);
        setProfileCreationStage(undefined);
      }
    }
  };

  const submitManagedProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (profileToolset === "multilogin") {
      await submitMultiloginProfile();
      return;
    }
    try {
      validateEntityName("profile", profileName);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (profileSaving) return;
    const targetWorkspaceId = s.activeWorkspaceId;
    if (!targetWorkspaceId) { setProfileError("Choose a workspace first."); return; }
    const creationKey = JSON.stringify([targetWorkspaceId, profileName.trim(), profileToolset, profileConnection, profileCountry, profilePersonalProxyId]);
    const requestId = `profile-create-${crypto.randomUUID()}`;
    profileCreateRequestRef.current = requestId;
    setProfileSaving(true);
    setProfileCreationStage("Saving profile");
    setProfileError(null);
    const runtimeStageTimer = window.setTimeout(() => setProfileCreationStage("Preparing browser runtime"), 600);
    const identityStageTimer = window.setTimeout(() => setProfileCreationStage(
      profileConnection === "managed"
        ? "Preparing identity and proxy"
        : profileConnection === "personal" ? "Applying personal proxy" : "Finalizing profile",
    ), 4_000);
    try {
      let createdName = createdProfileRequests.current.get(creationKey) || profileName.trim();
      if (!createdProfileRequests.current.has(creationKey)) {
        if (profileConnection === "personal") {
          if (!profilePersonalProxyId) throw new Error("Choose a personal proxy.");
          createdName = await s.createPersonalProxyProfile(createdName, profilePersonalProxyId, {
            requestId,
            timeoutMs: PROFILE_CREATE_TIMEOUT_MS,
            runtime: profileToolset,
          });
        } else {
          createdName = await s.createManagedProfile(createdName, profileCountry, {
            requestId,
            timeoutMs: PROFILE_CREATE_TIMEOUT_MS,
            runtime: profileToolset,
            direct: profileConnection === "direct",
          });
        }
        createdProfileRequests.current.set(creationKey, createdName);
      }
      if (profileCreateRequestRef.current !== requestId) return;
      await s.assignProfileToProject(
        createdName,
        profileToolset,
        targetWorkspaceId,
        true,
        profileConnection === "personal" ? profilePersonalProxyId : undefined,
      );
      createdProfileRequests.current.delete(creationKey);
      if (profileCreateRequestRef.current !== requestId) return;
      if (useStore.getState().activeWorkspaceId === targetWorkspaceId) s.selectProfile(createdName);
      window.dispatchEvent(new CustomEvent("nextbrowser:profile-created", { detail: { name: createdName } }));
      setProfileCreationStage("Ready");
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      if (profileCreateRequestRef.current !== requestId) return;
      setCreateProfileOpen(false);
      setProfileName("");
      setProfileCountry("US");
      setProfileConnection("managed");
      setProfileToolset("clawbrowser");
      s.resumeOnboardingAfterSetup();
      if (createForLive.current && useStore.getState().activeWorkspaceId === targetWorkspaceId) {
        s.openLiveSession(clawbrowserTargetKey(createdName));
      }
      createForLive.current = false;
    } catch (error) {
      if (profileCreateRequestRef.current !== requestId) return;
      const message = error instanceof Error ? error.message : String(error);
      setProfileError(
        createdProfileRequests.current.has(creationKey)
          ? `The profile was created, but its workspace assignment could not be completed. Try again with the same settings to finish saving it. ${message}`
          : /timed out/i.test(message)
          ? "Profile creation took too long and was stopped. Check your connection, then try again."
          : message,
      );
    } finally {
      window.clearTimeout(runtimeStageTimer);
      window.clearTimeout(identityStageTimer);
      if (profileCreateRequestRef.current === requestId) {
        profileCreateRequestRef.current = null;
        setProfileSaving(false);
        setProfileCreationStage(undefined);
      }
    }
  };

  const personalProxyList = (query: string) => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = s.personalProxies.filter(proxy => words.every(word => `${proxy.name} ${proxy.host} ${proxy.port} ${proxy.scheme}`.toLowerCase().includes(word)));
    return <>{!s.authed && <button type="button" onClick={() => s.setDashboardKeyPromptOpen(true)}>Sign in to load your proxies</button>}
                {filtered.length ? (
                  <div className="personal-proxy-list">
                    {filtered.map((proxy) => {
                      const test = proxyTestResults[proxy.id];
                      const testTitle = test?.status === "testing"
                        ? "Testing…"
                        : test
                          ? test.detail
                          : `Test ${proxy.name}`;
                      return (
                        <div className="personal-proxy-item" key={proxy.id}>
                        <div className="personal-proxy-row">
                          <span className="personal-proxy-icon"><Icon name="network" size={13} /></span>
                          <span className="personal-proxy-copy">
                            <strong>{proxy.name}</strong>
                            <small>{proxy.scheme.toUpperCase()} · {proxy.host}:{proxy.port}</small>
                          </span>
                          <Tooltip content={testTitle}><button
                            type="button"
                            className={"plain-icon-btn plain-icon-btn-compact proxy-test-btn" + (test ? ` proxy-test-${test.status}` : "")}
                            aria-label={testTitle}
                            disabled={test?.status === "testing"}
                            onClick={() => runProxyTest(proxy.id)}
                          >
                            {test?.status === "testing"
                              ? <Spinner size={13} />
                              : <Icon name={test?.status === "ok" ? "hand.thumbsup.fill" : test?.status === "fail" ? "hand.thumbsdown.fill" : "bolt.fill"} size={13} />}
                          </button></Tooltip>
                          <Tooltip content={`Delete ${proxy.name}`}><button
                            type="button"
                            className="plain-icon-btn plain-icon-btn-compact"
                            aria-label={`Delete ${proxy.name}`}
                            onClick={() => setManualProxyDeleting(proxy.id)}
                          >
                            <Icon name="trash" size={13} />
                          </button></Tooltip>
                        </div>
                        <PersonalProxyTestStatus test={test} />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="personal-proxy-empty">
                    <Icon name="network" size={20} />
                    <strong>{query.trim() ? "No matching proxies" : "No personal proxies yet"}</strong>
                    <span>{query.trim() ? "Try a different name or host." : "Create one and reuse it across browser profiles."}</span>
                  </div>
                )}
                {manualProxyDeleting && (() => {
                  const proxy = s.personalProxies.find((item) => item.id === manualProxyDeleting);
                  if (!proxy) return null;
                  const proxyUsers = personalProxyUsers(s.workspaces, proxy.id);
                  return (
                    <div className="personal-proxy-delete-confirm" role="alert">
                      <span>{proxyUsers.length
                        ? `“${proxy.name}” is used by ${proxyUsers.join(", ")}. Change their connection before deleting it.`
                        : `Delete “${proxy.name}” from this device?`}</span>
                      <div className="row">
                        <button type="button" className="secondary" disabled={manualProxyDeletePending} onClick={() => setManualProxyDeleting(null)}>Cancel</button>
                        <button
                          type="button"
                          className="primary danger"
                          disabled={manualProxyDeletePending || proxyUsers.length > 0}
                          onClick={() => {
                            setManualProxyDeletePending(true);
                            void s.deletePersonalProxy(proxy.id)
                              .then(() => {
                                if (profilePersonalProxyId === proxy.id) setProfilePersonalProxyId("");
                                setManualProxyDeleting(null);
                              })
                              .catch((error: unknown) => {
                                console.error("[PERSONAL_PROXY_DELETE_FAILED]", error);
                                setManualError(internalError("We couldn't delete the proxy.", "PERSONAL_PROXY_DELETE_FAILED"));
                                void s.loadPersonalProxies().catch(() => undefined);
                              })
                              .finally(() => setManualProxyDeletePending(false));
                          }}
                        >
                          {manualProxyDeletePending ? <Spinner size={13} /> : "Delete"}
                        </button>
                      </div>
                    </div>
                  );
                })()}
                {manualError && (
                  <div className="error manual-proxy-error">
                    <UserFacingError message={manualError} surface="manual_proxy" />
                  </div>
                )}
    </>;
  };

  return <>
    <div className="sidebar-mini">
      <Tooltip content="My account" side="right">
        <button className={"sidebar-settings-button is-compact" + (s.tab === "account" ? " active" : "")}
          aria-label="Open Profile" aria-current={s.tab === "account" ? "page" : undefined} onClick={() => s.setTab("account")}>
          {s.authed ? <AccountAvatar ownerId={s.accountOwnerId} name={s.accountName} email={s.accountEmail} /> : <AccountAvatar />}
        </button>
      </Tooltip>
      <div className="sidebar-destinations is-compact"><RecentProjects dock={projectsDock} open={projectsMenuOpen} onOpenChange={setProjectsMenuOpen} /></div>
      <div className="sidebar-destinations is-compact"><PersonalProxyNavigation count={s.personalProxies.length}
        onLoad={() => { if (s.authed) void s.loadPersonalProxies().catch(() => setManualError("Could not load proxies. Try opening the list again.")); }}
        onCreate={bulk => {
          if (!s.authed) { s.setDashboardKeyPromptOpen(true); return; }
          resetManualProxyForm(); setManualProxyMode(bulk ? "bulk" : "url");
          setManualProxyEditing(true); setManualProxyOpen(true);
        }} renderList={query => personalProxyList(query)} /></div>
      <SidebarNavigation collapsed tab={s.tab} modal={s.utilityDialog} badgeFor={badgeFor} onSelect={s.setTab} liveDestination={liveDestination} pinnedApps={<PinnedMiniApps />} />
      {activeRecording && <Tooltip content={recordingMiniLabel} side="right"><button className="mini-nav-btn mini-recording-control recording" aria-label="Open active recording" onClick={() => setAutomationStatusOpen(true)}><Icon name="circle.fill" size={18} /></button></Tooltip>}
      {automationExecution && !activeRecording && <Tooltip content="Automation status" side="right"><button className="mini-nav-btn" aria-label="Automation status" onClick={() => setAutomationStatusOpen(true)}><Icon name="play.fill" size={18} /></button></Tooltip>}
      <span className="spacer" />
      <SidebarSettingsButton collapsed attention={settingsAttention} onClick={onOpenSettings} />
    </div>
    {profileActionError && <Dialog title="Browser action failed" onClose={() => setProfileActionError(null)}><UserFacingError message={profileActionError} surface="profile_action" /></Dialog>}
    {automationStatusOpen && <Dialog title="Automation status" className="workspace-tools utility-dialog" onClose={() => setAutomationStatusOpen(false)}>
    <div className="sidebar-shell">
      {activeRecording && <section className="sidebar-recording-control recording" aria-label={activeRecording.destination === "workflow" ? "Workflow recording in progress" : "Recording in progress"}>
        <div className="sidebar-recording-status"><span className="sidebar-recording-dot" /><div><strong>{activeRecording.destination === "workflow" ? "Recording a workflow" : "Recording in progress"}</strong><small>{recordingWorkspace?.name || "Current workspace"} · {recordingDestinationLabel}</small><small>{recordingDuration(activeRecording.startedAt, recordingClock)} elapsed</small></div></div>
        <div className="sidebar-recording-actions"><button onClick={openRecorder}>{activeRecording.destination === "workflow" ? "Open Workflow Builder" : "Open recorder"}</button><button className="stop" disabled={recordingStopping} onClick={() => void stopRecording()}>{recordingStopping ? <Spinner size={11} /> : <Icon name="stop.fill" size={11} />} {activeRecording.destination === "workflow" ? "Stop & open" : "Stop recording"}</button></div>
        {recordingError && <small className="sidebar-recording-error" role="alert">{recordingError}</small>}
      </section>}

      {s.authed && s.workspaces.some((workspace) => workspace.id === automationExecution?.workspaceId) && automationExecution && automationExecutionState && <section className={`sidebar-execution-control ${automationExecutionState.phase}`} aria-label="Automation execution status">
        <div className="sidebar-execution-status"><span className="sidebar-execution-icon"><Icon name={automationExecutionState.phase === "completed" ? "checkmark.circle.fill" : ["failed", "cancelled"].includes(automationExecutionState.phase) ? "xmark.circle.fill" : automationExecutionState.phase === "stopping" ? "stop.fill" : "play.fill"} size={12} /></span><div><strong>{automationExecutionState.phase === "completed" ? `${automationExecutionLabel} completed` : automationExecutionState.phase === "cancelled" ? `${automationExecutionLabel} stopped` : automationExecutionState.phase === "failed" ? `${automationExecutionLabel} failed` : automationExecutionState.phase === "stopping" ? `Stopping ${automationExecutionLabel.toLowerCase()}` : automationExecutionState.phase === "preparing" ? `Preparing ${automationExecutionLabel.toLowerCase()}` : `${automationExecutionLabel} running`}</strong><Tooltip content={automationExecution.workflowTitle}><small>{automationExecution.workflowTitle} · {automationExecutionWorkspace?.name || "Current workspace"}</small></Tooltip></div><b>{automationExecutionState.progress}%</b></div>
        <div className="sidebar-execution-track"><i style={{ width: `${automationExecutionState.progress}%` }} /></div>
        <small className="sidebar-execution-detail">{automationExecutionState.detail}</small>
        <div className="sidebar-recording-actions"><button onClick={openAutomationExecution}>Open</button>{["completed", "failed", "cancelled"].includes(automationExecutionState.phase) ? <button onClick={clearActiveAutomationExecution}>Dismiss</button> : <button className="stop" disabled={automationExecution.phase === "stopping"} onClick={() => void stopAutomationExecution()}>{automationExecution.phase === "stopping" ? <Spinner size={11} /> : <Icon name="stop.fill" size={11} />} {automationExecution.phase === "stopping" ? "Stopping" : "Stop"}</button>}</div>
        {automationExecutionError && <small className="sidebar-recording-error" role="alert">{automationExecutionError}</small>}
      </section>}

    </div></Dialog>}

      {createProfileOpen && createPortal((
        <div
          className="modal-overlay"
          onMouseDown={closeProfileCreator}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            closeProfileCreator();
          }}
        >
          <form
            className="modal-card create-profile-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-profile-title"
            onSubmit={submitManagedProfile}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="profile-menu-head">
              <span id="create-profile-title" className="profile-menu-name">Create profile</span>
              <span className="spacer" />
              <Tooltip content={profileSaving ? "Cancel profile creation" : "Close"}><button
                type="button"
                className="plain-icon-btn"
                aria-label={profileSaving ? "Cancel profile creation" : "Close profile creation"}
                onClick={closeProfileCreator}
              >
                <Icon name="xmark.circle.fill" size={18} />
              </button></Tooltip>
            </div>
            <div className="profile-workspace-context">
              <Icon name="square.grid.2x2.fill" size={13} />
              <span>Workspace</span>
              <strong>{activeWorkspace?.name ?? "Current workspace"}</strong>
            </div>
            {!multiloginExisting && <label className="modal-field profile-name-primary">
              <span className="modal-field-heading"><span>Profile name</span><small>Max {entityNameLimits.profile}</small></span>
              <input
                value={profileName}
                maxLength={entityNameLimits.profile}
                disabled={profileSaving}
                onChange={(event) => {
                  setProfileName(event.target.value);
                  setProfileError(null);
                }}
                placeholder="My profile"
                autoFocus
              />
            </label>}
            {profileToolset !== "multilogin" && <fieldset className="project-mode-field profile-connection-field">
              <legend>Connection</legend>
              <label className={"project-mode-option" + (profileConnection === "direct" ? " is-selected" : "")}>
                <input type="radio" name="profile-connection" checked={profileConnection === "direct"} onChange={() => setProfileConnection("direct")} />
                <Icon name="network" size={16} />
                <span><strong>No proxy</strong><small>Use your direct internet connection</small></span>
              </label>
              <label className={"project-mode-option" + (profileConnection === "managed" ? " is-selected" : "")}>
                <input type="radio" name="profile-connection" checked={profileConnection === "managed"} onChange={() => setProfileConnection("managed")} />
                <Icon name="globe" size={16} />
                <span>
                  <strong>Managed proxy</strong>
                  <small>Choose the proxy country</small>
                </span>
              </label>
              <label className={"project-mode-option" + (profileConnection === "personal" ? " is-selected" : "")}>
                <input
                  type="radio"
                  name="profile-connection"
                  checked={profileConnection === "personal"}
                  onChange={() => {
                    setProfileConnection("personal");
                    setProfilePersonalProxyId((current) => current || s.personalProxies[0]?.id || "");
                    void s.loadPersonalProxies().catch(() => undefined);
                  }}
                />
                <Icon name="network" size={16} />
                <span><strong>Personal proxy</strong><small>Use one of your saved proxies</small></span>
              </label>
            </fieldset>}
            {profileConnection === "managed" && profileToolset !== "multilogin" && <div className="modal-field profile-proxy-country-field">
              <span>Proxy country</span>
              <CountrySelect
                countries={proxyCountries}
                value={profileCountry}
                disabled={profileSaving}
                ariaLabel="Proxy country"
                onChange={setProfileCountry}
              />
            </div>}
            {profileConnection === "personal" && profileToolset !== "multilogin" && (
              <div className="modal-field profile-personal-proxy-field">
                <span className="profile-field-heading">
                  <span>Personal proxy</span>
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      resetManualProxyForm();
                      setManualProxyEditing(s.personalProxies.length === 0);
                      setManualProxyDeleting(null);
                      setManualProxyOpen(true);
                    }}
                  >
                    {s.personalProxies.length ? "Manage" : "Create proxy"}
                  </button>
                </span>
                {s.personalProxies.length ? (
                  <PersonalProxySelect
                    value={profilePersonalProxyId}
                    proxies={s.personalProxies}
                    disabled={profileSaving}
                    ariaLabel="Personal proxy"
                    onChange={setProfilePersonalProxyId}
                    onAdd={() => { resetManualProxyForm(); setManualProxyDeleting(null); setManualProxyEditing(true); setManualProxyOpen(true); }}
                  />
                ) : (
                  <button
                    type="button"
                    className="personal-proxy-empty-action"
                    onClick={() => {
                      resetManualProxyForm();
                      setManualProxyDeleting(null);
                      setManualProxyEditing(true);
                      setManualProxyOpen(true);
                    }}
                  >
                    <Icon name="plus" size={13} /> Create your first proxy
                  </button>
                )}
              </div>
            )}
            <fieldset className="project-mode-field profile-toolset-field">
              <legend>Browser toolset</legend>
              <label className={"project-mode-option" + (profileToolset === "clawbrowser" ? " is-selected" : "")}>
                <input type="radio" name="profile-toolset" checked={profileToolset === "clawbrowser"} onChange={() => setProfileToolset("clawbrowser")} />
                <Icon name="globe" size={16} />
                <span><strong>Clawbrowser</strong><small>Managed identity and proxy</small></span>
              </label>
              <label className={"project-mode-option" + (profileToolset === "dasbrowser" ? " is-selected" : "")}>
                <input type="radio" name="profile-toolset" checked={profileToolset === "dasbrowser"} onChange={() => setProfileToolset("dasbrowser")} />
                <Icon name="safari" size={16} />
                <span><strong>DasBrowser</strong><small>Private multi-account browser</small></span>
              </label>
              <label className={"project-mode-option" + (profileToolset === "camoufox" ? " is-selected" : "")}>
                <input type="radio" name="profile-toolset" checked={profileToolset === "camoufox"} onChange={() => setProfileToolset("camoufox")} />
                <Icon name="shield" size={16} />
                <span><strong>Camoufox</strong><small>Firefox anti-detect browser</small></span>
              </label>
              <label className={"project-mode-option profile-toolset-multilogin" + (profileToolset === "multilogin" ? " is-selected" : "")}>
                <input
                  type="radio"
                  name="profile-toolset"
                  checked={profileToolset === "multilogin"}
                  onChange={() => {
                    setProfileToolset("multilogin");
                    setProfileError(null);
                    // Multilogin attaches its own proxy, so the connection choice never applies.
                    setProfileConnection("managed");
                    if (!multiloginStatus && !multiloginChecking) void refreshMultiloginStatus();
                  }}
                />
                <span className="profile-toolset-mark"><img src="./multilogin-icon.svg" alt="" /></span>
                <span><strong>Multilogin</strong><small>Mimic profiles from your Multilogin account</small></span>
              </label>
            </fieldset>
            {profileToolset === "multilogin" && (
              <section className="profile-multilogin-panel" aria-label="Multilogin profile">
                {!multiloginReady ? (
                  <div className="profile-multilogin-pending">
                    {multiloginChecking
                      ? <><Spinner size={13} /><span>Checking Multilogin…</span></>
                      : (
                        <>
                          <span>{multiloginError ?? "Multilogin is not connected yet."}</span>
                          <button type="button" className="secondary" onClick={routeToMultiloginConnector}>
                            Connect Multilogin
                          </button>
                        </>
                      )}
                  </div>
                ) : (
                  <>
                    {/* Profiles come from the workspace the saved token opens, which is often someone else's. */}
                    <div className="profile-multilogin-account">
                      <Icon name="person.crop.circle" size={12} />
                      <span>{multiloginAccountLabel(multiloginStatus?.account) || "Multilogin workspace"}</span>
                      <button type="button" className="link" onClick={routeToMultiloginConnector}>Change</button>
                    </div>
                    <div className="profile-multilogin-proxy-note">
                      <Icon name="network" size={13} />
                      <span><strong>Proxy for new profiles</strong><small>Use Multilogin's built-in proxy in a country, or one of your personal proxies. Existing profiles keep the proxy set in Multilogin.</small></span>
                      <button type="button" className="link" onClick={() => void invoke("open_external", { url: "https://app.multilogin.com" })}>Open Multilogin</button>
                    </div>
                    <div className="connector-profile-tabs profile-multilogin-modes" role="tablist" aria-label="Multilogin profile source">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={multiloginMode === "new"}
                        className={multiloginMode === "new" ? "active" : ""}
                        onClick={() => { setMultiloginMode("new"); setProfileError(null); }}
                      >
                        <span>New profile</span>
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={multiloginMode === "existing"}
                        className={multiloginMode === "existing" ? "active" : ""}
                        onClick={() => { setMultiloginMode("existing"); setProfileError(null); }}
                      >
                        <span>Existing profile</span>
                      </button>
                    </div>
                    {multiloginMode === "new" ? (
                      <>
                        <div className="connector-profile-tabs profile-multilogin-kind-tabs" role="tablist" aria-label="Multilogin profile type to create">
                          <button type="button" role="tab" aria-selected={multiloginKind === "browser"} className={multiloginKind === "browser" ? "active" : ""} onClick={() => { setMultiloginKind("browser"); setProfileError(null); }}>
                            <span>Browser</span>
                          </button>
                          <button type="button" role="tab" aria-selected={multiloginKind === "mobile"} className={multiloginKind === "mobile" ? "active" : ""} onClick={() => { setMultiloginKind("mobile"); setProfileError(null); }}>
                            <span>Cloud phone</span>
                          </button>
                        </div>
                        {multiloginKind === "browser" && (
                          <div className="connector-profile-tabs profile-multilogin-proxy-tabs" role="tablist" aria-label="Multilogin profile proxy">
                            <button type="button" role="tab" aria-selected={profileConnection !== "personal"} className={profileConnection !== "personal" ? "active" : ""} onClick={() => { setProfileConnection("managed"); setProfileError(null); }}>
                              <span>Multilogin proxy</span>
                            </button>
                            <button type="button" role="tab" aria-selected={profileConnection === "personal"} className={profileConnection === "personal" ? "active" : ""} onClick={() => {
                              setProfileConnection("personal");
                              setProfilePersonalProxyId((current) => current || s.personalProxies[0]?.id || "");
                              setProfileError(null);
                              void s.loadPersonalProxies().catch(() => undefined);
                            }}>
                              <span>Personal proxy</span>
                            </button>
                          </div>
                        )}
                        {multiloginKind === "browser" && profileConnection === "personal" ? (
                          <div className="modal-field profile-personal-proxy-field">
                            <span className="profile-field-heading">
                              <span>Personal proxy</span>
                              <button type="button" className="link" onClick={() => { resetManualProxyForm(); setManualProxyEditing(s.personalProxies.length === 0); setManualProxyDeleting(null); setManualProxyOpen(true); }}>
                                {s.personalProxies.length ? "Manage" : "Create proxy"}
                              </button>
                            </span>
                            {s.personalProxies.length ? (
                              <PersonalProxySelect
                                value={profilePersonalProxyId}
                                proxies={s.personalProxies}
                                disabled={profileSaving}
                                ariaLabel="Personal proxy for the Multilogin profile"
                                onChange={setProfilePersonalProxyId}
                                onAdd={() => { resetManualProxyForm(); setManualProxyDeleting(null); setManualProxyEditing(true); setManualProxyOpen(true); }}
                              />
                            ) : <small className="muted">No personal proxies yet. Create one to use it here.</small>}
                          </div>
                        ) : (
                          <div className="modal-field profile-multilogin-country">
                            <span>Proxy country</span>
                            <CountrySelect
                              countries={proxyCountries}
                              value={profileCountry}
                              disabled={profileSaving}
                              ariaLabel="Proxy country"
                              onChange={setProfileCountry}
                            />
                          </div>
                        )}
                        {multiloginKind === "browser" ? (
                          <label className="modal-field profile-multilogin-os">
                            <span>Fingerprint OS</span>
                            <select
                              value={multiloginOS}
                              disabled={profileSaving}
                              aria-label="Multilogin fingerprint OS"
                              onChange={(event) => setMultiloginOS(event.target.value as MultiloginOSType)}
                            >
                              {MULTILOGIN_OS_TYPES.map((osType) => (
                                <option key={osType} value={osType}>
                                  {osType === "macos" ? "macOS" : osType === "windows" ? "Windows" : "Linux"}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : <p className="profile-multilogin-phone-note">Creates one Android 14 cloud phone with a Multilogin-managed proxy in the selected country.</p>}
                      </>
                    ) : (
                      <div className="profile-multilogin-picker" role="tabpanel">
                        <div className="profile-multilogin-picker-head">
                        <div className="connector-profile-tabs" role="tablist" aria-label="Multilogin profile type">
                          <button
                            type="button"
                            role="tab"
                            aria-selected={multiloginKind === "browser"}
                            className={multiloginKind === "browser" ? "active" : ""}
                            onClick={() => { setMultiloginKind("browser"); setMultiloginQuery(""); }}
                          >
                            <span>Browsers</span>
                            <strong>{multiloginBrowserProfiles.length}</strong>
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={multiloginKind === "mobile"}
                            className={multiloginKind === "mobile" ? "active" : ""}
                            onClick={() => { setMultiloginKind("mobile"); setMultiloginQuery(""); }}
                          >
                            <span>Phones</span>
                            <strong>{multiloginCloudPhones.length}</strong>
                          </button>
                        </div>
                        <Tooltip content="Refresh Multilogin profiles"><button
                          type="button"
                          className="plain-icon-btn plain-icon-btn-compact"
                          aria-label="Refresh Multilogin profiles"
                          disabled={multiloginChecking}
                          onClick={() => void refreshMultiloginStatus()}
                        >
                          {multiloginChecking ? <Spinner size={12} /> : <Icon name="arrow.clockwise" size={12} />}
                        </button></Tooltip>
                        </div>
                        <label className="profile-multilogin-search">
                          <Icon name="magnifyingglass" size={13} />
                          <input
                            type="search"
                            value={multiloginQuery}
                            placeholder={multiloginKind === "browser" ? "Search browser profiles" : "Search cloud phones"}
                            aria-label={multiloginKind === "browser" ? "Search browser profiles" : "Search cloud phones"}
                            onChange={(event) => setMultiloginQuery(event.target.value)}
                          />
                        </label>
                        <div className="connector-profile-list profile-multilogin-list" role="listbox" aria-label={multiloginKind === "browser" ? "Multilogin browser profiles" : "Multilogin cloud phones"}>
                          {multiloginVisibleProfiles.map((profile: MultiloginProfileSummary) => {
                            const selected = multiloginProfileSelected(multiloginDraft, multiloginKind, profile);
                            return (
                              <button
                                type="button"
                                role="option"
                                aria-selected={selected}
                                key={`${profile.folderId || ""}:${profile.id}`}
                                className={`connector-profile-row${selected ? " selected" : ""}`}
                                onClick={() => {
                                  setMultiloginDraft(multiloginProfileSelection(multiloginKind, profile));
                                  setProfileError(null);
                                }}
                              >
                                <span className="connector-profile-radio">{selected && <Icon name="checkmark" size={11} />}</span>
                                <span>
                                  <strong>{profile.name}</strong>
                                  <small>{profile.status || (multiloginKind === "browser" ? "Mimic browser" : "Cloud phone")}</small>
                                </span>
                              </button>
                            );
                          })}
                          {!multiloginVisibleProfiles.length && !multiloginKindError && (
                            <div className="connector-profile-empty">
                              {multiloginQuery.trim() ? "No matching profiles" : (
                                <>
                                  <span>No {multiloginKind === "browser" ? "browser profiles" : "cloud phones"} in this Multilogin workspace yet.</span>
                                  <button type="button" className="connector-empty-create" onClick={() => { setMultiloginMode("new"); setProfileConnection("managed"); setProfileError(null); }}>
                                    Create {multiloginKind === "browser" ? "a browser profile" : "a cloud phone"}
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                          {multiloginKindError && (
                            <div className="error small connector-profile-error">
                              <span>{multiloginKindError}</span>
                              {multiloginKindError === MULTILOGIN_TOKEN_EXPIRED && (
                                <button type="button" className="connector-empty-create" onClick={routeToMultiloginConnector}>Reconnect Multilogin</button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>
            )}
            {profileToolset !== "multilogin" && <section className="profile-remote-section" aria-label="Remote execution">
              <div className="profile-remote-heading">
                <span>Remote execution</span>
                <small>Optional</small>
              </div>
              <button
                type="button"
                className="profile-vps-option"
                onClick={() => {
                  setCreateProfileOpen(false);
                  setVPSSetupOpen(true);
                }}
              >
                <span className="profile-vps-icon"><Icon name="terminal" size={15} /></span>
                <span>
                  <strong>Use VPS</strong>
                  <small>Set up this project on a remote server</small>
                </span>
                <Icon name="chevron.right" size={12} className="muted" />
              </button>
            </section>}
            {profileError && (
              <div className="error small profile-create-error">
                <span>{profileError}</span>
                {profileError === MULTILOGIN_APP_NOT_RUNNING && (
                  <button type="button" className="secondary small" onClick={() => void openMultiloginApp()}>
                    Open Multilogin <Icon name="arrow.up.forward.app" size={12} />
                  </button>
                )}
                {profileError === MULTILOGIN_TOKEN_EXPIRED && (
                  <button type="button" className="secondary small" onClick={routeToMultiloginConnector}>Reconnect Multilogin</button>
                )}
              </div>
            )}
            {profileSaving && profileCreationStage && (
              <div className="profile-create-progress" role="status" aria-live="polite">
                {profileCreationStage === "Ready" ? <Icon name="checkmark" size={13} /> : <Spinner size={13} />}
                <span>{profileCreationStage}</span>
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={closeProfileCreator}>
                {profileSaving ? "Cancel creation" : "Cancel"}
              </button>
              <button
                type="submit"
                className="primary"
                disabled={profileSaving || (profileToolset === "multilogin"
                  ? (multiloginExisting ? !multiloginDraft : !multiloginReady || !profileName.trim())
                  : !profileName.trim() || (profileConnection === "personal" && !profilePersonalProxyId))}
              >
                {profileSaving ? <Spinner size={13} /> : <Icon name="plus" size={13} />}
                {profileSaving
                  ? profileCreationStage ?? "Creating…"
                  : profileToolset === "multilogin" ? multiloginSubmitLabel(multiloginMode) : "Create profile"}
              </button>
            </div>
          </form>
        </div>
      ), document.body)}

      {workspaceCreatorOpen && createPortal((
        <div className="modal-overlay" onMouseDown={() => { if (!workspaceSaving) { setWorkspaceCreatorOpen(false); setWorkspaceError(null); } }}>
          <form
            className="modal-card workspace-create-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-create-title"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              if (workspaceSaving) return;
              let nextName: string;
              try {
                nextName = validateEntityName("workspace", workspaceName);
              } catch (error) {
                setWorkspaceError(error instanceof Error ? error.message : String(error));
                return;
              }
              setWorkspaceSaving(true);
              setWorkspaceError(null);
              void s.createWorkspace(nextName)
                .then(() => setWorkspaceCreatorOpen(false))
                .catch((error: unknown) => {
                  console.error("[WORKSPACE_CREATE_FAILED]", error);
                  const detail = error instanceof Error ? error.message.trim() : String(error ?? "").trim();
                  setWorkspaceError(detail || internalError("We couldn't create the workspace.", "WORKSPACE_CREATE_FAILED"));
                })
                .finally(() => setWorkspaceSaving(false));
            }}
          >
            <div className="profile-menu-head">
              <Icon name="square.grid.2x2.fill" size={15} />
              <span id="workspace-create-title" className="profile-menu-name">Create workspace</span>
              <span className="spacer" />
              <Tooltip content="Close"><button type="button" className="plain-icon-btn" disabled={workspaceSaving} onClick={() => { setWorkspaceCreatorOpen(false); setWorkspaceError(null); }}>
                <Icon name="xmark.circle.fill" size={18} />
              </button></Tooltip>
            </div>
            <label className="modal-field">
              <span className="modal-field-heading"><span>Workspace name</span><small>Max {entityNameLimits.workspace}</small></span>
              <input value={workspaceName} maxLength={entityNameLimits.workspace} onChange={(event) => { setWorkspaceName(event.target.value); setWorkspaceError(null); }} placeholder="New workspace" autoFocus />
            </label>
            <p className="muted small workspace-create-note">Chats and profiles created here stay inside this workspace.</p>
            {workspaceError && <div className="error small"><UserFacingError message={workspaceError} surface="workspace_create" /></div>}
            <div className="modal-actions">
              <button type="button" className="secondary" disabled={workspaceSaving} onClick={() => { setWorkspaceCreatorOpen(false); setWorkspaceError(null); }}>Cancel</button>
              <button type="submit" className="primary" disabled={workspaceSaving || !workspaceName.trim()}>
                {workspaceSaving ? <Spinner size={13} /> : <Icon name="plus" size={13} />} Create workspace
              </button>
            </div>
          </form>
        </div>
      ), document.body)}

      {workspaceToDelete && createPortal((
        <div className="modal-overlay" onMouseDown={() => { if (!workspaceDeletePending) setWorkspaceDeleteId(undefined); }}>
          <section className="modal-card workspace-create-modal" role="alertdialog" aria-modal="true" aria-labelledby="workspace-delete-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="profile-menu-head"><Icon name="trash" size={15} /><strong id="workspace-delete-title">Delete “{workspaceToDelete.name}”?</strong></div>
            <p className="muted small">This permanently deletes the workspace, its {projectsToDelete} project{projectsToDelete === 1 ? "" : "s"} and chats, scheduled runs, local artifacts, and profiles used only here. Profiles also used by another workspace stay there. This cannot be undone.</p>
            {workspaceDeletePending && workspaceDeleteProgress && <p className="muted small" role="status" aria-live="polite">{workspaceDeleteProgress}</p>}
            {workspaceDeleteError && <p className="error small" role="alert">{workspaceDeleteError}</p>}
            <div className="modal-actions">
              <button type="button" className="secondary" disabled={workspaceDeletePending} onClick={() => setWorkspaceDeleteId(undefined)}>Cancel</button>
              <button type="button" className="primary" disabled={workspaceDeletePending} onClick={() => {
                setWorkspaceDeletePending(true);
                setWorkspaceDeleteProgress(null);
                void s.deleteWorkspace(workspaceToDelete.id, setWorkspaceDeleteProgress).then(() => setWorkspaceDeleteId(undefined)).catch((error: unknown) => {
                  setWorkspaceDeleteError(error instanceof Error ? error.message : String(error));
                }).finally(() => setWorkspaceDeletePending(false));
              }}>{workspaceDeletePending ? <Spinner size={13} /> : <Icon name="trash" size={13} />} Delete workspace and contents</button>
            </div>
          </section>
        </div>
      ), document.body)}

      {pendingRuntimeInstall && createPortal((
        <div className="modal-overlay" role="presentation" onMouseDown={cancelRuntimeInstall}>
          <section className="modal-card runtime-install-confirm" role="dialog" aria-modal="true" aria-labelledby="runtime-install-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="profile-menu-head"><Icon name="arrow.down.circle.fill" size={17} /><strong id="runtime-install-confirm-title">Download {pendingRuntimeInstall.runtime === "camoufox" ? "Camoufox" : pendingRuntimeInstall.runtime === "dasbrowser" ? "DasBrowser" : "Clawbrowser"}?</strong></div>
            <p className="muted small">This browser toolset is required to start “{pendingRuntimeInstall.profile}”. Nextbrowser will download it in the background and show progress. You can stop the download at any time.</p>
            <div className="modal-actions"><button className="secondary" type="button" autoFocus onClick={cancelRuntimeInstall}>Cancel</button><button className="primary" type="button" onClick={confirmRuntimeInstall}><Icon name="arrow.down.circle.fill" size={13} /> Download &amp; start</button></div>
          </section>
        </div>
      ), document.body)}

      {menuProfile && (() => {
        const isDefaultProfile = menuProfile === "__default";
        const prof = s.profiles.find((p) => p.name === menuProfile);
        const identity = isDefaultProfile ? s.profileIdentities.__default : s.profileIdentities[menuProfile];
        const activeCountry = (isDefaultProfile ? identity?.country : prof?.country ?? identity?.country)?.toLowerCase();
        const status = isDefaultProfile ? defaultStatus : s.statuses[menuProfile] ?? s.profileSessions[menuProfile]?.status ?? "unknown";
        const manual = prof?.proxy_mode === "manual" && prof.manual_proxy;
        const direct = prof?.proxy_mode === "direct";
        const profileWorkspace = activeWorkspace?.profileNames.includes(menuProfile) ? activeWorkspace : s.workspaces.find((workspace) => workspace.profileNames.includes(menuProfile));
        const profileBusy = ["running", "starting", "stopping", "rotating"].includes(status);
        return (
          <Popover label={`Profile actions for ${isDefaultProfile ? "default" : menuProfile}`} open onOpenChange={open => { if (!open) setMenuProfile(null); }}
            anchorElement={menuAnchor ?? document.querySelector<HTMLElement>(`[data-profile-key="${CSS.escape(clawbrowserTargetKey(menuProfile))}"]`)}
            trigger={() => null} side="bottom" align="end" className="profile-actions-popover shared-scrollbarless">
            <div className="profile-menu">
              <div className="profile-menu-head">
                <Tooltip content={status}><span
                  className={"dot " + (status === "running" ? "green" : status === "unknown" ? "gray" : "orange")}
                /></Tooltip>
                <span className="profile-menu-name">{isDefaultProfile ? "default" : menuProfile}</span>
                {activeCountry && (
                  <Tooltip content={countryLabel(activeCountry, identity?.city ?? prof?.city)}><span className="badge profile-country-badge">
                    {countryFlag(activeCountry)} {activeCountry.toUpperCase()}
                  </span></Tooltip>
                )}
                {identity?.ip && <Tooltip content="Current proxy IP"><span className="badge profile-ip-badge">{identity.ip}</span></Tooltip>}
                {manual && (
                  <Tooltip content={`${prof.manual_proxy?.host ?? ""}:${prof.manual_proxy?.port ?? ""}`}><span
                    className="badge manual-proxy-badge"
                  >
                    {(prof.manual_proxy?.scheme ?? "http").toUpperCase()}
                  </span></Tooltip>
                )}
                <span className="spacer" />
                <Tooltip content="Close"><button className="plain-icon-btn" onClick={() => setMenuProfile(null)}>
                  <Icon name="xmark.circle.fill" size={18} />
                </button></Tooltip>
              </div>

              <button className="live-session-row" type="button" onClick={() => { s.selectProfile(isDefaultProfile ? undefined : menuProfile); setMenuProfile(null); }}>Use in chat{s.selectedProfile === menuProfile ? " · Selected" : ""}</button>
              <button
                className="full rotate-btn"
                onClick={() => {
                  const label = manual || direct ? "We couldn't restart the profile." : "We couldn't rotate the profile's IP.";
                  runProfileAction(label, "PROFILE_ROTATE_FAILED", () => isDefaultProfile ? s.rotateDefaultSession() : s.rotateProfile(menuProfile));
                  setMenuProfile(null);
                }}
              >
                <Icon name="arrow.triangle.2.circlepath" size={14} strokeWidth={2.25} />
                {manual || direct ? "Restart profile" : "Rotate IP"}
              </button>

              {!manual && !direct && (
                <>
                  <div className="section profile-menu-label">Rotate country</div>
                  <Select
                    options={proxyCountries.map(country => ({ value: country.code, label: `${countryFlag(country.code)} ${country.name}`.trim() }))}
                    value={activeCountry?.toUpperCase() ?? ""}
                    label="Rotate country"
                    searchPlaceholder="Search countries"
                    onChange={(country) => {
                      runProfileAction("We couldn't rotate the profile's country.", "PROFILE_ROTATE_COUNTRY_FAILED", () =>
                        isDefaultProfile ? s.rotateDefaultSessionCountry(country) : s.rotateProfileCountry(menuProfile, country));
                      setMenuProfile(null);
                    }}
                  />
                </>
              )}

              {!isDefaultProfile && profileWorkspace && (
                <>
                  <div className="section profile-menu-label">Connection</div>
                  <Tooltip content={profileBusy ? "Stop the profile before changing its connection" : "Change profile connection"}><button
                    type="button"
                    className="profile-connection-edit-button"
                    disabled={profileBusy}
                    onClick={() => {
                      setProfileConnectionError(null);
                      setProfileConnectionEditor({
                        name: menuProfile,
                        connection: manual ? "personal" : direct ? "direct" : "managed",
                        country: (activeCountry || "US").toUpperCase(),
                        proxyId: profileWorkspace.profileProxyIds?.[menuProfile] || "",
                      });
                      void s.loadPersonalProxies().catch(() => undefined);
                      setMenuProfile(null);
                    }}
                  >
                    <span className="profile-connection-edit-icon"><Icon name={manual ? "network" : direct ? "lock.open" : "globe"} size={14} /></span>
                    <span><strong>{manual ? "Personal proxy" : direct ? "No proxy" : "Managed proxy"}</strong><small>{profileBusy ? "Stop profile to change" : "Change connection"}</small></span>
                    <Icon name="chevron.right" size={12} className="muted" />
                  </button></Tooltip>
                  <div className="section profile-menu-label">Workspace</div>
                  <Select
                    label="Workspace"
                    value={profileWorkspace.id}
                    options={s.workspaces.map(workspace => ({ value: workspace.id, label: workspace.name }))}
                    disabled={profileBusy || s.projectsSyncing || s.workspaces.length < 2}
                    onChange={(targetId) => {
                      setProfileMoveError(null);
                      void s.moveProfileToWorkspace(menuProfile, targetId)
                        .then(() => setMenuProfile(null))
                        .catch((error: unknown) => {
                          const message = error instanceof Error && error.message.startsWith("Stop the profile")
                            ? error.message
                            : internalError("We couldn't move the profile.", "PROFILE_WORKSPACE_MOVE_FAILED");
                          console.error("[PROFILE_WORKSPACE_MOVE_FAILED]", error);
                          setProfileMoveError(message);
                        });
                    }}
                  />
                  {profileBusy && <div className="muted small profile-workspace-note">Stop the profile to move it.</div>}
                  {!profileBusy && s.projectsSyncing && <div className="muted small profile-workspace-note">Syncing workspaces…</div>}
                  {profileMoveError && <div className="error small profile-workspace-note"><UserFacingError message={profileMoveError} surface="profile_workspace_move" /></div>}
                </>
              )}

              {!isDefaultProfile && (
                <>
                  <div className="profile-menu-divider" />
                  <div className="profile-menu-danger-actions">
                    {profileBusy && (
                      <button
                        type="button"
                        className="profile-stop-btn"
                        disabled={status === "stopping"}
                        onClick={() => {
                          void runProfileAction(`We couldn't stop “${menuProfile}”.`, "PROFILE_STOP_FAILED", () => s.stopProfile(menuProfile));
                          setMenuProfile(null);
                        }}
                      >
                        <Icon name="stop.fill" size={13} />
                        {status === "stopping" ? "Stopping profile…" : "Stop profile"}
                      </button>
                    )}
                    <button
                      className="profile-delete-btn"
                      onClick={() => {
                        setProfileDeleteError(null);
                        setConfirmDelete(menuProfile);
                        setMenuProfile(null);
                      }}
                    >
                      <Icon name="trash" size={14} />
                      Delete profile
                    </button>
                  </div>
                </>
              )}
            </div>
          </Popover>
        );
      })()}

      {profileConnectionEditor && createPortal((
        <div className="modal-overlay" onMouseDown={() => !profileConnectionSaving && setProfileConnectionEditor(null)}>
          <form
            className="modal-card profile-connection-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-connection-editor-title"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              if (profileConnectionSaving) return;
              setProfileConnectionSaving(true);
              setProfileConnectionError(null);
              void s.updateProfileConnection(profileConnectionEditor.name, profileConnectionEditor.connection, {
                country: profileConnectionEditor.country,
                proxyId: profileConnectionEditor.proxyId,
              }).then(() => setProfileConnectionEditor(null)).catch((error: unknown) => {
                setProfileConnectionError(error instanceof Error ? error.message : String(error));
              }).finally(() => setProfileConnectionSaving(false));
            }}
          >
            <div className="profile-menu-head">
              <Icon name="network" size={15} className="accent-icon" />
              <span id="profile-connection-editor-title" className="profile-menu-name">Change connection</span>
              <span className="spacer" />
              <Tooltip content="Close"><button type="button" className="plain-icon-btn" disabled={profileConnectionSaving} onClick={() => setProfileConnectionEditor(null)}><Icon name="xmark.circle.fill" size={18} /></button></Tooltip>
            </div>
            <p className="muted personal-proxy-note">Profile <strong>{profileConnectionEditor.name}</strong> keeps its browser data and identity. The new connection is used on its next start.</p>
            <fieldset className="project-mode-field profile-connection-field">
              <legend>Connection</legend>
              {([
                ["direct", "network", "No proxy", "Use your direct internet connection"],
                ["managed", "globe", "Managed proxy", "Choose a country and rotate IP later"],
                ["personal", "network", "Personal proxy", "Use one of your saved proxies"],
              ] as const).filter(([connection]) => connection !== "direct" || s.profiles.find((p) => p.name === profileConnectionEditor.name)?.proxy_mode === "direct").map(([connection, icon, title, description], index) => (
                <label key={connection} className={"project-mode-option" + (profileConnectionEditor.connection === connection ? " is-selected" : "")}>
                  <input type="radio" name="existing-profile-connection" autoFocus={index === 0} checked={profileConnectionEditor.connection === connection} onChange={() => setProfileConnectionEditor({ ...profileConnectionEditor, connection })} />
                  <Icon name={icon} size={16} />
                  <span><strong>{title}</strong><small>{description}</small></span>
                </label>
              ))}
            </fieldset>
            {profileConnectionEditor.connection === "managed" && <div className="modal-field profile-proxy-country-field"><span>Proxy country</span><CountrySelect countries={proxyCountries} value={profileConnectionEditor.country} disabled={profileConnectionSaving} ariaLabel="Proxy country" onChange={(country) => setProfileConnectionEditor({ ...profileConnectionEditor, country })} /></div>}
            {profileConnectionEditor.connection === "personal" && <div className="modal-field profile-personal-proxy-field">
              <span className="profile-field-heading"><span>Personal proxy</span><button type="button" className="link" onClick={() => { resetManualProxyForm(); setManualProxyDeleting(null); setManualProxyEditing(s.personalProxies.length === 0); setManualProxyOpen(true); }}>Manage</button></span>
              {s.personalProxies.length ? <PersonalProxySelect value={profileConnectionEditor.proxyId} proxies={s.personalProxies} disabled={profileConnectionSaving} onChange={(proxyId) => setProfileConnectionEditor({ ...profileConnectionEditor, proxyId })} onAdd={() => { resetManualProxyForm(); setManualProxyDeleting(null); setManualProxyEditing(true); setManualProxyOpen(true); }} /> : <button type="button" className="personal-proxy-empty-action" onClick={() => { resetManualProxyForm(); setManualProxyDeleting(null); setManualProxyEditing(true); setManualProxyOpen(true); }}><Icon name="plus" size={13} /> Create your first proxy</button>}
            </div>}
            {profileConnectionError && <div className="error small" role="alert">{profileConnectionError}</div>}
            <div className="modal-actions"><button type="button" className="secondary" disabled={profileConnectionSaving} onClick={() => setProfileConnectionEditor(null)}>Cancel</button><button type="submit" className="primary" disabled={profileConnectionSaving || (profileConnectionEditor.connection === "personal" && !profileConnectionEditor.proxyId)}>{profileConnectionSaving ? <Spinner size={13} /> : <Icon name="checkmark" size={13} />}{profileConnectionSaving ? "Saving…" : "Save connection"}</button></div>
          </form>
        </div>
      ), document.body)}

      {vpsSetupOpen && <VPSSetupModal onClose={() => setVPSSetupOpen(false)} />}

      {manualProxyOpen && createPortal((
        <div className="modal-overlay" onMouseDown={() => { if (!manualSaving && !manualProxyDeletePending) { setManualProxyOpen(false); setManualProxyDeleting(null); } }}>
          <div className="modal-card manual-proxy-modal" role="dialog" aria-modal="true" aria-labelledby="manual-proxy-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="profile-menu-head">
              <Icon name="network" size={16} className="accent-icon" />
              <span id="manual-proxy-title" className="profile-menu-name">{manualProxyEditing ? (manualProxyMode === "bulk" ? "Add proxies" : "Create proxy") : "Personal proxies"}</span>
              <span className="spacer" />
              <Tooltip content="Close"><button
                type="button"
                className="plain-icon-btn"
                aria-label="Close"
                disabled={manualSaving || manualProxyDeletePending}
                onClick={() => { setManualProxyOpen(false); setManualProxyDeleting(null); }}
              >
                <Icon name="xmark.circle.fill" size={18} />
              </button></Tooltip>
            </div>
            {manualProxyEditing ? (
              <form className="personal-proxy-editor" onSubmit={submitManualProxy}>
                <p className="muted personal-proxy-note">Save proxies here to use with your browser profiles.</p>
                <div className="manual-proxy-mode" role="tablist" aria-label="Manual proxy input mode">
                  <button
                    type="button"
                    className={manualProxyMode === "url" ? "active" : ""}
                    aria-selected={manualProxyMode === "url"}
                    onClick={() => {
                      setManualProxyMode("url");
                      setManualError(null);
                    }}
                  >
                    <Icon name="network" size={13} /> URL
                  </button>
                  <button
                    type="button"
                    className={manualProxyMode === "fields" ? "active" : ""}
                    aria-selected={manualProxyMode === "fields"}
                    onClick={() => {
                      setManualProxyMode("fields");
                      setManualError(null);
                    }}
                  >
                    <Icon name="wrench" size={13} /> Fields
                  </button>
                  <button
                    type="button"
                    className={manualProxyMode === "bulk" ? "active" : ""}
                    aria-selected={manualProxyMode === "bulk"}
                    onClick={() => {
                      setManualProxyMode("bulk");
                      setManualError(null);
                    }}
                  >
                    <Icon name="list.bullet" size={13} /> Bulk
                  </button>
                </div>
                {manualProxyMode === "url" ? (
                  <>
                    <label className="modal-field">
                      <span className="modal-field-heading"><span>Proxy</span><small>Max {manualProxyLimits.url.toLocaleString("en-US")}</small></span>
                      <input
                        value={manualProxyUrl}
                        onChange={(e) => setManualProxyUrl(e.target.value)}
                        placeholder="http://user:pass@host:8080 or host:port:user:pass"
                        maxLength={manualProxyLimits.url}
                        autoFocus
                      />
                    </label>
                    <label className="modal-field">
                      <span className="modal-field-heading"><span>Name (optional)</span><small>Max {manualProxyLimits.name}</small></span>
                      <input
                        value={manualName}
                        onChange={(e) => setManualName(e.target.value)}
                        placeholder="generated from proxy URL"
                        maxLength={manualProxyLimits.name}
                      />
                    </label>
                  </>
                ) : manualProxyMode === "fields" ? (
                  <>
                    <label className="modal-field">
                      <span className="modal-field-heading"><span>Name</span><small>Max {manualProxyLimits.name}</small></span>
                      <input value={manualName} maxLength={manualProxyLimits.name} onChange={(e) => setManualName(e.target.value)} autoFocus />
                    </label>
                    <div className="manual-proxy-grid">
                      <label className="modal-field">
                        <span>Scheme</span>
                        <select value={manualScheme} onChange={(e) => setManualScheme(e.target.value as ManualProxyScheme)}>
                          <option value="http">HTTP</option>
                          <option value="socks5">SOCKS5</option>
                        </select>
                      </label>
                      <label className="modal-field">
                        <span>Port</span>
                        <input value={manualPort} inputMode="numeric" maxLength={5} onChange={(e) => setManualPort(e.target.value.replace(/\D/g, ""))} />
                      </label>
                    </div>
                    <label className="modal-field">
                      <span className="modal-field-heading"><span>Host</span><small>Max {manualProxyLimits.host}</small></span>
                      <input value={manualHost} maxLength={manualProxyLimits.host} onChange={(e) => setManualHost(e.target.value)} />
                    </label>
                    <label className="modal-field">
                      <span className="modal-field-heading"><span>Username</span><small>Max {manualProxyLimits.username}</small></span>
                      <input value={manualUsername} maxLength={manualProxyLimits.username} onChange={(e) => setManualUsername(e.target.value)} />
                    </label>
                    <label className="modal-field">
                      <span className="modal-field-heading"><span>Password</span><small>Max {manualProxyLimits.password.toLocaleString("en-US")}</small></span>
                      <span className="password-input-wrap">
                        <input type={manualPasswordVisible ? "text" : "password"} value={manualPassword} maxLength={manualProxyLimits.password} onChange={(e) => setManualPassword(e.target.value)} />
                        <Tooltip content={manualPasswordVisible ? "Hide password" : "Show password"}><button type="button" className="password-visibility" aria-label={manualPasswordVisible ? "Hide password" : "Show password"} onClick={() => setManualPasswordVisible((visible) => !visible)}>
                          <Icon name={manualPasswordVisible ? "eye.slash" : "eye"} size={14} />
                        </button></Tooltip>
                      </span>
                    </label>
                  </>
                ) : (
                  <>
                    <div className="modal-field manual-proxy-bulk-field">
                      <span className="modal-field-heading">
                        <label htmlFor="personal-proxy-bulk">Proxy list</label>
                        <label className="proxy-import-file">Import file<input type="file" accept=".txt,.csv,text/plain,text/csv" onChange={async event => {
                          const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
                          if (!file) return;
                          if (file.size > manualProxyLimits.batchText * 4) { setManualError("Proxy file is too large."); return; }
                          try { const text = await file.text();
                            if (text.length > manualProxyLimits.batchText) { setManualError("Proxy file is too large."); return; }
                            setManualProxyBulk(text); setManualError(null);
                          } catch { setManualError("Could not read the proxy file."); }
                        }} /></label>
                        <small>Up to {manualProxyLimits.batchLines}</small>
                      </span>
                      <textarea
                        id="personal-proxy-bulk"
                        value={manualProxyBulk}
                        onChange={(event) => {
                          setManualProxyBulk(event.target.value);
                          setManualError(null);
                        }}
                        placeholder={"http://user:pass@host:8080\nhost:8080:user:pass\nsocks5://host:1080"}
                        maxLength={manualProxyLimits.batchText}
                        spellCheck={false}
                        autoFocus
                      />
                    </div>
                    <p className="manual-proxy-format-help">
                      One proxy per line. Supports <code>host:port</code>, <code>host:port:user:pass</code>, <code>user:pass@host:port</code>, and full <code>http://</code> or <code>socks5://</code> URLs.
                      HTTP proxies also work for HTTPS websites through CONNECT; HTTPS and SOCKS4 proxy transports are not supported by the browser runtime.
                    </p>
                    {manualProxyBulk.trim() && (
                      <>
                        <div className={`manual-proxy-batch-status ${manualProxyBatch.errors.length ? "has-errors" : "is-valid"}`}>
                          <strong>{manualProxyBatch.items.length} valid</strong>
                          <span>{manualProxyBatch.errors.length ? `${manualProxyBatch.errors.length} need attention` : "Ready to add"}</span>
                        </div>
                        {manualProxyBatch.errors.length > 0 && (
                          <div className="manual-proxy-line-errors" role="alert">
                            {manualProxyBatch.errors.slice(0, 4).map((error) => (
                              <div key={`${error.lineNumber}-${error.message}`}>
                                <strong>{error.lineNumber ? `Line ${error.lineNumber}` : "List"}</strong>
                                <span>{error.message}</span>
                              </div>
                            ))}
                            {manualProxyBatch.errors.length > 4 && <small>And {manualProxyBatch.errors.length - 4} more…</small>}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
                <button type="button" className="secondary manual-proxy-paste" onClick={() => void importManualProxyFromClipboard()}>
                  <Icon name="doc.on.doc" size={13} /> {manualProxyMode === "bulk" ? "Paste list from clipboard" : "Paste proxy from clipboard"}
                </button>
                {manualError && (
                  <div className="error manual-proxy-error">
                    <UserFacingError message={manualError} surface="manual_proxy" />
                  </div>
                )}
                <div className="modal-actions">
                  <button type="button" className="secondary" disabled={manualSaving} onClick={() => {
                    resetManualProxyForm();
                    setManualProxyEditing(false);
                  }}>
                    Back
                  </button>
                  <button type="submit" className="primary" disabled={manualSaving || (manualProxyMode === "bulk" && (!manualProxyBatch.items.length || manualProxyBatch.errors.length > 0))}>
                    {manualSaving ? <Spinner size={13} /> : <Icon name="plus" size={13} />}
                    {manualSaving
                      ? "Saving…"
                      : manualProxyMode === "bulk" && manualProxyBatch.items.length
                        ? `Add ${manualProxyBatch.items.length} ${manualProxyBatch.items.length === 1 ? "proxy" : "proxies"}`
                        : "Create proxy"}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p className="muted personal-proxy-note">Encrypted in your Nextbrowser account and available on every signed-in device.</p>
                {personalProxyList("")}
                <div className="modal-actions">
                  <button type="button" className="secondary" onClick={() => { setManualProxyOpen(false); setManualProxyDeleting(null); }}>Close</button>
                  <button type="button" className="primary" onClick={() => {
                    resetManualProxyForm();
                    setManualProxyEditing(true);
                  }}>
                    <Icon name="plus" size={13} /> Add proxies
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ), document.body)}

      {confirmDelete && createPortal((
        <div className="modal-overlay" onMouseDown={() => !profileDeleting && setConfirmDelete(null)}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="delete-profile-title" onMouseDown={(event) => event.stopPropagation()}>
            <p id="delete-profile-title">Delete profile "{confirmDelete}"?</p>
            {profileDeleteError && (
              <div className="error small" role="alert" style={{ marginTop: 10 }}>
                <UserFacingError message={profileDeleteError} surface="profile_delete" />
              </div>
            )}
            <div className="row" style={{ marginTop: 12, gap: 8 }}>
              <button className="secondary" disabled={profileDeleting} autoFocus onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button
                className="primary danger"
                disabled={profileDeleting}
                onClick={() => {
                  const profileName = confirmDelete;
                  setProfileDeleting(true);
                  setProfileDeleteError(null);
                  void s.deleteProfile(profileName)
                    .then(() => setConfirmDelete(null))
                    .catch((error: unknown) => {
                      const detail = error instanceof Error ? error.message.trim() : String(error ?? "").trim();
                      console.error("[PROFILE_DELETE_FAILED]", detail);
                      setProfileDeleteError(internalError("We couldn't delete this profile.", "PROFILE_DELETE_FAILED"));
                    })
                    .finally(() => setProfileDeleting(false));
                }}
              >
                {profileDeleting ? <><Spinner size={13} /> Deleting…</> : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ), document.body)}

      {confirmDeleteChat && createPortal((() => {
        const chat = projects.find((item) => item.id === confirmDeleteChat);
        if (!chat) return null;
        const runningProfiles = (chat.profileNames ?? []).filter((name) => s.statuses[name] === "running");
        return (
          <div className="modal-overlay" onMouseDown={() => setConfirmDeleteChat(null)}>
            <div className="modal-card delete-chat-modal" role="dialog" aria-modal="true" aria-labelledby="delete-chat-title" onMouseDown={(event) => event.stopPropagation()}>
              <h3 id="delete-chat-title">Delete “{chat.title}”?</h3>
              <p>This removes the chat and its message history. Profiles stay in the workspace.</p>
              {chatDeleteError && <div className="error small">{chatDeleteError}</div>}
              {runningProfiles.length > 0 && (
                <p className="delete-chat-warning">Stop {runningProfiles.length === 1 ? `“${runningProfiles[0]}”` : "the running profiles"} before deleting this chat.</p>
              )}
              <div className="modal-actions">
                <button className="secondary" autoFocus onClick={() => setConfirmDeleteChat(null)}>Cancel</button>
                <button
                  className="primary danger"
                  disabled={chatDeleting || runningProfiles.length > 0}
                  onClick={async () => {
                    setChatDeleting(true);
                    setChatDeleteError(null);
                    try {
                      await s.deleteConversation(chat.id);
                      setConfirmDeleteChat(null);
                    } catch {
                      setChatDeleteError("Could not delete this project. Nothing was removed. Please retry.");
                    } finally {
                      setChatDeleting(false);
                    }
                  }}
                >
                  Delete chat
                </button>
              </div>
            </div>
          </div>
        );
      })(), document.body)}
  </>;
}
