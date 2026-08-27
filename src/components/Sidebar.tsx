import { type DragEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore, type ManualProxyProfileInput } from "../store";
import { agentById } from "../agents";
import { BrandHeader, BrandLogo } from "./BrandLogo";
import { Icon, Spinner } from "./Icon";
import { withLocalScripts } from "../skillsCatalog";
import { countryFlag, countryLabel, ROTATION_COUNTRIES } from "../lib/countryFlag";
import { guideProfileTarget } from "../lib/guideQuickStart";
import { manualProxyDefaultName, manualProxyLimits, parseManualProxyBatch, parseManualProxyClipboard, validateManualProxyFields, type ManualProxyScheme } from "../lib/manualProxy";
import { internalError, needsSupportLink } from "../lib/userFacingError";
import { entityNameLimits, validateEntityName } from "../lib/entityValidation";
import { cancelNextctlRun } from "../nextctl";
import { conversationPreview, type AppTab, type BrowserWorkflowAction, type BrowserWorkflowSkill } from "../types";
import { CountrySelect } from "./CountrySelect";
import { UserFacingError } from "./UserFacingError";
import { VPSSetupModal } from "./VPSSetupModal";
import { CONNECTORS } from "../connectorsCatalog";
import { invoke, listen } from "../electronBridge";
import { activeAutomationRecording, AUTOMATION_RECORDING_EVENT, type ActiveAutomationRecording } from "../lib/automationRecording";
import { activeAutomationExecution, automationAgentAnswer, automationExecutionView, AUTOMATION_EXECUTION_EVENT, clearActiveAutomationExecution, executionWithRecipeProgress, setActiveAutomationExecution, type AutomationExecution, type AutomationRecipeProgress } from "../lib/automationExecution";
import { parseAutomationRepairRecipe } from "../lib/automationRepair";

type ManualProxyInputMode = "url" | "fields" | "bulk";
const PROFILE_CREATE_TIMEOUT_MS = 120_000;

function recordingDuration(startedAt: number, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function repairedRecipeEvidence(actions: BrowserWorkflowAction[]) {
  return actions.map((action) => `Called clawbrowser.${action.tool}(${JSON.stringify(action.arguments)})\n{"ok":true}`).join("\n");
}

interface SidebarProps {
  onOpenAgentSettings: () => void;
  onHome: () => void;
}

const NAV_ITEMS: Array<{ id: AppTab; label: string; icon: string }> = [
  { id: "skills", label: "Skills", icon: "square.grid.2x2.fill" },
  { id: "connectors", label: "Connectors", icon: "network" },
  { id: "scheduled", label: "Scheduled", icon: "clock.arrow.circlepath" },
  { id: "guide", label: "Guide", icon: "book.fill" },
];

export function Sidebar({ onOpenAgentSettings, onHome }: SidebarProps) {
  const s = useStore();
  const [menuProfile, setMenuProfile] = useState<string | null>(null);
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
  const [createProfileOpen, setCreateProfileOpen] = useState(false);
  const [vpsSetupOpen, setVPSSetupOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileCountry, setProfileCountry] = useState("US");
  const [profileConnection, setProfileConnection] = useState<"managed" | "direct" | "personal">("managed");
  const [profilePersonalProxyId, setProfilePersonalProxyId] = useState("");
  const [profileToolset, setProfileToolset] = useState<"clawbrowser" | "dasbrowser" | "camoufox">("clawbrowser");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileCreationStage, setProfileCreationStage] = useState<string>();
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileActionError, setProfileActionError] = useState<string | null>(null);
  const [profileMoveError, setProfileMoveError] = useState<string | null>(null);
  const [profileConnectionEditor, setProfileConnectionEditor] = useState<{ name: string; connection: "managed" | "direct" | "personal"; country: string; proxyId: string } | null>(null);
  const [profileConnectionSaving, setProfileConnectionSaving] = useState(false);
  const [profileConnectionError, setProfileConnectionError] = useState<string | null>(null);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceCreatorOpen, setWorkspaceCreatorOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [dragOverProfileName, setDragOverProfileName] = useState<string | null>(null);
  const [profileGuideFocus, setProfileGuideFocus] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [activeRecording, setActiveRecording] = useState<ActiveAutomationRecording | undefined>(activeAutomationRecording);
  const [recordingClock, setRecordingClock] = useState(Date.now());
  const [recordingStopping, setRecordingStopping] = useState(false);
  const [recordingError, setRecordingError] = useState<string>();
  const [automationExecution, setAutomationExecution] = useState<AutomationExecution | undefined>(activeAutomationExecution);
  const [automationExecutionClock, setAutomationExecutionClock] = useState(Date.now());
  const [automationExecutionError, setAutomationExecutionError] = useState<string>();
  const profileCreateRequestRef = useRef<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const projectListRef = useRef<HTMLDivElement | null>(null);
  const profileListRef = useRef<HTMLDivElement | null>(null);
  const workspacePickerRef = useRef<HTMLDivElement | null>(null);

  const runProfileAction = (label: string, code: string, action: () => Promise<void>) => {
    setProfileActionError(null);
    void action().catch((error: unknown) => {
      const detail = error instanceof Error ? error.message.trim() : String(error ?? "").trim();
      console.error(`[${code}] ${label}`, detail);
      setProfileActionError(internalError(label, code));
    });
  };

  const agentName = agentById(s.agentId).name;
  const ready = s.agentReady();
  const searchQuery = s.profileSearch.trim();
  const normalizedSearch = searchQuery.toLowerCase();
  const profiles = s.profiles;
  const projects = s.conversationsForAgent(s.agentId);
  const activeProject = s.activeConversation();
  const activeWorkspace = s.workspaces.find((workspace) => workspace.id === s.activeWorkspaceId);
  const manualProxyBatch = useMemo(() => parseManualProxyBatch(manualProxyBulk), [manualProxyBulk]);
  const profileWorkspaceEntries = (activeWorkspace?.profileNames ?? []).flatMap((name) => {
    const profile = profiles.find((item) => item.name === name);
    if (!profile) return [];
    const owner = s.conversations.find((project) => project.id === s.profileChatOwners[name]);
    return {
      profile,
      owner,
      toolset: activeWorkspace?.profileToolsets[name] ?? "clawbrowser" as const,
    };
  });
  const visibleChats = normalizedSearch
    ? projects.filter((project) => project.title.toLowerCase().includes(normalizedSearch))
    : projects;
  const visibleWorkspaceProfiles = normalizedSearch
    ? profileWorkspaceEntries.filter(({ profile }) => profile.name.toLowerCase().includes(normalizedSearch))
    : profileWorkspaceEntries;
  useEffect(() => {
    const handleProjectShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
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
  const showDefaultProfile = defaultKnown &&
    !defaultSessionDuplicate &&
    !s.profiles.some((p) => p.name === "default");
  const visibleProfileCount = profileWorkspaceEntries.length;
  const runningCount = profileWorkspaceEntries.filter(({ profile }) => s.statuses[profile.name] === "running").length;
  const proxyCountries = s.proxyCountries.length ? s.proxyCountries : ROTATION_COUNTRIES;
  const recordingWorkspace = activeRecording ? s.workspaces.find((workspace) => workspace.id === activeRecording.workspaceId) : undefined;
  const automationExecutionWorkspace = automationExecution ? s.workspaces.find((workspace) => workspace.id === automationExecution.workspaceId) : undefined;
  const automationExecutionState = automationExecution ? automationExecutionView(automationExecution, s.conversations, automationExecutionClock) : undefined;
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
    void listen<AutomationRecipeProgress>("automation:recipe-progress", ({ payload }) => {
      const current = activeAutomationExecution();
      if (!current || current.executionId !== payload.executionId) return;
      setActiveAutomationExecution(executionWithRecipeProgress(current, payload));
    }).then((dispose) => { unlisten = dispose; });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (!automationExecution || !automationExecutionState || ["completed", "failed", "cancelled"].includes(automationExecutionState.phase)) return;
    const timer = window.setInterval(() => setAutomationExecutionClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [automationExecution, automationExecutionState?.phase]);

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
        const items = await invoke<Array<{ name: string; createdAt: number }>>("artifact_list", { workspaceId: automationExecution.workspaceId });
        artifactVerified = items.some((artifact) => artifact.name === automationExecution.expectedArtifactName && artifact.createdAt >= automationExecution.startedAt);
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
          const repaired = parseAutomationRepairRecipe(answer.text, automationExecution.workflowSnapshot?.actions || workflow.actions);
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
          const repaired = parseAutomationRepairRecipe(answer.text, originalActions);
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
      const detail = persisted
        ? `${automationExecution.sourceKind === "workflow" ? "Workflow" : "Recording"} completed. AI repaired the fast path and saved it for future runs.`
        : `The original task completed, but the repaired fast path was not saved: ${persistenceError}`;
      if (automationExecution.backendRunId) {
        await invoke("automation_run_update", { id: automationExecution.backendRunId, update: { status: "completed", output: { engine: "hybrid", repaired: true, fast_path_saved: persisted, detail } } }).catch(() => undefined);
      }
      setActiveAutomationExecution({ ...automationExecution, phase: "completed", outputValidated: true, repairPersisted: persisted, repairPersistenceError: persistenceError, progress: 100, detail });
    })().catch((error) => {
      if (cancelled) return;
      const detail = error instanceof Error ? error.message : String(error);
      if (automationExecution.backendRunId) void invoke("automation_run_update", { id: automationExecution.backendRunId, update: { status: "failed", output: { engine: "hybrid", repaired: false, detail } } }).catch(() => undefined);
      setActiveAutomationExecution({ ...automationExecution, phase: "failed", progress: 100, outputValidationError: detail, detail });
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

  const openProfileCreator = () => {
    if (!s.authed) {
      s.setDashboardKeyPromptOpen(true);
      return;
    }
    setProfileName("");
    setProfileCountry("US");
    setProfileConnection("managed");
    setProfilePersonalProxyId(s.personalProxies[0]?.id ?? "");
    setProfileToolset("clawbrowser");
    setProfileError(null);
    setCreateProfileOpen(true);
    void Promise.all([
      s.loadProxyCountries().catch(() => undefined),
      s.loadPersonalProxies().catch(() => undefined),
    ]);
  };

  useEffect(() => {
    if (s.authed) void s.loadPersonalProxies().catch(() => undefined);
  }, [s.authed]);

  useEffect(() => {
    if (profilePersonalProxyId || s.personalProxies.length === 0) return;
    setProfilePersonalProxyId(s.personalProxies[0].id);
  }, [profilePersonalProxyId, s.personalProxies]);

  useEffect(() => {
    if (!workspaceMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (workspacePickerRef.current?.contains(event.target as Node)) return;
      setWorkspaceMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [workspaceMenuOpen]);

  useEffect(() => {
    setProfileMoveError(null);
    if (menuProfile) void s.loadProxyCountries().catch(() => {});
  }, [menuProfile]);

  useEffect(() => {
    const revealProject = () => {
      setProjectsOpen(true);
      window.requestAnimationFrame(() => projectListRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
    };
    const revealProfile = () => setProfilesOpen(true);
    window.addEventListener("nextbrowser:project-created", revealProject);
    window.addEventListener("nextbrowser:profile-created", revealProfile);
    return () => {
      window.removeEventListener("nextbrowser:project-created", revealProject);
      window.removeEventListener("nextbrowser:profile-created", revealProfile);
    };
  }, []);

  useEffect(() => {
    if (!profilesOpen || !s.selectedProfile) return;
    const frame = window.requestAnimationFrame(() => {
      profileListRef.current?.querySelector<HTMLElement>(".profile-row.selected")?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [profilesOpen, s.selectedProfile, visibleWorkspaceProfiles.length]);

  useEffect(() => {
    let focusTimer = 0;
    const focusProfiles = () => {
      setProfileGuideFocus(true);
      window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(() => setProfileGuideFocus(false), 1_400);
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
      const profile = s.selectedProfile ?? s.profiles[0]?.name ?? (showDefaultProfile ? "__default" : null);
      if (profile) setMenuProfile(profile);
    };
    const startSelectedProfile = () => {
      focusProfiles();
      s.setProfileSearch("");
      const profile = guideProfileTarget(
        s.selectedProfile,
        s.profiles.map((item) => item.name),
        showDefaultProfile,
      );
      if (!profile) return;
      if (profile === "__default") {
        s.selectProfile(undefined);
        if (!defaultRunning && !defaultBusy) {
          runProfileAction("We couldn't start the default profile.", "PROFILE_START_FAILED", s.startDefaultSession);
        }
        return;
      }
      s.selectProfile(profile);
      const status = s.statuses[profile] ?? s.profileSessions[profile]?.status ?? "unknown";
      if (status !== "running" && !["starting", "stopping", "rotating"].includes(status)) {
        runProfileAction(`We couldn't start “${profile}”.`, "PROFILE_START_FAILED", () => s.startProfile(profile));
      }
    };
    window.addEventListener("nextbrowser:focus-profiles", focusProfiles);
    window.addEventListener("nextbrowser:open-profile-creator", openCreator);
    window.addEventListener("nextbrowser:open-profile-actions", openActions);
    window.addEventListener("nextbrowser:start-selected-profile", startSelectedProfile);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("nextbrowser:focus-profiles", focusProfiles);
      window.removeEventListener("nextbrowser:open-profile-creator", openCreator);
      window.removeEventListener("nextbrowser:open-profile-actions", openActions);
      window.removeEventListener("nextbrowser:start-selected-profile", startSelectedProfile);
    };
  }, [
    defaultBusy,
    defaultRunning,
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

  const logout = async () => {
    if (logoutPending) return;
    setLogoutPending(true);
    setLogoutError(null);
    try {
      await s.logout();
    } catch {
      setLogoutError(internalError("We couldn't sign you out.", "ACCOUNT_SIGN_OUT_FAILED"));
    } finally {
      setLogoutPending(false);
    }
  };

  const closeProfileCreator = () => {
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
        if (lastSaved) setProfilePersonalProxyId(lastSaved.id);
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

  const submitManagedProfile = async (event: FormEvent) => {
    event.preventDefault();
    try {
      validateEntityName("profile", profileName);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (profileSaving) return;
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
      const createdName = profileName.trim();
      if (profileConnection === "personal") {
        if (!profilePersonalProxyId) throw new Error("Choose a personal proxy.");
        await s.createPersonalProxyProfile(createdName, profilePersonalProxyId, {
          requestId,
          timeoutMs: PROFILE_CREATE_TIMEOUT_MS,
          runtime: profileToolset,
        });
      } else {
        await s.createManagedProfile(createdName, profileCountry, {
          requestId,
          timeoutMs: PROFILE_CREATE_TIMEOUT_MS,
          runtime: profileToolset,
          direct: profileConnection === "direct",
        });
      }
      if (profileCreateRequestRef.current !== requestId) return;
      s.assignProfileToProject(
        createdName,
        profileToolset,
        undefined,
        true,
        profileConnection === "personal" ? profilePersonalProxyId : undefined,
      );
      s.selectProfile(createdName);
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
    } catch (error) {
      if (profileCreateRequestRef.current !== requestId) return;
      const message = error instanceof Error ? error.message : String(error);
      setProfileError(
        /timed out/i.test(message)
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

  if (s.sidebarCollapsed) {
    return (
      <div className="sidebar-mini">
        <button
          className="plain-icon-btn sidebar-collapse-toggle"
          data-tooltip="Expand sidebar"
          aria-label="Expand sidebar"
          onClick={() => s.setSidebarCollapsed(false)}
        >
          <Icon name="sidebar.left" size={17} />
        </button>
        <button className="sidebar-logo-home" onClick={onHome} data-tooltip="Back to main view" aria-label="Back to main view"><BrandLogo size={28} /></button>
        <button className="mini-nav-btn" data-tooltip={`${visibleProfileCount} profiles, ${runningCount} running`} aria-label={`${visibleProfileCount} profiles, ${runningCount} running`} onClick={() => s.setTab("live")}>
          <Icon name="person.crop.circle" size={18} />
          <span>{runningCount}/{visibleProfileCount}</span>
        </button>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={"mini-nav-btn" + (s.tab === item.id ? " active" : "")}
            data-tooltip={item.label}
            aria-label={`Open ${item.label}`}
            aria-current={s.tab === item.id ? "page" : undefined}
            onClick={() => s.setTab(item.id)}
          >
            <Icon name={item.icon} size={18} />
            {badgeFor(item.id) && <span>{badgeFor(item.id)}</span>}
          </button>
        ))}
        {activeRecording && <button className="mini-nav-btn mini-recording-control recording" data-tooltip={recordingMiniLabel} aria-label={`${activeRecording.destination === "workflow" ? "Open workflow recording" : "Open active recording"}.`} onClick={openRecorder}><Icon name="circle.fill" size={18} /><span>{recordingDuration(activeRecording.startedAt, recordingClock)}</span></button>}
        <span className="spacer" />
        <button className="mini-nav-btn" data-tooltip={`Agent: ${agentName}`} aria-label={`Agent: ${agentName}`} onClick={onOpenAgentSettings}>
          <Icon name="cpu.fill" size={18} />
          <span>{ready ? "on" : "off"}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="sidebar-shell">
      <div className="sidebar-brand">
        <div className="row">
          <button className="sidebar-brand-home" onClick={onHome} title="Back to main view"><BrandHeader subtitle="native agent console" /></button>
          <span className="spacer" />
          <button
            className="plain-icon-btn plain-icon-btn-compact sidebar-collapse-toggle"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            onClick={() => s.setSidebarCollapsed(true)}
          >
            <Icon name="sidebar.leading" size={15} />
          </button>
        </div>
      </div>

      {activeRecording && <section className="sidebar-recording-control recording" aria-label={activeRecording.destination === "workflow" ? "Workflow recording in progress" : "Recording in progress"}>
        <div className="sidebar-recording-status"><span className="sidebar-recording-dot" /><div><strong>{activeRecording.destination === "workflow" ? "Recording a workflow" : "Recording in progress"}</strong><small>{recordingWorkspace?.name || "Current workspace"} · {recordingDestinationLabel}</small><small>{recordingDuration(activeRecording.startedAt, recordingClock)} elapsed</small></div></div>
        <div className="sidebar-recording-actions"><button onClick={openRecorder}>{activeRecording.destination === "workflow" ? "Open Workflow Builder" : "Open recorder"}</button><button className="stop" disabled={recordingStopping} onClick={() => void stopRecording()}>{recordingStopping ? <Spinner size={11} /> : <Icon name="stop.fill" size={11} />} {activeRecording.destination === "workflow" ? "Stop & open" : "Stop recording"}</button></div>
        {recordingError && <small className="sidebar-recording-error" role="alert">{recordingError}</small>}
      </section>}

      {automationExecution && automationExecutionState && <section className={`sidebar-execution-control ${automationExecutionState.phase}`} aria-label="Automation execution status">
        <div className="sidebar-execution-status"><span className="sidebar-execution-icon"><Icon name={automationExecutionState.phase === "completed" ? "checkmark.circle.fill" : ["failed", "cancelled"].includes(automationExecutionState.phase) ? "xmark.circle.fill" : automationExecutionState.phase === "stopping" ? "stop.fill" : "play.fill"} size={12} /></span><div><strong>{automationExecutionState.phase === "completed" ? "Workflow completed" : automationExecutionState.phase === "cancelled" ? "Workflow stopped" : automationExecutionState.phase === "failed" ? "Workflow failed" : automationExecutionState.phase === "stopping" ? "Stopping workflow" : automationExecutionState.phase === "preparing" ? "Preparing workflow" : "Workflow running"}</strong><small title={automationExecution.workflowTitle}>{automationExecution.workflowTitle} · {automationExecutionWorkspace?.name || "Current workspace"}</small></div><b>{automationExecutionState.progress}%</b></div>
        <div className="sidebar-execution-track"><i style={{ width: `${automationExecutionState.progress}%` }} /></div>
        <small className="sidebar-execution-detail">{automationExecutionState.detail}</small>
        <div className="sidebar-recording-actions"><button onClick={openAutomationExecution}>Open</button>{["completed", "failed", "cancelled"].includes(automationExecutionState.phase) ? <button onClick={clearActiveAutomationExecution}>Dismiss</button> : <button className="stop" disabled={automationExecution.phase === "stopping"} onClick={() => void stopAutomationExecution()}>{automationExecution.phase === "stopping" ? <Spinner size={11} /> : <Icon name="stop.fill" size={11} />} {automationExecution.phase === "stopping" ? "Stopping" : "Stop"}</button>}</div>
        {automationExecutionError && <small className="sidebar-recording-error" role="alert">{automationExecutionError}</small>}
      </section>}

      <nav className="sidebar-scroll sidebar-nav-list" aria-label="Sidebar pages">
        {NAV_ITEMS.map((item) => {
          const badge = badgeFor(item.id);
          return (
            <button
              key={item.id}
              className={"claw-card sidebar-link-card sidebar-page-link" + (s.tab === item.id ? " active" : "")}
              title={`Open ${item.label}`}
              aria-current={s.tab === item.id ? "page" : undefined}
              onClick={() => s.setTab(item.id)}
            >
              <Icon name={item.icon} size={14} />
              <span className="section">{item.label}</span>
              <span className="spacer" />
              {badge && <span className="profiles-count">{badge}</span>}
            </button>
          );
        })}

        <div className={"claw-card control-card profiles-card" + (profileGuideFocus ? " guide-focus" : "")}>
          <div className="row profiles-panel-head">
            <div className="workspace-picker-wrap" ref={workspacePickerRef}>
              <button
                className="workspace-picker"
                title="Switch workspace"
                aria-expanded={workspaceMenuOpen}
                onClick={() => setWorkspaceMenuOpen((open) => !open)}
              >
                <Icon name="square.grid.2x2.fill" size={12} />
                <span>
                  <small>Workspace</small>
                  <strong>{activeWorkspace?.name ?? "Create workspace"}</strong>
                </span>
                <Icon name="chevron.down" size={11} className={workspaceMenuOpen ? "workspace-chevron open" : "workspace-chevron"} />
              </button>
              {workspaceMenuOpen && (
                <div className="workspace-menu">
                  {s.workspaces.map((workspace) => (
                    <button
                      key={workspace.id}
                      className={workspace.id === s.activeWorkspaceId ? "active" : ""}
                      title={workspace.name}
                      onClick={() => { s.selectWorkspace(workspace.id); setWorkspaceMenuOpen(false); }}
                    >
                      <Icon name={workspace.id === s.activeWorkspaceId ? "checkmark" : "square.grid.2x2"} size={11} />
                      <span>{workspace.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              className="workspace-create-btn"
              title="Create workspace"
              aria-label="Create workspace"
              onClick={() => {
                setWorkspaceName("");
                setWorkspaceMenuOpen(false);
                setWorkspaceCreatorOpen(true);
              }}
            >
              <Icon name="plus" size={13} />
            </button>
          </div>
          <button
            className="proxy-manager-entry"
            title="Create or manage personal proxies"
            onClick={() => {
              if (!s.authed) {
                s.setDashboardKeyPromptOpen(true);
                return;
              }
              resetManualProxyForm();
              setManualProxyEditing(false);
              setManualProxyDeleting(null);
              setManualProxyOpen(true);
              void s.loadPersonalProxies().catch(() => undefined);
            }}
          >
            <Icon name="network" size={13} />
            <span>Create proxy</span>
            {s.personalProxies.length > 0 && <span className="workspace-count">{s.personalProxies.length}</span>}
          </button>

          <div className="search-box">
            <Icon name="magnifyingglass" size={12} className="muted" />
            <input
              ref={searchInputRef}
              className="search-inline"
              placeholder="Search"
              value={s.profileSearch}
              onChange={(e) => {
                const value = e.target.value;
                if (value.trim()) {
                  setProjectsOpen(true);
                  setProfilesOpen(true);
                }
                s.setProfileSearch(value);
              }}
            />
            {s.profileSearch && (
              <button
                className="plain-icon-btn plain-icon-btn-compact"
                title="Clear search"
                onClick={() => s.setProfileSearch("")}
              >
                <Icon name="xmark.circle.fill" size={14} className="muted" />
              </button>
            )}
          </div>

          <div className="profile-list workspace-content">
            <section className={"workspace-section workspace-chats" + (projectsOpen ? " is-open" : "")}>
              <div className="workspace-section-head">
                <button className="workspace-section-toggle" onClick={() => setProjectsOpen((open) => !open)} aria-expanded={projectsOpen} aria-label={projectsOpen ? "Collapse projects" : "Expand projects"}>
                  <Icon name="chevron.right" size={10} className={projectsOpen ? "section-chevron open" : "section-chevron"} />
                  <Icon name="folder" size={12} />
                  <span>Projects</span>
                  <span className="workspace-count">{projects.length}</span>
                </button>
                <span className="spacer" />
                <button className="workspace-create-action" title="Create project" aria-label="Create project" onClick={() => window.dispatchEvent(new CustomEvent("nextbrowser:create-project"))}>
                  <Icon name="plus" size={12} />
                  <span>Create</span>
                </button>
              </div>
              <div className={"workspace-section-reveal" + (projectsOpen ? " is-open" : "")} aria-hidden={!projectsOpen}>
                <div ref={projectListRef} className="workspace-chat-list">
                {visibleChats.map((chat) => (
                  <button
                    key={chat.id}
                    className={"workspace-chat-row" + (chat.id === activeProject?.id ? " active" : "")}
                    title={`Open ${chat.title}`}
                    onClick={() => { s.selectConversation(chat.id); s.setTab("chat"); }}
                  >
                    <Icon name={chat.chatMode === "terminal" ? "terminal" : "bubble.left.and.bubble.right.fill"} size={12} />
                    <span className="workspace-chat-copy">
                      <strong><HighlightedName text={chat.title} query={searchQuery} /></strong>
                      <small>{conversationPreview(chat)}</small>
                    </span>
                    {chat.id === activeProject?.id && <span className="workspace-active-dot" title="Active chat" />}
                    <span
                      className="workspace-chat-delete"
                      role="button"
                      tabIndex={0}
                      title="Delete chat"
                      aria-label={`Delete ${chat.title}`}
                      onClick={(event) => { event.stopPropagation(); setConfirmDeleteChat(chat.id); }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        event.stopPropagation();
                        setConfirmDeleteChat(chat.id);
                      }}
                    >
                      <Icon name="trash" size={12} />
                    </span>
                  </button>
                ))}
                </div>
              </div>
            </section>

            <section className={"workspace-section workspace-profiles" + (profilesOpen ? " is-open" : "")}>
              <div className="workspace-section-head">
                <button className="workspace-section-toggle" onClick={() => setProfilesOpen((open) => !open)} aria-expanded={profilesOpen} aria-label={profilesOpen ? "Collapse profiles" : "Expand profiles"}>
                  <Icon name="chevron.right" size={10} className={profilesOpen ? "section-chevron open" : "section-chevron"} />
                  <Icon name="person.2.fill" size={12} />
                  <span>Profiles</span>
                  <span className="workspace-count">{visibleProfileCount}</span>
                </button>
                <span className="spacer" />
                <button
                  className="workspace-create-action"
                  title={activeProject ? "Create profile" : "Create a project first"}
                  aria-label="Create profile"
                  disabled={s.isRefreshing || !activeProject}
                  onClick={openProfileCreator}
                >
                  <Icon name={s.authed ? "plus" : "lock"} size={12} />
                  <span>Create</span>
                </button>
              </div>
              <div className={"workspace-section-reveal" + (profilesOpen ? " is-open" : "")} aria-hidden={!profilesOpen}>
                <div ref={profileListRef} className="workspace-profile-list">
                {visibleWorkspaceProfiles.map(({ profile: p, owner, toolset }) => {
                      const status = s.statuses[p.name] ?? "unknown";
                      const running = status === "running";
                      const busy = s.nextctlUpdating || ["starting", "stopping", "rotating"].includes(status);
                      const selected = s.selectedProfile === p.name;
                      const occupiedByOther = running && !!owner && owner.id !== activeProject?.id;
                      const manual = p.proxy_mode === "manual" && p.manual_proxy;
                      const identity = s.profileIdentities[p.name];
                      return (
                        <ProfileRow
                          key={p.name} name={p.name} status={status} running={running} busy={busy || occupiedByOther} selected={selected}
                          country={p.country ?? identity?.country} city={p.city ?? identity?.city} ip={identity?.ip}
                          toolset={toolset} searchQuery={searchQuery}
                          occupiedBy={occupiedByOther ? owner?.title ?? "Another chat" : undefined}
                          manualScheme={manual ? p.manual_proxy?.scheme : undefined}
                          manualTitle={manual ? `${p.manual_proxy?.host ?? ""}:${p.manual_proxy?.port ?? ""}` : undefined}
                          draggable={!normalizedSearch}
                          dragOver={dragOverProfileName === p.name}
                          projectId={activeWorkspace?.id}
                          onDragOverProfile={(event) => {
                            const sourceWorkspace = event.dataTransfer.getData("application/x-nextbrowser-project");
                            if (!activeWorkspace || (sourceWorkspace && sourceWorkspace !== activeWorkspace.id)) return;
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                            setDragOverProfileName(p.name);
                          }}
                          onDragLeaveProfile={() => setDragOverProfileName((current) => current === p.name ? null : current)}
                          onDropProfile={(event) => {
                            event.preventDefault();
                            setDragOverProfileName(null);
                            const sourceProfile = event.dataTransfer.getData("application/x-nextbrowser-profile");
                            const sourceWorkspace = event.dataTransfer.getData("application/x-nextbrowser-project");
                            if (!activeWorkspace || !sourceProfile || sourceWorkspace !== activeWorkspace.id) return;
                            s.reorderProfileInProject(activeWorkspace.id, sourceProfile, p.name);
                          }}
                          onSelect={() => s.selectProfile(selected ? undefined : p.name)}
                          onStart={() => {
                            if (!activeProject || occupiedByOther) return;
                            s.assignProfileToProject(p.name, toolset, s.activeWorkspaceId);
                            s.selectProfile(p.name);
                            s.setTab("chat");
                            runProfileAction(`We couldn't start “${p.name}”.`, "PROFILE_START_FAILED", () => s.startProfile(p.name));
                          }}
                          onStop={() => runProfileAction(`We couldn't stop “${p.name}”.`, "PROFILE_STOP_FAILED", () => s.stopProfile(p.name))}
                          onLive={() => { s.selectProfile(p.name); s.setTab("live"); }}
                          onMenu={() => setMenuProfile(p.name)}
                        />
                      );
                })}
                </div>
              </div>
              {profilesOpen && visibleProfileCount === 0 && <div className="muted small workspace-empty">No profiles yet</div>}
            </section>
            {normalizedSearch && visibleChats.length === 0 && visibleWorkspaceProfiles.length === 0 && (
              <div className="muted small">No matches for "{s.profileSearch}".</div>
            )}
            {profileActionError && (
              <div className="error small profile-action-error" role="alert">{profileActionError}</div>
            )}
          </div>
        </div>
      </nav>

      <hr className="divider" />
      <div className={"sidebar-account-footer" + (s.authed ? " is-connected" : "")}>
        <Icon name={s.authed ? "person.crop.circle" : "lock"} size={14} />
        <span title={s.authed ? s.accountEmail || "Browser account connected" : "Browser account not connected"}>
          {s.authed ? s.accountEmail || "Browser account connected" : "Browser account not connected"}
        </span>
        {s.authed ? (
          <button
            className="plain-icon-btn plain-icon-btn-compact"
            title="Sign out of NextBrowser"
            aria-label="Sign out of NextBrowser"
            disabled={logoutPending}
            onClick={() => void logout()}
          >
            {logoutPending
              ? <Spinner size={13} />
              : <Icon name="rectangle.portrait.and.arrow.right" size={13} />}
          </button>
        ) : (
          <button
            className="sidebar-account-action"
            type="button"
            onClick={() => s.setDashboardKeyPromptOpen(true)}
          >
            Sign in
          </button>
        )}
      </div>
      {logoutError && <div className="sidebar-account-error" role="alert">{logoutError}</div>}
      <div className="nextctl-footer muted small">
        <Icon name="terminal" size={12} />
        <span>nextctl {s.nextctlVersion || "..."}</span>
        <button
          className="plain-icon-btn plain-icon-btn-compact nextctl-refresh"
          title="Check for a newer nextctl and update"
          disabled={s.nextctlUpdating}
          onClick={() => s.checkNextctlUpdate()}
        >
          {s.nextctlUpdating ? <Spinner size={12} /> : <Icon name="arrow.triangle.2.circlepath" size={12} />}
        </button>
        {s.nextctlUpdateStatus && (
          <span className={needsSupportLink(s.nextctlUpdateStatus) ? "warn" : ""}>
            · <UserFacingError message={s.nextctlUpdateStatus} surface="component_update" />
          </span>
        )}
        {!s.nextctlSupportsSkill && <span className="warn"> · no skill cmd</span>}
        <span className="spacer" />
        <button
          className={"agent-footer-status" + (ready ? " is-ready" : "")}
          title="Agent settings"
          aria-label="Open agent settings"
          onClick={onOpenAgentSettings}
        >
          <span className="status-dot" />
          <span>{ready ? agentName : "No agent"}</span>
          <Icon name="chevron.down" size={11} />
        </button>
      </div>

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
              <button
                type="button"
                className="plain-icon-btn"
                title={profileSaving ? "Cancel profile creation" : "Close"}
                aria-label={profileSaving ? "Cancel profile creation" : "Close profile creation"}
                onClick={closeProfileCreator}
              >
                <Icon name="xmark.circle.fill" size={18} />
              </button>
            </div>
            <div className="profile-workspace-context">
              <Icon name="square.grid.2x2.fill" size={13} />
              <span>Workspace</span>
              <strong>{activeWorkspace?.name ?? "Current workspace"}</strong>
            </div>
            <label className="modal-field profile-name-primary">
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
            </label>
            <fieldset className="project-mode-field profile-connection-field">
              <legend>Connection</legend>
              <label className={"project-mode-option" + (profileConnection === "direct" ? " is-selected" : "")}>
                <input type="radio" name="profile-connection" checked={profileConnection === "direct"} onChange={() => setProfileConnection("direct")} />
                <Icon name="network" size={16} />
                <span><strong>No proxy</strong><small>Use your direct internet connection</small></span>
              </label>
              <label className={"project-mode-option" + (profileConnection === "managed" ? " is-selected" : "")}>
                <input type="radio" name="profile-connection" checked={profileConnection === "managed"} onChange={() => setProfileConnection("managed")} />
                <Icon name="globe" size={16} />
                <span><strong>Managed proxy</strong><small>Choose the proxy country</small></span>
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
            </fieldset>
            {profileConnection === "managed" && <div className="modal-field profile-proxy-country-field">
              <span>Proxy country</span>
              <CountrySelect
                countries={proxyCountries}
                value={profileCountry}
                disabled={profileSaving}
                ariaLabel="Proxy country"
                onChange={setProfileCountry}
              />
            </div>}
            {profileConnection === "personal" && (
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
                  <select
                    value={profilePersonalProxyId}
                    disabled={profileSaving}
                    onChange={(event) => setProfilePersonalProxyId(event.target.value)}
                    aria-label="Personal proxy"
                  >
                    <option value="" disabled>Choose a proxy</option>
                    {s.personalProxies.map((proxy) => (
                      <option key={proxy.id} value={proxy.id}>
                        {proxy.name} · {proxy.scheme.toUpperCase()} · {proxy.host}:{proxy.port}
                      </option>
                    ))}
                  </select>
                ) : (
                  <button
                    type="button"
                    className="personal-proxy-empty-action"
                    onClick={() => {
                      resetManualProxyForm();
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
                <span><strong>ClawBrowser</strong><small>Managed identity and proxy</small></span>
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
            </fieldset>
            <section className="profile-remote-section" aria-label="Remote execution">
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
            </section>
            {profileError && <div className="error small profile-create-error">{profileError}</div>}
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
                disabled={profileSaving || !profileName.trim() || (profileConnection === "personal" && !profilePersonalProxyId)}
              >
                {profileSaving ? <Spinner size={13} /> : <Icon name="plus" size={13} />}
                {profileSaving ? profileCreationStage ?? "Creating…" : "Create profile"}
              </button>
            </div>
          </form>
        </div>
      ), document.body)}

      {workspaceCreatorOpen && createPortal((
        <div className="modal-overlay" onMouseDown={() => setWorkspaceCreatorOpen(false)}>
          <form
            className="modal-card workspace-create-modal"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
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
              <span className="profile-menu-name">Create workspace</span>
              <span className="spacer" />
              <button type="button" className="plain-icon-btn" title="Close" onClick={() => setWorkspaceCreatorOpen(false)}>
                <Icon name="xmark.circle.fill" size={18} />
              </button>
            </div>
            <label className="modal-field">
              <span className="modal-field-heading"><span>Workspace name</span><small>Max {entityNameLimits.workspace}</small></span>
              <input value={workspaceName} maxLength={entityNameLimits.workspace} onChange={(event) => { setWorkspaceName(event.target.value); setWorkspaceError(null); }} placeholder="New workspace" autoFocus />
            </label>
            <p className="muted small workspace-create-note">Chats and profiles created here stay inside this workspace.</p>
            {workspaceError && <div className="error small">{workspaceError}</div>}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setWorkspaceCreatorOpen(false)}>Cancel</button>
              <button type="submit" className="primary" disabled={workspaceSaving || !workspaceName.trim()}>
                {workspaceSaving ? <Spinner size={13} /> : <Icon name="plus" size={13} />} Create workspace
              </button>
            </div>
          </form>
        </div>
      ), document.body)}

      {menuProfile && createPortal((() => {
        const isDefaultProfile = menuProfile === "__default";
        const prof = s.profiles.find((p) => p.name === menuProfile);
        const identity = isDefaultProfile ? s.profileIdentities.__default : s.profileIdentities[menuProfile];
        const activeCountry = (isDefaultProfile ? identity?.country : prof?.country ?? identity?.country)?.toLowerCase();
        const status = isDefaultProfile ? defaultStatus : s.statuses[menuProfile] ?? "unknown";
        const manual = prof?.proxy_mode === "manual" && prof.manual_proxy;
        const direct = prof?.proxy_mode === "direct";
        const profileWorkspace = s.workspaces.find((workspace) => workspace.profileNames.includes(menuProfile));
        const profileBusy = ["running", "starting", "stopping", "rotating"].includes(status);
        return (
          <div className="modal-overlay" onClick={() => setMenuProfile(null)}>
            <div className="modal-card profile-menu" onClick={(e) => e.stopPropagation()}>
              <div className="profile-menu-head">
                <span
                  className={"dot " + (status === "running" ? "green" : status === "unknown" ? "gray" : "orange")}
                  title={status}
                />
                <span className="profile-menu-name">{isDefaultProfile ? "default" : menuProfile}</span>
                {activeCountry && (
                  <span className="badge profile-country-badge" title={countryLabel(activeCountry, identity?.city ?? prof?.city)}>
                    {countryFlag(activeCountry)} {activeCountry.toUpperCase()}
                  </span>
                )}
                {identity?.ip && <span className="badge profile-ip-badge" title="Current proxy IP">{identity.ip}</span>}
                {manual && (
                  <span
                    className="badge manual-proxy-badge"
                    title={`${prof.manual_proxy?.host ?? ""}:${prof.manual_proxy?.port ?? ""}`}
                  >
                    {(prof.manual_proxy?.scheme ?? "http").toUpperCase()}
                  </span>
                )}
                <span className="spacer" />
                <button className="plain-icon-btn" title="Close" onClick={() => setMenuProfile(null)}>
                  <Icon name="xmark.circle.fill" size={18} />
                </button>
              </div>

              <button
                className="full rotate-btn"
                onClick={() => {
                  if (isDefaultProfile) s.rotateDefaultSession();
                  else s.rotateProfile(menuProfile);
                  setMenuProfile(null);
                }}
              >
                <Icon name="arrow.triangle.2.circlepath" size={14} strokeWidth={2.25} />
                {manual || direct ? "Restart profile" : "Rotate IP"}
              </button>

              {!manual && !direct && (
                <>
                  <div className="section profile-menu-label">Rotate country</div>
                  <CountrySelect
                    countries={proxyCountries}
                    value={activeCountry ?? ""}
                    ariaLabel="Rotate country"
                    onChange={(country) => {
                      if (isDefaultProfile) void s.rotateDefaultSessionCountry(country);
                      else void s.rotateProfileCountry(menuProfile, country);
                      setMenuProfile(null);
                    }}
                  />
                </>
              )}

              {!isDefaultProfile && profileWorkspace && (
                <>
                  <div className="section profile-menu-label">Connection</div>
                  <button
                    type="button"
                    className="profile-connection-edit-button"
                    disabled={profileBusy}
                    title={profileBusy ? "Stop the profile before changing its connection" : "Change profile connection"}
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
                  </button>
                  <div className="section profile-menu-label">Workspace</div>
                  <select
                    className="profile-workspace-select"
                    value={profileWorkspace.id}
                    disabled={profileBusy || s.projectsSyncing || s.workspaces.length < 2}
                    onChange={(event) => {
                      const targetId = event.target.value;
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
                  >
                    {s.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
                  </select>
                  {profileBusy && <div className="muted small profile-workspace-note">Stop the profile to move it.</div>}
                  {!profileBusy && s.projectsSyncing && <div className="muted small profile-workspace-note">Syncing workspaces…</div>}
                  {profileMoveError && <div className="error small profile-workspace-note">{profileMoveError}</div>}
                </>
              )}

              {!isDefaultProfile && (
                <>
                  <div className="profile-menu-divider" />
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
                </>
              )}
            </div>
          </div>
        );
      })(), document.body)}

      {profileConnectionEditor && createPortal((
        <div className="modal-overlay" onMouseDown={() => !profileConnectionSaving && setProfileConnectionEditor(null)}>
          <form
            className="modal-card profile-connection-editor"
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
              <span className="profile-menu-name">Change connection</span>
              <span className="spacer" />
              <button type="button" className="plain-icon-btn" title="Close" disabled={profileConnectionSaving} onClick={() => setProfileConnectionEditor(null)}><Icon name="xmark.circle.fill" size={18} /></button>
            </div>
            <p className="muted personal-proxy-note">Profile <strong>{profileConnectionEditor.name}</strong> keeps its browser data and identity. The new connection is used on its next start.</p>
            <fieldset className="project-mode-field profile-connection-field">
              <legend>Connection</legend>
              {([
                ["direct", "network", "No proxy", "Use your direct internet connection"],
                ["managed", "globe", "Managed proxy", "Choose a country and rotate IP later"],
                ["personal", "network", "Personal proxy", "Use one of your saved proxies"],
              ] as const).map(([connection, icon, title, description]) => (
                <label key={connection} className={"project-mode-option" + (profileConnectionEditor.connection === connection ? " is-selected" : "")}>
                  <input type="radio" name="existing-profile-connection" checked={profileConnectionEditor.connection === connection} onChange={() => setProfileConnectionEditor({ ...profileConnectionEditor, connection })} />
                  <Icon name={icon} size={16} />
                  <span><strong>{title}</strong><small>{description}</small></span>
                </label>
              ))}
            </fieldset>
            {profileConnectionEditor.connection === "managed" && <div className="modal-field profile-proxy-country-field"><span>Proxy country</span><CountrySelect countries={proxyCountries} value={profileConnectionEditor.country} disabled={profileConnectionSaving} ariaLabel="Proxy country" onChange={(country) => setProfileConnectionEditor({ ...profileConnectionEditor, country })} /></div>}
            {profileConnectionEditor.connection === "personal" && <div className="modal-field profile-personal-proxy-field">
              <span className="profile-field-heading"><span>Personal proxy</span><button type="button" className="link" onClick={() => { resetManualProxyForm(); setManualProxyEditing(s.personalProxies.length === 0); setManualProxyOpen(true); }}>Manage</button></span>
              {s.personalProxies.length ? <select value={profileConnectionEditor.proxyId} disabled={profileConnectionSaving} onChange={(event) => setProfileConnectionEditor({ ...profileConnectionEditor, proxyId: event.target.value })}><option value="" disabled>Choose a proxy</option>{s.personalProxies.map((proxy) => <option key={proxy.id} value={proxy.id}>{proxy.name} · {proxy.scheme.toUpperCase()} · {proxy.host}:{proxy.port}</option>)}</select> : <button type="button" className="personal-proxy-empty-action" onClick={() => { resetManualProxyForm(); setManualProxyEditing(true); setManualProxyOpen(true); }}><Icon name="plus" size={13} /> Create your first proxy</button>}
            </div>}
            {profileConnectionError && <div className="error small" role="alert">{profileConnectionError}</div>}
            <div className="modal-actions"><button type="button" className="secondary" disabled={profileConnectionSaving} onClick={() => setProfileConnectionEditor(null)}>Cancel</button><button type="submit" className="primary" disabled={profileConnectionSaving || (profileConnectionEditor.connection === "personal" && !profileConnectionEditor.proxyId)}>{profileConnectionSaving ? <Spinner size={13} /> : <Icon name="checkmark" size={13} />}{profileConnectionSaving ? "Saving…" : "Save connection"}</button></div>
          </form>
        </div>
      ), document.body)}

      {vpsSetupOpen && <VPSSetupModal onClose={() => setVPSSetupOpen(false)} />}

      {manualProxyOpen && createPortal((
        <div className="modal-overlay" onMouseDown={() => !manualSaving && !manualProxyDeletePending && setManualProxyOpen(false)}>
          <div className="modal-card manual-proxy-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="profile-menu-head">
              <Icon name="network" size={16} className="accent-icon" />
              <span className="profile-menu-name">{manualProxyEditing ? (manualProxyMode === "bulk" ? "Add proxies" : "Create proxy") : "Personal proxies"}</span>
              <span className="spacer" />
              <button
                type="button"
                className="plain-icon-btn"
                title="Close"
                disabled={manualSaving || manualProxyDeletePending}
                onClick={() => setManualProxyOpen(false)}
              >
                <Icon name="xmark.circle.fill" size={18} />
              </button>
            </div>
            {manualProxyEditing ? (
              <form className="personal-proxy-editor" onSubmit={submitManualProxy}>
                <p className="muted personal-proxy-note">Save proxies here, then select one for any browser profile.</p>
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
                        <button type="button" className="password-visibility" title={manualPasswordVisible ? "Hide password" : "Show password"} aria-label={manualPasswordVisible ? "Hide password" : "Show password"} onClick={() => setManualPasswordVisible((visible) => !visible)}>
                          <Icon name={manualPasswordVisible ? "eye.slash" : "eye"} size={14} />
                        </button>
                      </span>
                    </label>
                  </>
                ) : (
                  <>
                    <label className="modal-field manual-proxy-bulk-field">
                      <span className="modal-field-heading">
                        <span>Proxy list</span>
                        <small>Up to {manualProxyLimits.batchLines}</small>
                      </span>
                      <textarea
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
                    </label>
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
                <p className="muted personal-proxy-note">Encrypted in your NextBrowser account and available on every signed-in device.</p>
                {s.personalProxies.length ? (
                  <div className="personal-proxy-list">
                    {s.personalProxies.map((proxy) => (
                      <div className="personal-proxy-row" key={proxy.id}>
                        <span className="personal-proxy-icon"><Icon name="network" size={13} /></span>
                        <span className="personal-proxy-copy">
                          <strong>{proxy.name}</strong>
                          <small>{proxy.scheme.toUpperCase()} · {proxy.host}:{proxy.port}</small>
                        </span>
                        <button
                          type="button"
                          className="plain-icon-btn plain-icon-btn-compact"
                          title={`Delete ${proxy.name}`}
                          aria-label={`Delete ${proxy.name}`}
                          onClick={() => setManualProxyDeleting(proxy.id)}
                        >
                          <Icon name="trash" size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="personal-proxy-empty">
                    <Icon name="network" size={20} />
                    <strong>No personal proxies yet</strong>
                    <span>Create one and reuse it across browser profiles.</span>
                  </div>
                )}
                {manualProxyDeleting && (() => {
                  const proxy = s.personalProxies.find((item) => item.id === manualProxyDeleting);
                  if (!proxy) return null;
                  return (
                    <div className="personal-proxy-delete-confirm" role="alert">
                      <span>Delete “{proxy.name}” from this device?</span>
                      <div className="row">
                        <button type="button" className="secondary" disabled={manualProxyDeletePending} onClick={() => setManualProxyDeleting(null)}>Cancel</button>
                        <button
                          type="button"
                          className="primary danger"
                          disabled={manualProxyDeletePending}
                          onClick={() => {
                            setManualProxyDeletePending(true);
                            void s.deletePersonalProxy(proxy.id)
                              .then(() => {
                                if (profilePersonalProxyId === proxy.id) setProfilePersonalProxyId("");
                                setManualProxyDeleting(null);
                              })
                              .catch(() => setManualError(internalError("We couldn't delete the proxy.", "PERSONAL_PROXY_DELETE_FAILED")))
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
                <div className="modal-actions">
                  <button type="button" className="secondary" onClick={() => setManualProxyOpen(false)}>Close</button>
                  <button type="button" className="primary" onClick={() => {
                    resetManualProxyForm();
                    setManualProxyEditing(true);
                  }}>
                    <Icon name="plus" size={13} /> Create proxy
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ), document.body)}

      {confirmDelete && createPortal((
        <div className="modal-overlay" onMouseDown={() => !profileDeleting && setConfirmDelete(null)}>
          <div className="modal-card" onMouseDown={(event) => event.stopPropagation()}>
            <p>Delete profile "{confirmDelete}"?</p>
            {profileDeleteError && (
              <div className="error small" role="alert" style={{ marginTop: 10 }}>
                <UserFacingError message={profileDeleteError} surface="profile_delete" />
              </div>
            )}
            <div className="row" style={{ marginTop: 12, gap: 8 }}>
              <button className="secondary" disabled={profileDeleting} onClick={() => setConfirmDelete(null)}>
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
            <div className="modal-card delete-chat-modal" onMouseDown={(event) => event.stopPropagation()}>
              <h3>Delete “{chat.title}”?</h3>
              <p>This removes the chat and its message history. Profiles stay in the workspace.</p>
              {runningProfiles.length > 0 && (
                <p className="delete-chat-warning">Stop {runningProfiles.length === 1 ? `“${runningProfiles[0]}”` : "the running profiles"} before deleting this chat.</p>
              )}
              <div className="modal-actions">
                <button className="secondary" onClick={() => setConfirmDeleteChat(null)}>Cancel</button>
                <button
                  className="primary danger"
                  disabled={runningProfiles.length > 0}
                  onClick={() => {
                    s.deleteConversation(chat.id);
                    setConfirmDeleteChat(null);
                  }}
                >
                  Delete chat
                </button>
              </div>
            </div>
          </div>
        );
      })(), document.body)}
    </div>
  );
}

function HighlightedName({ text, query }: { text: string; query?: string }) {
  const normalizedQuery = query?.trim().toLowerCase();
  if (!normalizedQuery) return <>{text}</>;
  const index = text.toLowerCase().indexOf(normalizedQuery);
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="search-match">{text.slice(index, index + normalizedQuery.length)}</mark>
      {text.slice(index + normalizedQuery.length)}
    </>
  );
}

function ProfileRow({
  name,
  status,
  running,
  busy,
  selected,
  country,
  city,
  ip,
  manualScheme,
  manualTitle,
  toolset,
  occupiedBy,
  searchQuery,
  draggable,
  dragOver,
  projectId,
  onDragOverProfile,
  onDropProfile,
  onDragLeaveProfile,
  onSelect,
  onStart,
  onStop,
  onLive,
  onMenu,
}: {
  name: string;
  status: string;
  running: boolean;
  busy: boolean;
  selected: boolean;
  country?: string | null;
  city?: string | null;
  ip?: string | null;
  manualScheme?: string | null;
  manualTitle?: string;
  toolset?: "clawbrowser" | "dasbrowser" | "camoufox";
  occupiedBy?: string;
  searchQuery?: string;
  draggable?: boolean;
  dragOver?: boolean;
  projectId?: string;
  onDragOverProfile?: (event: DragEvent<HTMLDivElement>) => void;
  onDropProfile?: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeaveProfile?: () => void;
  onSelect: () => void;
  onStart: () => void;
  onStop: () => void;
  onLive: () => void;
  onMenu: () => void;
}) {
  return (
    <div
      className={"profile-row" + (selected ? " selected" : "") + (occupiedBy ? " is-occupied" : "") + (draggable ? " is-draggable" : "") + (dragOver ? " is-drag-over" : "")}
      onClick={onSelect}
      draggable={draggable}
      onDragStart={(event) => {
        if (!draggable) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-nextbrowser-profile", name);
        event.dataTransfer.setData("application/x-nextbrowser-toolset", toolset ?? "clawbrowser");
        event.dataTransfer.setData("application/x-nextbrowser-project", projectId ?? "");
      }}
      onDragOver={onDragOverProfile}
      onDragLeave={onDragLeaveProfile}
      onDrop={onDropProfile}
    >
      <span className={"dot " + (running ? "green" : busy ? "orange" : "gray")} title={status} />
      <span className="profile-main">
        <span className="profile-title-line">
          <span className="profile-name"><HighlightedName text={name} query={searchQuery} /></span>
        </span>
        <span className="profile-meta">
          {occupiedBy ? `In use · ${occupiedBy}` : ip ? `${status} · ${ip}` : status}
        </span>
      </span>
      <span className="profile-badges">
        {occupiedBy && <span className="profile-in-use-badge">In use</span>}
        {country && (
          <span className="badge profile-country-badge" title={countryLabel(country, city)}>
            {countryFlag(country)} {country.toUpperCase()}
          </span>
        )}
        {toolset && (
          <span
            className="profile-toolset-logo"
            title={toolset === "clawbrowser" ? "ClawBrowser" : toolset === "dasbrowser" ? "DasBrowser" : "Camoufox"}
            role="img"
            aria-label={toolset === "clawbrowser" ? "ClawBrowser" : toolset === "dasbrowser" ? "DasBrowser" : "Camoufox"}
          >
            <img
              src={toolset === "clawbrowser" ? "./clawbrowser-icon.png" : toolset === "dasbrowser" ? "./dasbrowser-icon.png" : "./camoufox-icon.svg"}
              alt=""
              draggable={false}
            />
          </span>
        )}
        {manualScheme && (
          <span className="badge manual-proxy-badge" title={manualTitle}>
            {manualScheme.toUpperCase()}
          </span>
        )}
      </span>
      <div className="profile-actions">
        {running ? (
          <>
            <button
              className="plain-icon-btn"
              title="Stop"
              aria-label={`Stop ${name}`}
              data-tooltip="Stop"
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                void onStop();
              }}
            >
              <Icon name="stop.fill" size={16} />
            </button>
            <button
              className="plain-icon-btn"
              title="Live view"
              aria-label={`Open live view for ${name}`}
              data-tooltip="Live view"
              onClick={(event) => {
                event.stopPropagation();
                onLive();
              }}
            >
              <Icon name="video.fill" size={16} />
            </button>
          </>
        ) : (
          <button
            className="plain-icon-btn"
            title="Start"
            aria-label={`Start ${name}`}
            data-tooltip="Start"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              void onStart();
            }}
          >
            <Icon name="play.fill" size={16} />
          </button>
        )}
        <button
          className="plain-icon-btn"
          title="Profile actions"
          aria-label={`Profile actions for ${name}`}
          data-tooltip="Actions"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onMenu();
          }}
        >
          <Icon name="ellipsis.circle" size={18} />
        </button>
      </div>
    </div>
  );
}
