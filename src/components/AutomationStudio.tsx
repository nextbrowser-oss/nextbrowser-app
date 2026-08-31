import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { invoke } from "../electronBridge";
import { uid } from "../lib/ids";
import { activeAutomationRecording, AUTOMATION_RECORDING_EVENT, clearActiveAutomationRecording, setActiveAutomationRecording, type ActiveAutomationRecording } from "../lib/automationRecording";
import {
  capturedWorkflowDomain,
  recordedBrowserActions,
  workflowQuality,
} from "../lib/workflowCapture";
import { capturedRunFromHybridRecording, capturedRunsForRecording, capturedTaskRunsForRecording, hasPendingTaskRunForRecording, skillFromRun, type CapturedRun, type ManualBrowserRecording } from "../lib/automationStudio";
import type { AutomationArtifact, BrowserWorkflowAction, BrowserWorkflowSkill } from "../types";
import { humanBytes } from "../types";
import { Icon, Spinner } from "./Icon";
import { activeAutomationExecution, automationExecutionView, AUTOMATION_EXECUTION_EVENT, clearActiveAutomationExecution, setActiveAutomationExecution, type AutomationExecution } from "../lib/automationExecution";
import { userFacingBrowserError } from "../lib/userFacingBrowserError";
import { agentById, agentInvocation } from "../agents";
import { parseWorkflowAiEdit, workflowAiEditPrompt } from "../lib/workflowAiEdit";
import { automationRepairTask, shouldAutoRepairAutomation } from "../lib/automationRepair";

type StudioSection = "recorder" | "workflows" | "artifacts";
type BackendRecording = { id: string; status: string; revision: number; document: { run?: CapturedRun }; created_at?: string; updated_at: string };
type BackendRun = { id: string; workflow_id: string; workflow_version: number; status: "queued" | "running" | "completed" | "failed" | "cancelled"; error?: string; created_at: string; completed_at?: string };
type ElementPickMode = "target" | "presence" | "container" | "field" | "next";
type ElementPickState = { pickId: string; actionIndex: number; mode: ElementPickMode; fieldName?: string };
type ElementPickResult = { cancelled?: boolean; selector?: string; locator?: { role?: string; name?: string; text?: string }; label?: string; tag?: string; attribute?: string; pageUrl?: string };
type WorkflowContextMenu = { workflowId: string; x: number; y: number };
type RecordingReview = { active: ActiveAutomationRecording; captured: CapturedRun; reason: string; actionCount: number; missingAgentTrace: boolean; saveError?: string };
type AutomationShare = { id: string; source_kind: "recording" | "workflow"; source_id: string; title: string; sender_email?: string; recipient_email?: string; status: "pending" | "accepted" | "declined" | "revoked"; accepted_copy_id?: string; created_at: string; accepted_at?: string };
type ShareTarget = { kind: "recording" | "workflow"; id: string; title: string };

function validShareEmail(value: string): boolean {
  const normalized = value.trim();
  return normalized.length >= 3
    && normalized.length <= 320
    && !/[\s\r\n]/.test(normalized)
    && /^[^@]+@[^@]+$/.test(normalized);
}

const ACTION_OPTIONS = [
  ["navigate", "Open a web page"], ["open", "Open a URL"], ["input", "Enter text"], ["click", "Click something"],
  ["press", "Press a key"], ["select", "Choose an option"], ["wait", "Wait for page content"], ["scroll", "Scroll the page"],
  ["extract", "Collect data"], ["paginate_extract", "Collect data from pages"], ["form_fill", "Fill a form"],
  ["multi_action", "Grouped interactions"], ["act", "Recorded page interaction"], ["evaluate", "Collect with page script"], ["save_artifact", "Save to Artifact Center"],
] as const;
const DETERMINISTIC_ACTIONS = new Set(["navigate", "open", "input", "click", "press", "select", "wait", "scroll", "dismiss", "upload", "extract", "paginate_extract", "tabs_extract", "form_fill", "multi_action", "site_recipe_run", "act", "evaluate", "save_artifact"]);
const UNSAFE_WORKFLOW_EVALUATION = /(document\s*\.\s*cookie|localStorage|sessionStorage|indexedDB|caches\s*\.|navigator\s*\.\s*(clipboard|sendBeacon)|fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|\.\s*(click|submit|remove)\s*\(|\.\s*(innerHTML|outerHTML|textContent|innerText|value)\s*=|eval\s*\(|new\s+Function|location\s*=|window\s*\.\s*open)/i;
const SAME_PAGE_READONLY_FETCH = /fetch\s*\(\s*location\.href\s*(?:,\s*\{\s*cache\s*:\s*['"]no-store['"]\s*\})?\s*\)/gi;

function unsafeWorkflowEvaluation(expression: string) {
  return UNSAFE_WORKFLOW_EVALUATION.test(expression.replace(SAME_PAGE_READONLY_FETCH, "samePageReadOnlyRequest()"));
}

function isUnavailableRecordingSession(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:connection refused|session ["']?.+?["']? not found|state failed|list cdp targets|cdp became reachable|browser (?:is )?not running)/i.test(message);
}
function actionLabel(tool: string) {
  return ACTION_OPTIONS.find(([value]) => value === tool)?.[1] || `Advanced: ${tool}`;
}

function actionSummary(action: BrowserWorkflowAction) {
  const args = action.arguments;
  if (["navigate", "open"].includes(action.tool)) return String(args.url || "URL not set");
  if (action.tool === "input") return String(args.text || "Choose a target and text");
  if (action.tool === "press") return `Key: ${String(args.key || "Enter")}`;
  if (action.tool === "select") return `Option: ${String(args.value || "not set")}`;
  if (action.tool === "wait") return args.selector ? "Wait for selected content" : "Content not selected";
  if (["click", "act"].includes(action.tool)) return args.selector || args.locator ? "Page target selected" : "Page target not selected";
  if (["extract", "paginate_extract", "tabs_extract"].includes(action.tool)) {
    const fields = args.fields && typeof args.fields === "object" && !Array.isArray(args.fields) ? Object.keys(args.fields) : [];
    return fields.length ? `Collect ${fields.join(", ")}` : "Data fields not set";
  }
  if (action.tool === "save_artifact") return `${String(args.name || "workflow-result.json")} · ${args.source === "run_results" ? "all results" : args.source === "data_results" ? "collected data" : "previous result"}`;
  if (action.tool === "evaluate") return "Read structured data from the current page";
  return Object.keys(args).length ? `${Object.keys(args).length} configured option${Object.keys(args).length === 1 ? "" : "s"}` : "No options required";
}

function defaultActionArguments(tool: string): Record<string, unknown> {
  if (["navigate", "open"].includes(tool)) return { url: "https://example.com" };
  if (tool === "input") return { text: "" };
  if (tool === "press") return { key: "Enter" };
  if (tool === "select") return { value: "" };
  if (["extract", "paginate_extract"].includes(tool)) return { fields: {} };
  if (tool === "evaluate") return { expression: "" };
  if (tool === "save_artifact") return { source: "last_result", format: "json", name: "workflow-result.json" };
  return {};
}

function extractionFields(action: BrowserWorkflowAction): Record<string, Record<string, unknown>> {
  const fields = action.arguments.fields;
  return fields && typeof fields === "object" && !Array.isArray(fields) ? fields as Record<string, Record<string, unknown>> : {};
}

function isBuiltInArtifact(artifact: AutomationArtifact) {
  return artifact.name === "product-research-demo.csv" || artifact.name === "automation-run-demo.json";
}

function revealArtifactLabel() {
  const platform = `${navigator.userAgent} ${navigator.platform}`;
  if (/Windows|Win32|Win64/i.test(platform)) return "Show in File Explorer";
  if (/Macintosh|MacIntel|MacPPC|Mac68K/i.test(platform)) return "Show in Finder";
  return "Show in folder";
}

const SENSITIVE_WORKFLOW_KEY = /^(?:password|passwd|passcode|secret|token|access_token|refresh_token|api[_-]?key|authorization|cookie|card[_-]?(?:number|no)|cvv|cvc)$/i;
const WORKFLOW_TEMPLATE = /^\{\{[A-Za-z0-9_.-]+\}\}$/;

function containsStoredSecret(value: unknown, sensitiveContext = false): boolean {
  if (Array.isArray(value)) return value.some((item) => containsStoredSecret(item, sensitiveContext));
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  const context = sensitiveContext || Object.entries(source).some(([key, item]) =>
    ["selector", "label", "name", "placeholder", "type"].includes(key)
      && typeof item === "string"
      && /password|passcode|security code|credit.?card|card.?number|cvv|cvc|api.?key|auth(?:orization)? token/i.test(item),
  );
  return Object.entries(source).some(([key, item]) => {
    if (SENSITIVE_WORKFLOW_KEY.test(key) || (context && ["text", "value"].includes(key))) {
      if (typeof item !== "string" || !WORKFLOW_TEMPLATE.test(item.trim())) return true;
    }
    if (key === "url" && typeof item === "string") {
      try {
        const url = new URL(item);
        if (url.password) return true;
        for (const [queryKey, queryValue] of url.searchParams) {
          if (SENSITIVE_WORKFLOW_KEY.test(queryKey) && !WORKFLOW_TEMPLATE.test(queryValue.trim())) return true;
        }
      } catch { /* The URL validator returns the clearer error below. */ }
    }
    return containsStoredSecret(item, context);
  });
}

function unresolvedWorkflowTemplate(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.map(unresolvedWorkflowTemplate).find(Boolean);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).map(unresolvedWorkflowTemplate).find(Boolean);
  if (typeof value !== "string") return undefined;
  return value.match(/\{\{([A-Za-z0-9_.-]+)\}\}/)?.[1];
}

function workflowDraftError(workflow?: BrowserWorkflowSkill): string | undefined {
  if (!workflow) return undefined;
  if (!workflow.title.trim()) return "Give this workflow a name.";
  if (workflow.title.trim().length > 200) return "Workflow names can contain at most 200 characters.";
  const domain = workflow.domain.trim().toLowerCase();
  if (domain && (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain) || domain.includes("://"))) return "Website domain must look like example.com, without a protocol or path.";
  if (!workflow.task.trim()) return "Describe what this workflow should accomplish.";
  if (!workflow.actions.length) return "Add at least one browser step.";
  if (workflow.actions.length > 100) return "Split workflows longer than 100 steps into smaller workflows.";
  for (const [index, action] of workflow.actions.entries()) {
    if (!action.tool.trim()) return `Step ${index + 1} needs an action type.`;
    if (!DETERMINISTIC_ACTIONS.has(action.tool.replace(/^(?:clawbrowser|nextbrowser)\./, ""))) return `Step ${index + 1} uses an action that deterministic replay does not support.`;
    if (!action.arguments || typeof action.arguments !== "object" || Array.isArray(action.arguments)) return `Step ${index + 1} arguments must be a JSON object.`;
    if (["navigate", "open"].includes(action.tool)) {
      try {
        const url = new URL(String(action.arguments.url || ""));
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch { return `Step ${index + 1} needs a valid http:// or https:// URL.`; }
    }
    if (["click", "input", "select"].includes(action.tool) && !action.arguments.selector && !action.arguments.locator && action.arguments.element_id == null) return `Step ${index + 1} needs a saved target.`;
    if (["extract", "paginate_extract", "tabs_extract"].includes(action.tool) && (!action.arguments.container || !action.arguments.fields || Array.isArray(action.arguments.fields))) return `Step ${index + 1} needs a results container and named field locators.`;
    if (action.tool === "evaluate") {
      const expression = String(action.arguments.expression || "").trim();
      if (!expression || expression.length > 32 * 1024 || unsafeWorkflowEvaluation(expression)) return `Step ${index + 1} needs a safe read-only page data script.`;
    }
    if (action.tool === "paginate_extract" && !action.arguments.next_selector && action.arguments.scroll !== true) return `Step ${index + 1} needs a Next button selector or scrolling enabled.`;
    if (action.tool === "save_artifact") {
      if (!workflow.actions.slice(0, index).some((candidate) => candidate.tool !== "save_artifact")) return `Step ${index + 1} must come after the result you want to save.`;
      if (!["last_result", "data_results", "run_results"].includes(String(action.arguments.source || ""))) return `Step ${index + 1} needs a data source.`;
      if (!["json", "csv", "txt"].includes(String(action.arguments.format || ""))) return `Step ${index + 1} needs JSON, CSV, or text format.`;
      const name = String(action.arguments.name || "").trim();
      if (!name) return `Step ${index + 1} needs a file name.`;
      if (name.length > 180) return `Step ${index + 1} file name can contain at most 180 characters.`;
    }
    if (containsStoredSecret(action.arguments)) {
      return `Step ${index + 1} appears to contain credentials or payment data. Secrets cannot be stored in a workflow.`;
    }
    const missingInput = unresolvedWorkflowTemplate(action.arguments);
    if (missingInput) return `Step ${index + 1} still contains “{{${missingInput}}}”. Replace it with the value this workflow should replay.`;
  }
  return undefined;
}

export function AutomationStudio() {
  const s = useStore();
  const studioRef = useRef<HTMLDivElement>(null);
  const workflowContextMenuRef = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<StudioSection>("recorder");
  const [recordingSince, setRecordingSince] = useState(() => Number(localStorage.getItem("automationRecordingSince") || 0));
  const [recordingDestination, setRecordingDestination] = useState<"recording" | "workflow">(() => activeAutomationRecording()?.destination || "recording");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>();
  const [workflowListCollapsed, setWorkflowListCollapsed] = useState(false);
  const [draft, setDraft] = useState<BrowserWorkflowSkill>();
  const [actionErrors, setActionErrors] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [workflows, setWorkflows] = useState<BrowserWorkflowSkill[]>([]);
  const [recordings, setRecordings] = useState<BackendRecording[]>([]);
  const [backendRuns, setBackendRuns] = useState<BackendRun[]>([]);
  const [studioError, setStudioError] = useState<string>();
  const [artifacts, setArtifacts] = useState<AutomationArtifact[]>([]);
  const [artifactBusy, setArtifactBusy] = useState(false);
  const [artifactError, setArtifactError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [playback, setPlayback] = useState<AutomationExecution | undefined>(activeAutomationExecution);
  const [playbackClock, setPlaybackClock] = useState(Date.now());
  const [recordingStopping, setRecordingStopping] = useState(false);
  const [recordingReview, setRecordingReview] = useState<RecordingReview>();
  const [elementPick, setElementPick] = useState<ElementPickState>();
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [workflowContextMenu, setWorkflowContextMenu] = useState<WorkflowContextMenu>();
  const [workflowAiOpen, setWorkflowAiOpen] = useState(false);
  const [workflowAiRequest, setWorkflowAiRequest] = useState("");
  const [workflowAiBusy, setWorkflowAiBusy] = useState(false);
  const [incomingShares, setIncomingShares] = useState<AutomationShare[]>([]);
  const [sentShares, setSentShares] = useState<AutomationShare[]>([]);
  const [shareTarget, setShareTarget] = useState<ShareTarget>();
  const [shareEmail, setShareEmail] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const workspaceId = s.activeWorkspaceId || "";
  const activeWorkspace = s.workspaces.find((workspace) => workspace.id === workspaceId);
  const automationProfile = s.selectedProfile || (activeWorkspace?.profileNames.length === 1 ? activeWorkspace.profileNames[0] : undefined);
  const recordingAgentId = activeAutomationRecording()?.agentId;
  const runs = useMemo(() => recordingSince > 0 ? capturedRunsForRecording(s.conversations, {
    workspaceId, agentId: recordingAgentId, startedAt: recordingSince,
  }).slice(0, 12) : [], [s.conversations, workspaceId, recordingAgentId, recordingSince]);
  const recordedRun = runs[0];
  const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId);
  const workflowLibraryEmpty = workflows.length === 0 && !draft;
  const draftDirty = !!draft && !!selectedWorkflow && JSON.stringify(draft) !== JSON.stringify(selectedWorkflow);
  const draftValidationError = workflowDraftError(draft);
  const selectedRuns = backendRuns.filter((run) => run.workflow_id === selectedWorkflowId).slice(0, 5);
  const playbackView = useMemo(() => {
    if (!playback || playback.workspaceId !== workspaceId) return undefined;
    return automationExecutionView(playback, s.conversations, playbackClock);
  }, [playback, playbackClock, s.conversations, workspaceId]);
  const executionBusy = !!playback && !!playbackView && !["completed", "failed", "cancelled"].includes(playbackView.phase);

  useEffect(() => {
    if (studioRef.current) studioRef.current.scrollTop = 0;
  }, [section]);

  useEffect(() => () => {
    if (elementPick) void invoke("automation_element_pick_cancel", { pickId: elementPick.pickId }).catch(() => undefined);
  }, [elementPick?.pickId]);

  useEffect(() => {
    if (!workflowContextMenu) return;
    const closeOutside = (event: PointerEvent) => {
      if (!workflowContextMenuRef.current?.contains(event.target as Node)) setWorkflowContextMenu(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWorkflowContextMenu(undefined);
    };
    const close = () => setWorkflowContextMenu(undefined);
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [workflowContextMenu]);

  useEffect(() => {
    const sync = () => setPlayback(activeAutomationExecution());
    window.addEventListener(AUTOMATION_EXECUTION_EVENT, sync);
    return () => window.removeEventListener(AUTOMATION_EXECUTION_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!playback || ["completed", "failed", "cancelled"].includes(playbackView?.phase || "")) return;
    const timer = window.setInterval(() => setPlaybackClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [playback, playbackView?.phase]);

  useEffect(() => {
    if (!selectedWorkflowId && workflows[0]) setSelectedWorkflowId(workflows[0].id);
  }, [workflows, selectedWorkflowId]);

  useEffect(() => {
    const selected = workflows.find((skill) => skill.id === selectedWorkflowId);
    setDraft(selected ? structuredClone(selected) : undefined);
    setSelectedActionIndex(0);
    setActionErrors({});
  }, [selectedWorkflowId, workflows]);

  const loadWorkflows = async () => {
    try { setWorkflows(await invoke<BrowserWorkflowSkill[]>("automation_workflows_list")); }
    catch (error) { if (useStore.getState().authed) setStudioError(userFacingBrowserError(error)); }
  };

  const loadRuns = async () => {
    if (!workspaceId) return setBackendRuns([]);
    try { setBackendRuns(await invoke<BackendRun[]>("automation_runs_list", { workspaceId })); }
    catch (error) { if (useStore.getState().authed) setStudioError(userFacingBrowserError(error)); }
  };

  const loadRecordings = async () => {
    try {
      const items = await invoke<BackendRecording[]>("automation_recordings_list");
      const completed = items.filter((item) => !!item.document.run);
      const unfinished = items.filter((item) => !item.document.run);
      setRecordings(completed);
      if (unfinished.length) await Promise.allSettled(unfinished.map((item) => invoke("automation_recording_delete", { id: item.id })));
    }
    catch (error) { if (useStore.getState().authed) setStudioError(userFacingBrowserError(error)); }
  };

  const loadIncomingShares = async () => {
    try { setIncomingShares(await invoke<AutomationShare[]>("automation_shares_list", { box: "inbox" })); }
    catch (error) { setIncomingShares([]); if (useStore.getState().authed) setStudioError(userFacingBrowserError(error)); }
  };

  const loadSentShares = async () => {
    try { setSentShares(await invoke<AutomationShare[]>("automation_shares_list", { box: "sent" })); }
    catch (error) { setSentShares([]); if (useStore.getState().authed) setStudioError(userFacingBrowserError(error)); }
  };

  const sendShare = async () => {
    if (!shareTarget || !shareEmail.trim()) return;
    setStudioError(undefined);
    setShareBusy(true);
    try {
      await invoke("automation_share_create", { share: { source_kind: shareTarget.kind, source_id: shareTarget.id, recipient_email: shareEmail.trim() } });
      await loadSentShares();
      setShareTarget(undefined);
      setShareEmail("");
      setNotice("Shared. It will appear in Automation Studio when that email signs in.");
    } catch (error) { reportError(error); }
    finally { setShareBusy(false); }
  };

  const acceptShare = async (share: AutomationShare) => {
    setStudioError(undefined);
    setShareBusy(true);
    try {
      const accepted = await invoke<{ id: string; source_kind: "recording" | "workflow" }>("automation_share_accept", { id: share.id });
      await Promise.all([loadIncomingShares(), loadRecordings(), loadWorkflows()]);
      setSection(share.source_kind === "workflow" ? "workflows" : "recorder");
      if (accepted.source_kind === "workflow") setSelectedWorkflowId(accepted.id);
      setNotice(`${share.source_kind === "workflow" ? "Workflow" : "Recording"} added to your automation library as your own editable copy.`);
    } catch (error) { reportError(error); }
    finally { setShareBusy(false); }
  };

  const declineShare = async (share: AutomationShare) => {
    setStudioError(undefined);
    setShareBusy(true);
    try {
      await invoke("automation_share_decline", { id: share.id });
      await loadIncomingShares();
      setNotice("Shared copy declined.");
    } catch (error) { reportError(error); }
    finally { setShareBusy(false); }
  };

  const revokeShare = async (share: AutomationShare) => {
    setStudioError(undefined);
    setShareBusy(true);
    try {
      await invoke("automation_share_revoke", { id: share.id });
      await loadSentShares();
      setNotice("Pending shared copy revoked.");
    } catch (error) { reportError(error); }
    finally { setShareBusy(false); }
  };

  useEffect(() => {
    if (!s.authed) {
      // Signing out, or opening Automation Studio before an account is
      // connected, is a prerequisite state rather than a failed automation.
      // Never leave an old backend error visible in that state.
      setStudioError(undefined);
      setWorkflows([]);
      setRecordings([]);
      setIncomingShares([]);
      setSentShares([]);
      setBackendRuns([]);
      return;
    }
    let cancelled = false;
    const bootstrapAutomation = async () => {
      setStudioError(undefined);
      try {
        if (workspaceId) await invoke("automation_seed_examples", { workspaceId });
        if (cancelled) return;
        await Promise.all([
          loadWorkflows(),
          loadRecordings(),
          loadIncomingShares(),
          loadSentShares(),
          workspaceId ? loadRuns() : Promise.resolve(setBackendRuns([])),
          workspaceId ? loadArtifacts() : Promise.resolve(setArtifacts([])),
        ]);
      } catch (error) {
        if (!cancelled) setStudioError(userFacingBrowserError(error));
      }
    };
    void bootstrapAutomation();
    return () => { cancelled = true; };
  }, [s.authed, workspaceId]);

  useEffect(() => {
    if (!playbackView || !["completed", "failed", "cancelled"].includes(playbackView.phase)) return;
    const timer = window.setTimeout(() => void loadRuns(), 750);
    return () => window.clearTimeout(timer);
  }, [playbackView?.phase]);

  useEffect(() => {
    const syncRecording = () => {
      const active = activeAutomationRecording();
      setRecordingSince(active?.workspaceId === workspaceId ? active.startedAt : 0);
      setRecordingDestination(active?.workspaceId === workspaceId ? active.destination || "recording" : "recording");
      void loadRecordings();
    };
    const openRecorder = () => setSection("recorder");
    const openWorkflow = (event: Event) => {
      const workflowId = (event as CustomEvent<{ workflowId?: string }>).detail?.workflowId;
      setSection("workflows");
      if (workflowId) {
        setSelectedWorkflowId(workflowId);
        setWorkflowListCollapsed(true);
      }
      void loadWorkflows();
    };
    const openExecution = (event: Event) => setSection((event as CustomEvent<{ sourceKind?: "recording" | "workflow" }>).detail?.sourceKind === "workflow" ? "workflows" : "recorder");
    const refreshLibrary = (event: Event) => {
      const sourceKind = (event as CustomEvent<{ sourceKind?: "recording" | "workflow" }>).detail?.sourceKind;
      if (sourceKind === "workflow") void loadWorkflows();
      else void loadRecordings();
      void loadArtifacts();
    };
    syncRecording();
    window.addEventListener(AUTOMATION_RECORDING_EVENT, syncRecording);
    window.addEventListener("nextbrowser:open-recorder", openRecorder);
    window.addEventListener("nextbrowser:open-workflow", openWorkflow);
    window.addEventListener("nextbrowser:open-automation-execution", openExecution);
    window.addEventListener("nextbrowser:automation-library-change", refreshLibrary);
    return () => {
      window.removeEventListener(AUTOMATION_RECORDING_EVENT, syncRecording);
      window.removeEventListener("nextbrowser:open-recorder", openRecorder);
      window.removeEventListener("nextbrowser:open-workflow", openWorkflow);
      window.removeEventListener("nextbrowser:open-automation-execution", openExecution);
      window.removeEventListener("nextbrowser:automation-library-change", refreshLibrary);
    };
  }, [workspaceId]);

  const loadArtifacts = async () => {
    setArtifactBusy(true);
    setArtifactError(undefined);
    try {
      setArtifacts(await invoke<AutomationArtifact[]>("artifact_list", { workspaceId }));
    } catch (error) {
      setArtifactError(error instanceof Error ? error.message : String(error));
    } finally {
      setArtifactBusy(false);
    }
  };

  useEffect(() => {
    if (section === "artifacts" && workspaceId) void loadArtifacts();
  }, [section, workspaceId]);
  useEffect(() => {
    if (section !== "artifacts" || !workspaceId) return;
    const refreshAfterExternalChanges = () => void loadArtifacts();
    window.addEventListener("focus", refreshAfterExternalChanges);
    return () => window.removeEventListener("focus", refreshAfterExternalChanges);
  }, [section, workspaceId]);

  const reportError = (error: unknown) => {
    console.error("[AUTOMATION_STUDIO_FAILED]", error);
    setStudioError(userFacingBrowserError(error));
    setNotice(undefined);
  };

  const startRecording = async (destination: "recording" | "workflow" = "recording", source: "hybrid" | "agent" = "hybrid") => {
    if (!s.authed) return setNotice("Connect your NextBrowser account before recording browser actions.");
    if (!workspaceId) return setStudioError("Create or select a workspace before recording.");
    try {
      const existing = activeAutomationRecording();
      if (existing?.phase === "recording") {
        if (existing.workspaceId !== workspaceId) return setStudioError("Stop the recording in the other workspace before starting a new one.");
        return;
      }
      const startedAt = Date.now();
      const id = uid();
      let recordingProfile: string | undefined;
      let recordingRuntime: string | undefined;
      if (source === "hybrid") {
        const workspaceProfiles = s.workspaces.find((workspace) => workspace.id === workspaceId)?.profileNames ?? [];
        if (!s.selectedProfile && workspaceProfiles.length > 1) {
          return setStudioError("Choose the browser profile you want to record before starting.");
        }
        recordingProfile = s.selectedProfile || (workspaceProfiles.length === 1 ? workspaceProfiles[0] : undefined);
        recordingRuntime = selectedBrowserRuntime(recordingProfile);
        const browserRunning = recordingProfile
          ? s.statuses[recordingProfile] === "running"
          : s.defaultSession?.status === "running";
        const armRecorder = (attach: boolean) => invoke("automation_page_recording_start", {
          recordingId: id,
          profile: recordingProfile,
          runtime: recordingRuntime,
          attach,
        });
        try {
          await armRecorder(browserRunning);
        } catch (error) {
          // A user can close the browser window while its state file still says
          // "running". Recover that exact profile once and arm the recorder
          // again instead of exposing CDP/connection-refused internals.
          if (!browserRunning || !isUnavailableRecordingSession(error)) throw error;
          if (recordingProfile) await s.startProfile(recordingProfile);
          else await s.startDefaultSession();
          await armRecorder(true);
        }
      }
      setActiveAutomationRecording({ id, workspaceId, agentId: s.agentId, startedAt, phase: "recording", destination, source, profile: recordingProfile, runtime: recordingRuntime });
      setRecordingSince(startedAt);
      setRecordingDestination(destination);
      setStudioError(undefined);
      if (s.terminalChat) s.setTerminalChat(false);
      s.setTab("chat");
      await invoke("app_focus");
    } catch (error) { reportError(error); }
  };

  useEffect(() => {
    const active = activeAutomationRecording();
    if (!active || active.phase !== "recording" || !["manual", "hybrid"].includes(active.source || "agent")) return;
    const browserRunning = active.profile
      ? s.statuses[active.profile] === "running"
      : s.defaultSession?.status === "running";
    if (!browserRunning) return;
    void invoke("automation_page_recording_attach", { recordingId: active.id }).catch((error) => {
      console.warn("[AUTOMATION_RECORDER_ATTACH_FAILED]", error);
    });
  }, [recordingSince, s.selectedProfile, s.statuses, s.defaultSession?.status]);

  const stopRecording = async () => {
    const active = activeAutomationRecording();
    if (!active || active.phase !== "recording" || active.workspaceId !== workspaceId || recordingStopping) return;
    setRecordingStopping(true);
    let capturedForRetry: CapturedRun | undefined;
    try {
      // Read the store at the moment Stop is pressed. A just-finished agent
      // response may not yet be present in this render's memoized `runs`.
      let conversations = useStore.getState().conversations;
      let agentCaptured = capturedTaskRunsForRecording(conversations, active)[0];
      // The answer text and its final `done` status arrive in adjacent store
      // updates. A user naturally presses Stop as soon as the answer appears.
      // Give that final status a short bounded window to settle so the run is
      // not discarded while the UI already looks complete.
      for (let attempt = 0; !agentCaptured && hasPendingTaskRunForRecording(conversations, active) && attempt < 20; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        conversations = useStore.getState().conversations;
        agentCaptured = capturedTaskRunsForRecording(conversations, active)[0];
      }
      const captured = ["manual", "hybrid"].includes(active.source || "agent")
        ? capturedRunFromHybridRecording(active.id, await invoke<ManualBrowserRecording>("automation_page_recording_stop", { recordingId: active.id }), agentCaptured)
        : agentCaptured;
      capturedForRetry = captured;
      if (captured) {
        const domain = capturedWorkflowDomain(captured.task, captured.evidence);
        const quality = workflowQuality(captured.task, captured.evidence, domain);
        const actionCount = recordedBrowserActions(captured.evidence).length;
        const missingAgentTrace = !!agentCaptured && !/(?:clawbrowser|nextbrowser)\.[a-z_]+\s*\(/i.test(agentCaptured.evidence);
        clearActiveAutomationRecording();
        setRecordingSince(0);
        setRecordingDestination("recording");
        if (!quality.reusable) {
          setRecordingReview({ active, captured, reason: quality.reason, actionCount, missingAgentTrace });
          return;
        }
        await saveCompletedRecording(active, captured);
      } else {
        clearActiveAutomationRecording();
        setRecordingSince(0);
        setRecordingDestination("recording");
        setNotice("Recording stopped. The incomplete attempt was discarded.");
      }
      await loadRecordings();
    } catch (error) {
      reportError(error);
      // Once the page recorder has returned its capture, it is already stopped.
      // Keep the captured actions available for an explicit save retry instead
      // of restoring a recording banner that can no longer be stopped again.
      if (capturedForRetry) {
        clearActiveAutomationRecording();
        setRecordingSince(0);
        setRecordingDestination("recording");
        const domain = capturedWorkflowDomain(capturedForRetry.task, capturedForRetry.evidence);
        const quality = workflowQuality(capturedForRetry.task, capturedForRetry.evidence, domain);
        setRecordingReview({
          active,
          captured: capturedForRetry,
          reason: quality.reason,
          actionCount: recordedBrowserActions(capturedForRetry.evidence).length,
          missingAgentTrace: false,
          saveError: userFacingBrowserError(error),
        });
      }
    }
    finally { setRecordingStopping(false); }
  };

  const saveCompletedRecording = async (active: ActiveAutomationRecording, captured: CapturedRun) => {
        await invoke("automation_recording_put", { recording: { id: active.id, status: "completed", document: { run: captured }, base_revision: 0 } });
        let savedWorkflow: BrowserWorkflowSkill | undefined;
        if (active.destination === "workflow") {
          const domain = capturedWorkflowDomain(captured.task, captured.evidence);
          const quality = workflowQuality(captured.task, captured.evidence, domain);
          if (quality.reusable) {
            savedWorkflow = await invoke<BrowserWorkflowSkill>("automation_workflow_put", { workflow: skillFromRun(captured) });
          }
        }
        clearActiveAutomationRecording();
        setRecordingSince(0);
        setRecordingDestination("recording");
        if (savedWorkflow) {
          await loadWorkflows();
          setSelectedWorkflowId(savedWorkflow.id);
          setWorkflowListCollapsed(true);
          setSection("workflows");
          setNotice(savedWorkflow.actions.some((action) => action.tool === "save_artifact")
            ? "Workflow created with a local Artifact Center output. Review the file name and format before running."
            : "Recording stopped. Your new workflow is open and ready to review.");
        } else if (active.destination === "workflow") {
          setSection("recorder");
          setNotice("Recording saved, but its browser steps were not reusable enough to create a workflow. Review the recording below.");
        } else {
          setNotice("Recording stopped and saved. Review it below or turn it into a workflow.");
        }
  };

  const saveRecordingReview = async () => {
    if (!recordingReview) return;
    setRecordingStopping(true);
    try {
      await saveCompletedRecording(recordingReview.active, recordingReview.captured);
      setRecordingReview(undefined);
      await loadRecordings();
    } catch (error) {
      reportError(error);
      setRecordingReview((current) => current ? { ...current, saveError: userFacingBrowserError(error) } : current);
    }
    finally { setRecordingStopping(false); }
  };

  useEffect(() => {
    const requestedStop = () => {
      const active = activeAutomationRecording();
      const requestedId = sessionStorage.getItem("nextbrowser:automation-stop-request");
      if (!active || requestedId !== active.id) return;
      sessionStorage.removeItem("nextbrowser:automation-stop-request");
      void stopRecording();
    };
    requestedStop();
    window.addEventListener("nextbrowser:request-stop-recording", requestedStop);
    return () => window.removeEventListener("nextbrowser:request-stop-recording", requestedStop);
  }, [workspaceId, recordingStopping]);

  const recordingModeLabel = recordingDestination === "workflow" ? "Workflow capture mode" : "Manual browser recording";
  const recordingModeButtonLabel = recordingDestination === "workflow" ? "Stop & open workflow" : "Stop recording";

  const saveCapture = async (run: CapturedRun) => {
    try {
      const saved = await invoke<BrowserWorkflowSkill>("automation_workflow_put", { workflow: skillFromRun(run) });
      clearActiveAutomationRecording();
      setRecordingSince(0);
      await loadWorkflows();
      setSelectedWorkflowId(saved.id);
      setWorkflowListCollapsed(true);
      setSection("workflows");
      setNotice("Recording saved as a reusable workflow.");
    } catch (error) { reportError(error); }
  };

  const updateAction = (index: number, field: "tool" | "arguments", value: string) => {
    if (!draft) return;
    const actions = [...draft.actions];
    if (field === "tool") {
      const tool = value.replace(/^(?:clawbrowser|nextbrowser)\./, "");
      actions[index] = { tool, arguments: defaultActionArguments(tool) };
      setActionErrors((current) => { const next = { ...current }; delete next[index]; return next; });
    }
    else {
      try {
        const args = JSON.parse(value) as Record<string, unknown>;
        actions[index] = { ...actions[index], arguments: args };
        setActionErrors((current) => { const next = { ...current }; delete next[index]; return next; });
      } catch {
        setActionErrors((current) => ({ ...current, [index]: "Arguments must be a valid JSON object." }));
        return;
      }
    }
    setDraft({ ...draft, actions, recipe: { ...draft.recipe, actions } });
  };

  const updateActionArgument = (index: number, key: string, value: unknown) => {
    if (!draft) return;
    const actions = [...draft.actions];
    const arguments_ = { ...actions[index].arguments };
    if (value === "" || value === undefined) delete arguments_[key]; else arguments_[key] = value;
    actions[index] = { ...actions[index], arguments: arguments_ };
    setActionErrors((current) => { const next = { ...current }; delete next[index]; return next; });
    setDraft({ ...draft, actions, recipe: { ...draft.recipe, actions } });
  };

  const updateExtractionResultCount = (index: number, rawValue: string) => {
    if (!draft) return;
    const count = Math.max(1, Math.min(1_000, Number.parseInt(rawValue, 10) || 1));
    const previousCount = Number(draft.actions[index].arguments.required_rows || draft.actions[index].arguments.limit || 10);
    const replaceTopCount = (value: string) => value.replace(
      new RegExp(`(\\btop[\\s_-]+)${previousCount}\\b`, "gi"),
      `$1${count}`,
    );
    const actions = [...draft.actions];
    const arguments_ = { ...actions[index].arguments, limit: count, required_rows: count };
    actions[index] = { ...actions[index], arguments: arguments_ };
    for (let actionIndex = index + 1; actionIndex < actions.length; actionIndex += 1) {
      if (actions[actionIndex].tool !== "save_artifact") continue;
      const artifactArguments = { ...actions[actionIndex].arguments };
      if (typeof artifactArguments.name === "string") artifactArguments.name = replaceTopCount(artifactArguments.name);
      const contract = artifactArguments.contract;
      if (contract && typeof contract === "object" && !Array.isArray(contract) && (contract as Record<string, unknown>).kind === "rows") {
        artifactArguments.contract = { ...(contract as Record<string, unknown>), min_rows: count };
      }
      actions[actionIndex] = { ...actions[actionIndex], arguments: artifactArguments };
    }
    setActionErrors((current) => { const next = { ...current }; delete next[index]; return next; });
    setDraft({
      ...draft,
      title: replaceTopCount(draft.title),
      task: replaceTopCount(draft.task),
      instructions: replaceTopCount(draft.instructions),
      actions,
      recipe: { ...draft.recipe, actions },
    });
  };

  const updateArtifactFormat = (index: number, format: string) => {
    if (!draft) return;
    const actions = [...draft.actions];
    const current = String(actions[index].arguments.name || "workflow-result.json");
    const name = `${current.replace(/\.(?:json|csv|txt)$/i, "")}.${format}`;
    actions[index] = { ...actions[index], arguments: { ...actions[index].arguments, format, name } };
    setActionErrors((errors) => { const next = { ...errors }; delete next[index]; return next; });
    setDraft({ ...draft, actions, recipe: { ...draft.recipe, actions } });
  };

  const actionTarget = (action: BrowserWorkflowAction) => {
    if (typeof action.arguments.selector === "string") return `css=${action.arguments.selector}`;
    const locator = action.arguments.locator;
    if (!locator || typeof locator !== "object" || Array.isArray(locator)) return "";
    const value = locator as Record<string, unknown>;
    return String(value.name || value.text || (value.css ? `css=${value.css}` : ""));
  };

  const updateExtractionFields = (index: number, names: string[]) => {
    if (!draft) return;
    const current = draft.actions[index].arguments.fields;
    const specs = current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : {};
    updateActionArgument(index, "fields", Object.fromEntries(names.map((name) => [name, specs[name] && typeof specs[name] === "object" ? specs[name] : { selector: "" }])));
  };

  const previewUrl = () => {
    const step = draft?.actions.find((action) => ["navigate", "open"].includes(action.tool));
    const url = typeof step?.arguments.url === "string" ? step.arguments.url.trim() : "";
    try { return ["http:", "https:"].includes(new URL(url).protocol) ? url : undefined; }
    catch { return undefined; }
  };

  const selectedBrowserRuntime = (profile = s.selectedProfile) => {
    if (!profile) return "clawbrowser";
    for (const workspace of s.workspaces) {
      if (workspace.profileNames.includes(profile)) return workspace.profileToolsets[profile] || "clawbrowser";
    }
    return "clawbrowser";
  };

  const pickElement = async (actionIndex: number, mode: ElementPickMode, fieldName?: string) => {
    if (!draft || elementPick) return;
    const pickId = uid();
    const pickerMode: ElementPickMode = mode === "target" && draft.actions[actionIndex]?.tool === "wait" ? "presence" : mode;
    const state = { pickId, actionIndex, mode: pickerMode, fieldName };
    setElementPick(state);
    setStudioError(undefined);
    setNotice("The workflow page is opening. Click the highlighted element in the browser, or press Esc to cancel.");
    try {
      const action = draft.actions[actionIndex];
      const result = await invoke<ElementPickResult>("automation_element_pick", {
        pickId,
        mode: pickerMode,
        fieldName,
        container: mode === "field" ? action.arguments.container : undefined,
        openUrl: previewUrl(),
        profile: s.selectedProfile,
        runtime: selectedBrowserRuntime(),
      });
      if (result.cancelled) return setNotice("Element selection cancelled. No workflow step was changed.");
      if (!result.selector) throw new Error("The selected element did not produce a reusable locator.");
      if (mode === "target") {
        const actions = [...draft.actions];
        const arguments_ = { ...actions[actionIndex].arguments };
        delete arguments_.selector;
        delete arguments_.locator;
        if (["wait", "act"].includes(actions[actionIndex].tool)) arguments_.selector = result.selector;
        else if (result.locator?.name || result.locator?.text) arguments_.locator = result.locator;
        else arguments_.selector = result.selector;
        actions[actionIndex] = { ...actions[actionIndex], arguments: arguments_ };
        setDraft({ ...draft, actions, recipe: { ...draft.recipe, actions } });
      } else if (mode === "container") {
        updateActionArgument(actionIndex, "container", result.selector);
      } else if (mode === "next") {
        updateActionArgument(actionIndex, "next_selector", result.selector);
      } else if (fieldName) {
        const current = action.arguments.fields;
        const fields = current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, Record<string, unknown>> : {};
        updateActionArgument(actionIndex, "fields", {
          ...fields,
          [fieldName]: { ...(fields[fieldName] || {}), selector: result.selector, ...(result.attribute ? { attribute: result.attribute } : {}) },
        });
      }
      setNotice(`Selected “${result.label || result.tag || "page element"}”. The locator was saved automatically.`);
    } catch (error) {
      reportError(error);
    } finally {
      setElementPick(undefined);
    }
  };

  const cancelElementPick = async () => {
    if (!elementPick) return;
    await invoke("automation_element_pick_cancel", { pickId: elementPick.pickId }).catch(() => undefined);
  };

  const targetSummary = (action: BrowserWorkflowAction) => {
    const locator = action.arguments.locator;
    if (locator && typeof locator === "object" && !Array.isArray(locator)) {
      const value = locator as Record<string, unknown>;
      const name = String(value.name || value.text || "").trim();
      if (name) return `${value.role ? `${value.role}: ` : ""}${name}`;
    }
    return action.arguments.selector ? "Selected page element" : "No element selected";
  };

  const moveAction = (index: number, direction: -1 | 1) => {
    if (!draft) return;
    const target = index + direction;
    if (target < 0 || target >= draft.actions.length) return;
    const actions = [...draft.actions];
    [actions[index], actions[target]] = [actions[target], actions[index]];
    setActionErrors({});
    setSelectedActionIndex(target);
    setDraft({ ...draft, actions, recipe: { ...draft.recipe, actions } });
  };

  const removeAction = (index: number) => {
    if (!draft) return;
    const actions = draft.actions.filter((_, candidate) => candidate !== index);
    setActionErrors({});
    setSelectedActionIndex(Math.max(0, Math.min(index, actions.length - 1)));
    setDraft({ ...draft, actions, recipe: { ...draft.recipe, actions } });
  };

  const addAction = (afterIndex = (draft?.actions.length || 0) - 1) => {
    if (!draft) return;
    const action: BrowserWorkflowAction = { tool: "navigate", arguments: { url: draft.domain ? `https://${draft.domain}` : "https://example.com" } };
    const insertAt = Math.max(0, Math.min(afterIndex + 1, draft.actions.length));
    const actions = [...draft.actions.slice(0, insertAt), action, ...draft.actions.slice(insertAt)];
    setActionErrors({});
    setSelectedActionIndex(insertAt);
    setDraft({ ...draft, actions, recipe: { ...draft.recipe, actions } });
  };

  const saveDraft = async (): Promise<BrowserWorkflowSkill | undefined> => {
    if (!draft || draftValidationError || Object.keys(actionErrors).length) return undefined;
    setSaving(true);
    try {
      const saved = await invoke<BrowserWorkflowSkill>("automation_workflow_put", { workflow: { ...draft, recipe: { ...draft.recipe, actions: draft.actions } } });
      setWorkflows((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current]);
      setDraft(saved);
      setStudioError(undefined);
      setNotice("Workflow saved.");
      return saved;
    } catch (error) { reportError(error); }
    finally { setSaving(false); }
    return undefined;
  };

  const editWorkflowWithAi = async () => {
    if (!draft || workflowAiBusy || !workflowAiRequest.trim()) return;
    if (!s.agentReady()) return setStudioError("Connect an agent before editing a workflow with AI.");
    setWorkflowAiBusy(true);
    setStudioError(undefined);
    setNotice(undefined);
    try {
      const agent = agentById(s.agentId);
      const prompt = workflowAiEditPrompt(draft, workflowAiRequest);
      const invocation = agentInvocation(agent, prompt);
      const { args, stdinText } = agent.id === "codex"
        ? { args: ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "-"], stdinText: prompt }
        : agent.id === "claude"
          ? { args: ["-p", "--permission-mode", "dontAsk", "--tools", "", prompt], stdinText: null }
          : { args: invocation.args, stdinText: invocation.stdin ?? null };
      const result = await invoke<{ code: number; stdout: string; stderr: string }>("workflow_author_run", {
        binary: agent.binary, envVar: agent.envVar, args, stdinText, workingDir: s.workingDir || null,
      });
      if (result.code !== 0) throw new Error(result.stderr || `${agent.name} could not edit this workflow.`);
      const edit = parseWorkflowAiEdit(result.stdout);
      if (!edit) throw new Error("The agent did not return a complete workflow recipe. Your current workflow was not changed.");
      const candidate: BrowserWorkflowSkill = {
        ...draft,
        title: edit.title,
        domain: edit.domain,
        task: edit.task,
        capability: edit.capability,
        actions: edit.actions,
        recipe: { version: 1, capability: edit.capability, actions: edit.actions },
      };
      const validationError = workflowDraftError(candidate);
      if (validationError) throw new Error(`AI change was not applied: ${validationError}`);
      const changedIndex = candidate.actions.findIndex((action, index) => JSON.stringify(action) !== JSON.stringify(draft.actions[index]));
      setDraft(candidate);
      setActionErrors({});
      setSelectedActionIndex(Math.max(0, changedIndex));
      setWorkflowAiRequest("");
      setWorkflowAiOpen(false);
      setNotice(`${edit.summary} Review the updated steps, then Save or Save & run.`);
    } catch (error) { reportError(error); }
    finally { setWorkflowAiBusy(false); }
  };

  const createWorkflow = async () => {
    if (draftDirty && !window.confirm("Discard unsaved workflow changes and create a new workflow?")) return;
    setStudioError(undefined);
    const createdAt = Date.now();
    const action: BrowserWorkflowAction = { tool: "navigate", arguments: { url: "https://example.com" } };
    const workflow: BrowserWorkflowSkill = {
      id: uid(), title: "New browser workflow", domain: "", task: "Describe what this workflow should accomplish.",
      instructions: "Follow the structured recipe. If the page changed, inspect it and adapt selectors before continuing.",
      actions: [action], capability: "other",
      parametersSchema: { type: "object", properties: { task: { type: "string" } } },
      outputSchema: { type: "object", properties: { success: { type: "boolean" }, results: { type: "array" } } },
      recipe: { version: 1, capability: "other", actions: [action] }, createdAt, updatedAt: createdAt,
    };
    try {
      const saved = await invoke<BrowserWorkflowSkill>("automation_workflow_put", { workflow });
      setWorkflows((current) => [saved, ...current]);
      setSelectedWorkflowId(saved.id);
      setWorkflowListCollapsed(true);
      setNotice("Workflow created. Edit its task and steps, then save it.");
    } catch (error) { reportError(error); }
  };

  const deleteWorkflow = async (workflow: BrowserWorkflowSkill) => {
    if (!window.confirm(`Delete “${workflow.title}”?`)) return;
    setStudioError(undefined);
    try {
      await invoke("automation_workflow_delete", { id: workflow.id });
      setWorkflows((current) => current.filter((item) => item.id !== workflow.id));
      if (selectedWorkflowId === workflow.id) {
        setSelectedWorkflowId(undefined);
        setWorkflowListCollapsed(false);
      }
      setNotice("Workflow deleted.");
    } catch (error) { reportError(error); }
  };

  const duplicateWorkflow = async (workflow: BrowserWorkflowSkill) => {
    const now = Date.now();
    setStudioError(undefined);
    try {
      const copy = await invoke<BrowserWorkflowSkill>("automation_workflow_put", { workflow: { ...structuredClone(workflow), id: uid(), title: `${workflow.title} copy`, revision: 0, createdAt: now, updatedAt: now, recipe: { ...workflow.recipe, example_key: undefined, example_version: undefined, demo_key: undefined, demo_version: undefined } } });
      setWorkflows((current) => [copy, ...current]);
      setSelectedWorkflowId(copy.id);
      setWorkflowListCollapsed(true);
      setNotice("Workflow duplicated. Edit the copy without changing the original.");
    } catch (error) { reportError(error); }
  };

  const selectWorkflow = (id: string) => {
    if (draftDirty && !window.confirm("Discard unsaved workflow changes?")) return;
    setSelectedWorkflowId(id);
    setWorkflowListCollapsed(true);
  };

  const openWorkflowContextMenu = (event: React.MouseEvent, workflowId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 180;
    const menuHeight = 86;
    setWorkflowContextMenu({
      workflowId,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
    });
  };

  const executeRecipe = async (workflow: BrowserWorkflowSkill, sourceKind: "recording" | "workflow", sourceId: string) => {
    if (executionBusy) return setStudioError(`“${playback?.workflowTitle || "Another workflow"}” is already running. Stop it before starting another automation.`);
    const workspaceProfiles = activeWorkspace?.profileNames ?? [];
    if (!s.selectedProfile && workspaceProfiles.length > 1) return setStudioError("Choose the browser profile that should run this automation.");
    if (playback) clearActiveAutomationExecution();
    const runId = sourceKind === "workflow" ? uid() : undefined;
    const next: AutomationExecution = { executionId: uid(), sourceId, sourceKind, backendRunId: runId, workspaceId, workflowTitle: workflow.title, task: workflow.task, startedAt: Date.now(), expectedActions: workflow.actions.length, actionTools: workflow.actions.map((action) => action.tool), engine: "deterministic", phase: "preparing", completedActions: 0, progress: 8, detail: "Preparing the browser session…", workflowSnapshot: workflow };
    if (!workflow.actions.some((action) => ["open", "navigate"].includes(action.tool.replace(/^(?:clawbrowser|nextbrowser)\./, "")))) {
      const failed: AutomationExecution = { ...next, backendRunId: undefined, phase: "failed", progress: 100, failedStep: 0, detail: "The saved automation has no starting page.", error: "The saved automation has no starting page. Add an open step before replay." };
      setPlayback(failed);
      setActiveAutomationExecution(failed);
      if (s.agentReady()) {
        setNotice("AI is adding the missing starting page before this automation runs…");
        await repairWithAgent(failed, true);
      } else setStudioError("Add an Open page step before running this automation.");
      return;
    }
    try {
      if (runId) {
        await invoke("automation_run_create", { run: { id: runId, workspace_id: workspaceId, workflow_id: workflow.id, input: { task: workflow.task, engine: "deterministic" } } });
        await invoke("automation_run_update", { id: runId, update: { status: "running", output: { engine: "deterministic" } } });
      }
      setPlayback(next);
      setActiveAutomationExecution(next);
      setNotice(`${sourceKind === "workflow" ? "Workflow" : "Recording"} is running. Progress and Stop remain visible in the main menu.`);
      setStudioError(undefined);
      const result = await s.runAutomationRecipe(workflow, next.executionId, { task: workflow.task, ...(runId ? { backendRunId: runId } : {}) });
      const completedActions = result.results.filter((step) => step.ok).length;
      const displayError = result.error ? userFacingBrowserError(result.error) : undefined;
      const detail = result.status === "completed"
        ? `Completed all ${workflow.actions.length} saved browser steps.`
        : result.status === "cancelled" ? "Execution stopped by user."
          : `Step ${(result.failedStep ?? completedActions) + 1} failed: ${displayError || "The saved browser action could not be completed."}`;
      const progress = result.status === "completed" ? 100 : Math.max(12, Math.round(completedActions / Math.max(1, workflow.actions.length) * 100));
      const finished: AutomationExecution = { ...next, phase: result.status, completedActions, progress, detail, error: displayError, failedStep: result.failedStep };
      setPlayback(finished);
      setActiveAutomationExecution(finished);
      setNotice(undefined);
      if (runId) await invoke("automation_run_update", { id: runId, update: { status: result.status, output: { engine: "deterministic", steps: result.results.map(({ index, tool, ok, error }) => ({ index, tool, ok, error })), detail } } });
      await Promise.all([loadRuns(), loadArtifacts()]);
      if (result.status === "completed") setNotice("Replay completed successfully.");
      else if (result.status === "failed") {
        const failedTool = workflow.actions[result.failedStep ?? completedActions]?.tool;
        if (s.agentReady() && shouldAutoRepairAutomation(failedTool, result.error)) {
          setNotice("The page changed. AI is repairing the failed step automatically…");
          await repairWithAgent(finished, true);
        } else setStudioError("A saved browser step failed. Inspect the step or retry the run.");
      }
    } catch (error) {
      const technicalMessage = error instanceof Error ? error.message : String(error);
      console.error("[AUTOMATION_EXECUTION_FAILED]", error);
      const message = userFacingBrowserError(error);
      const failed: AutomationExecution = { ...next, phase: "failed", progress: 8, detail: message, error: message };
      setPlayback(failed);
      setActiveAutomationExecution(failed);
      setNotice(undefined);
      if (runId) await invoke("automation_run_update", { id: runId, update: { status: "failed", output: { engine: "deterministic", error: technicalMessage } } }).catch(() => undefined);
      setStudioError("The deterministic browser runner could not complete this automation. You can retry or use Repair & run with AI.");
    }
  };

  const runWorkflow = async (workflow: BrowserWorkflowSkill) => executeRecipe(workflow, "workflow", workflow.id);

  const runDraft = async () => {
    if (!draft || draftValidationError || Object.keys(actionErrors).length || executionBusy || saving) return;
    const workflow = draftDirty ? await saveDraft() : draft;
    if (workflow) await runWorkflow(workflow);
  };

  const replayRecording = async (run: CapturedRun) => {
    const workflow = skillFromRun(run);
    await executeRecipe(workflow, "recording", run.id);
  };

  const repairWithAgent = async (failedExecution = playback, automatic = false) => {
    if (!failedExecution || failedExecution.phase !== "failed") return;
    if (!s.agentReady()) return setStudioError("Connect an agent to repair this failed automation.");
    const workflow = failedExecution.workflowSnapshot || (failedExecution.sourceKind === "workflow"
      ? workflows.find((item) => item.id === failedExecution.sourceId)
      : recordings.map((item) => item.document.run).filter((run): run is CapturedRun => !!run).find((run) => run.id === failedExecution.sourceId));
    const repairWorkflow = workflow && "recipe" in workflow ? workflow : workflow ? skillFromRun(workflow) : undefined;
    if (!repairWorkflow) return setStudioError("The source automation is no longer available.");
    const expectedArtifactName = [...repairWorkflow.actions].reverse().find((action) => action.tool === "save_artifact")?.arguments.name;
    const agentExecution: AutomationExecution = { ...failedExecution, executionId: uid(), engine: "agent", phase: "preparing", startedAt: Date.now(), progress: undefined, completedActions: undefined, detail: automatic ? "The saved page step changed. Starting automatic AI repair…" : "Preparing AI-assisted repair…", error: undefined, failedStep: undefined, autoRepairAttempted: true, expectedArtifactName: typeof expectedArtifactName === "string" ? expectedArtifactName : undefined, outputValidated: undefined, outputValidationError: undefined, repairValidationRequired: true, repairPersisted: undefined, repairPersistenceError: undefined };
    setPlayback(agentExecution);
    setActiveAutomationExecution(agentExecution);
    try {
      const repairTask = automationRepairTask(repairWorkflow.task, repairWorkflow.actions, failedExecution.failedStep, failedExecution.error || failedExecution.detail || "unknown browser error");
      const replyId = await s.runLocalSkill(repairWorkflow, repairTask);
      if (!replyId) throw new Error("The AI repair run could not be started.");
      const running = { ...agentExecution, replyId, phase: "running" as const };
      setPlayback(running);
      setActiveAutomationExecution(running);
    } catch (error) {
      console.error("[AUTOMATION_REPAIR_FAILED]", error);
      const message = userFacingBrowserError(error);
      const originalFailure = failedExecution.error || failedExecution.detail;
      const detail = originalFailure
        ? `Automatic repair could not start. Original failure: ${originalFailure} Repair error: ${message}`
        : message;
      const failed = { ...agentExecution, phase: "failed" as const, progress: 100, detail, error: detail };
      setPlayback(failed);
      setActiveAutomationExecution(failed);
      setStudioError(automatic ? detail : message);
    }
  };

  const stopExecution = async () => {
    if (!playback || ["completed", "failed", "cancelled", "stopping"].includes(playback.phase)) return;
    const stopping: AutomationExecution = { ...playback, phase: "stopping", detail: "Stopping execution…" };
    setPlayback(stopping);
    setActiveAutomationExecution(stopping);
    if (stopping.engine === "deterministic") {
      await invoke("automation_recipe_cancel", { executionId: stopping.executionId }).catch(reportError);
      const cancelled: AutomationExecution = { ...stopping, phase: "cancelled", detail: "Execution stopped by user." };
      setPlayback(cancelled);
      setActiveAutomationExecution(cancelled);
      return;
    }
    if (stopping.replyId && s.cancelQueuedReply(stopping.replyId)) return clearActiveAutomationExecution();
    if (stopping.replyId) s.stopReply(stopping.replyId);
    else s.stopRunning();
  };

  const importArtifacts = async () => {
    setArtifactBusy(true);
    setArtifactError(undefined);
    try { setArtifacts(await invoke<AutomationArtifact[]>("artifact_import", { workspaceId })); }
    catch (error) { setArtifactError(error instanceof Error ? error.message : String(error)); }
    finally { setArtifactBusy(false); }
  };

  const openArtifact = async (artifact: AutomationArtifact) => {
    try { await invoke("artifact_open", { workspaceId, id: artifact.id }); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/artifact (?:file was removed|no longer exists)/i.test(message)) {
        await loadArtifacts();
        setArtifactError(`${artifact.name} was deleted outside NextBrowser and has been removed from this list.`);
      } else setArtifactError(message);
    }
  };

  const revealArtifact = async (artifact: AutomationArtifact) => {
    try { await invoke("artifact_reveal", { workspaceId, id: artifact.id }); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/artifact (?:file was removed|no longer exists)/i.test(message)) {
        await loadArtifacts();
        setArtifactError(`${artifact.name} was deleted outside NextBrowser and has been removed from this list.`);
      } else setArtifactError(message);
    }
  };

  const deleteArtifact = async (artifact: AutomationArtifact) => {
    if (!window.confirm(`Delete ${artifact.name} from local storage on this computer?`)) return;
    try { await invoke("artifact_delete", { workspaceId, id: artifact.id }); await loadArtifacts(); }
    catch (error) { setArtifactError(error instanceof Error ? error.message : String(error)); }
  };

  const deleteRecording = async (recording: BackendRecording) => {
    if (!window.confirm("Delete this recording? This cannot be undone.")) return;
    try {
      await invoke("automation_recording_delete", { id: recording.id });
      if (activeAutomationRecording()?.id === recording.id) clearActiveAutomationRecording();
      if (playback?.sourceId === recording.document.run?.id) {
        setPlayback(undefined);
        clearActiveAutomationExecution();
      }
      setRecordings((current) => current.filter((item) => item.id !== recording.id));
      setNotice("Recording deleted.");
    } catch (error) { reportError(error); }
  };

  return (
    <div ref={studioRef} className="automation-studio page">
      <header className="automation-hero">
        <div><span className="eyebrow">Automation Studio</span><h1>Record, build, and collect</h1><p>Keep recordings and workflows in your automation library. Run outputs stay local to the active workspace.</p></div>
        <div className="automation-summary"><strong>{recordings.length}</strong><span>recordings</span><strong>{workflows.length}</strong><span>workflows</span><strong>{artifacts.length}</strong><span>artifacts</span></div>
      </header>
      <div className="automation-sections" role="tablist">
        {(["recorder", "workflows", "artifacts"] as StudioSection[]).map((item) => (
          <button key={item} className={section === item ? "active" : ""} onClick={() => setSection(item)}>
            <Icon name={item === "recorder" ? "play.rectangle.on.rectangle.fill" : item === "workflows" ? "arrow.triangle.branch" : "tray.full.fill"} size={15} />
            {item === "recorder" ? "Recorder" : item === "workflows" ? "Workflow Builder" : "Artifact Center"}
          </button>
        ))}
      </div>
      <div className="automation-how-it-works" aria-label="Automation workflow">
        {section === "recorder" && <><strong>Record a task you can perform once</strong><span><b>1</b> Start recording</span><i>→</i><span><b>2</b> Use the browser normally</span><i>→</i><span><b>3</b> Stop, review, and replay</span></>}
        {section === "workflows" && <><strong>Build an editable, predictable automation</strong><span><b>1</b> Capture a task or create manually</span><i>→</i><span><b>2</b> Review each step and select page targets</span><i>→</i><span><b>3</b> Save &amp; run</span></>}
        {section === "artifacts" && <><strong>Keep automation files on this computer</strong><span><b>1</b> Add files</span><i>→</i><span><b>2</b> Open them from this workspace</span><i>→</i><span><b>3</b> Delete them when no longer needed</span></>}
      </div>
      {studioError && <div className="error automation-global-message" role="alert"><strong>Automation couldn’t complete the action.</strong><span>{studioError}</span><button onClick={() => setStudioError(undefined)}>Dismiss</button></div>}
      {notice && <div className="automation-global-message success" role="status"><span>{notice}</span><button onClick={() => setNotice(undefined)}>Dismiss</button></div>}
      {incomingShares.length > 0 && <section className="automation-share-inbox" aria-label="Shared with me"><div><Icon name="person.2.fill" size={15} /><span><strong>Shared with you</strong><small>{incomingShares.length} automation {incomingShares.length === 1 ? "copy is" : "copies are"} ready to add to your library.</small></span></div><div className="automation-share-inbox-items">{incomingShares.map((share) => <article key={share.id}><span><strong>{share.title}</strong><small>{share.source_kind === "workflow" ? "Workflow" : "Recording"}{share.sender_email ? ` · from ${share.sender_email}` : ""}</small></span><div className="automation-inline-actions"><button className="secondary" disabled={shareBusy} onClick={() => void declineShare(share)}>Decline</button><button className="secondary" disabled={shareBusy} onClick={() => void acceptShare(share)}>Add to my automations</button></div></article>)}</div></section>}
      {sentShares.length > 0 && <section className="automation-share-inbox automation-share-sent" aria-label="Shared by me"><div><Icon name="paperplane.fill" size={15} /><span><strong>Shared by you</strong><small>Track copies sent to other NextBrowser users.</small></span></div><div className="automation-share-inbox-items">{sentShares.map((share) => <article key={share.id}><span><strong>{share.title}</strong><small>{share.source_kind === "workflow" ? "Workflow" : "Recording"}{share.recipient_email ? ` · to ${share.recipient_email}` : ""}</small></span><div className="automation-inline-actions"><span className={`automation-share-status ${share.status}`}>{share.status === "pending" ? "Waiting" : share.status === "accepted" ? "Added" : "Declined"}</span>{share.status === "pending" && <button className="secondary" disabled={shareBusy} onClick={() => void revokeShare(share)}>Revoke</button>}</div></article>)}</div></section>}
      {playback && playbackView && <div className={`recording-progress-card ${playbackView.phase}`} role="status"><div className="recording-progress-head"><span><Icon name={playbackView.phase === "completed" ? "checkmark.circle.fill" : ["failed", "cancelled"].includes(playbackView.phase) ? "xmark.circle.fill" : playbackView.phase === "stopping" ? "stop.fill" : "play.fill"} size={14} /><strong>{playbackView.phase === "completed" ? "Execution completed" : playbackView.phase === "cancelled" ? "Execution stopped" : playbackView.phase === "failed" ? "Execution failed" : playbackView.phase === "stopping" ? "Stopping execution" : playback.engine === "agent" ? "AI is repairing the workflow" : playbackView.phase === "preparing" ? "Preparing execution" : "Running saved steps"}</strong></span><b>{playbackView.progress}%</b></div><div className="recording-progress-track"><i style={{ width: `${playbackView.progress}%` }} /></div><small>{playbackView.detail}</small><div className="row">{["completed", "failed", "cancelled"].includes(playbackView.phase) ? <button onClick={() => { setPlayback(undefined); clearActiveAutomationExecution(); }}>Dismiss</button> : <button className="secondary danger-text" disabled={playbackView.phase === "stopping"} onClick={() => void stopExecution()}><Icon name="stop.fill" size={12} /> {playbackView.phase === "stopping" ? "Stopping…" : "Stop"}</button>}</div></div>}

      {section === "recorder" && <section className="automation-panel">
        <div className="automation-panel-head"><div><h2>Recordings</h2><p>Perform a task in the browser once, then replay the captured actions.</p></div>
          <div className="row">{recordingSince > 0 ? <button className="secondary danger-text" disabled={recordingStopping} onClick={() => void stopRecording()}>{recordingStopping ? <Spinner size={12} /> : <Icon name="stop.fill" size={12} />} {recordingModeButtonLabel}</button> : <button className="primary" disabled={!s.authed} title={!s.authed ? "Connect your NextBrowser account to record browser actions." : undefined} onClick={() => void startRecording()}><Icon name="circle.fill" size={12} /> {s.authed ? "Start recording" : "Connect account to record"}</button>}</div>
        </div>
        {recordingSince > 0 && <div className="recording-banner"><span className="recording-dot" /><span className="recording-banner-copy">{["manual", "hybrid"].includes(activeAutomationRecording()?.source || "agent") ? `Recording your actions and agent browser actions in ${activeAutomationRecording()?.profile || "the default browser"}. Press Stop when finished.` : recordedRun ? "Browser task captured — press Stop to save it." : `Recording is armed in ${recordingModeLabel}. Complete one browser task in Project Chat, then press Stop.`}</span>{["manual", "hybrid"].includes(activeAutomationRecording()?.source || "agent") && <span className="recording-banner-actions"><button className="secondary" onClick={() => s.setTab("live")}><Icon name="play.rectangle.on.rectangle.fill" size={12} /> Open browser</button><button className="secondary" onClick={() => { if (s.terminalChat) s.setTerminalChat(false); s.setTab("chat"); }}><Icon name="bubble.left.and.bubble.right.fill" size={12} /> Open Project Chat</button></span>}</div>}
        <div className="capture-list">
          {recordings.map((recording) => {
            const run = recording.document.run!;
            const domain = capturedWorkflowDomain(run.task, run.evidence);
            const quality = workflowQuality(run.task, run.evidence, domain);
            const canRepairMissingStart = !quality.reusable && /starting page/i.test(quality.reason) && s.agentReady();
            const actions = recordedBrowserActions(run.evidence);
            const createdAt = recording.created_at ? Date.parse(recording.created_at) : run.answer.createdAt;
            return <article className={"capture-card" + (recordedRun?.id === run.id ? " is-new" : "")} key={run.id}>
              <div className="capture-kind"><span className="ready">COMPLETED RECORDING</span><small>{recording.status === "completed" ? "Completed" : recording.status}</small></div>
              <div className="capture-card-copy">
                <strong>{run.task.slice(0, 160)}</strong>
                <span>{run.conversationTitle} · {domain || "Unknown website"} · {actions.length} recorded action{actions.length === 1 ? "" : "s"}</span>
                <time className="capture-created-at" dateTime={new Date(createdAt).toISOString()}>Recorded {new Date(createdAt).toLocaleString()}</time>
                {run.captureSource === "structured-recipe" && <small>Captured from the workflow recipe used by the agent; raw Codex tool events were not available.</small>}
                <small className={quality.reusable ? "ok" : "muted"}><strong>{quality.reusable ? "Reusable" : "Not reusable"}:</strong> {quality.reason}</small>
                <details className="capture-steps"><summary>Show recorded steps</summary><ol>{actions.map((action, index) => <li key={`${index}-${action.tool}`}><b>{actionLabel(action.tool)}</b><code>{JSON.stringify(action.arguments)}</code></li>)}</ol></details>
              </div>
              <div className="capture-card-actions">{playback?.sourceId === run.id && playbackView && !["completed", "failed", "cancelled"].includes(playbackView.phase) ? <div className="capture-running"><Spinner size={13} /><span>{playbackView.phase === "preparing" ? "Preparing…" : playbackView.phase === "stopping" ? "Stopping…" : `${playbackView.progress}% running`}</span></div> : <button className="secondary" disabled={(!quality.reusable && !canRepairMissingStart) || executionBusy} title={executionBusy ? "Stop the running automation first" : canRepairMissingStart ? "Add the missing starting page with AI, then run" : "Run recording"} onClick={() => void replayRecording(run)}><Icon name={canRepairMissingStart ? "sparkles" : "play.fill"} size={12} /> {canRepairMissingStart ? "Repair & run" : "Run again"}</button>}<button className="btn-bordered-prominent" disabled={!quality.reusable} onClick={() => void saveCapture(run)}>Turn into workflow</button><button className="mini" title="Share a safe copy" onClick={() => setShareTarget({ kind: "recording", id: recording.id, title: run.task })}><Icon name="square.and.arrow.up" size={12} /> Share</button><button className="mini danger-text" title="Delete recording" onClick={() => void deleteRecording(recording)}><Icon name="trash" size={12} /> Delete</button></div>
            </article>;
          })}
          {!recordings.length && <div className="automation-empty"><Icon name="play.rectangle.on.rectangle.fill" size={28} /><strong>No recordings yet</strong><span>Record and stop a successful browser task to save it here.</span></div>}
        </div>
      </section>}

      {section === "workflows" && <section className={`automation-panel workflow-builder${workflowListCollapsed ? " workflow-list-collapsed" : ""}${workflowLibraryEmpty ? " workflow-builder-empty" : ""}`}>
        <header className="workflow-builder-start"><div><h2>Workflow Builder</h2><p>Edit and replay reliable browser steps.</p></div>{recordingSince > 0 && recordingDestination === "workflow" ? <div className="row"><button className="secondary danger-text" disabled={recordingStopping} onClick={() => void stopRecording()}>{recordingStopping ? <Spinner size={12} /> : <Icon name="stop.fill" size={12} />} Stop &amp; open workflow</button></div> : !workflowLibraryEmpty ? <div className="row"><button className="secondary" title="You can ask the agent: Save the result as products.csv in Artifact Center" onClick={() => void startRecording("workflow", "hybrid")}><Icon name="circle.fill" size={12} /> Capture from Project Chat</button><button className="secondary" onClick={() => void createWorkflow()}><Icon name="plus" size={12} /> New workflow</button></div> : null}</header>
        {workflowLibraryEmpty && <div className="workflow-first-run">
          <span className="workflow-first-run-icon"><Icon name="arrow.triangle.branch" size={22} /></span>
          <div className="workflow-first-run-copy"><h3>Create your first workflow</h3><p>Capture a browser task you already know works, or assemble the steps yourself.</p></div>
          <div className="workflow-first-run-actions">
            <button className="workflow-first-run-choice primary-choice" onClick={() => void startRecording("workflow", "hybrid")}><span><Icon name="sparkles" size={16} /></span><strong>Capture from Project Chat</strong><small>Ask the agent to complete a task, then edit the recorded steps.</small></button>
            <button className="workflow-first-run-choice" onClick={() => void createWorkflow()}><span><Icon name="plus" size={16} /></span><strong>Build manually</strong><small>Start with an empty workflow and add visual blocks.</small></button>
          </div>
        </div>}
        <aside className="workflow-list" aria-hidden={workflowListCollapsed}><div className="workflow-list-title"><span>Workflows</span><div className="workflow-list-controls"><button className="mini" title="Create workflow" aria-label="Create workflow" onClick={() => void createWorkflow()}><Icon name="plus" size={12} /></button><button className="mini" title="Collapse workflow list" aria-label="Collapse workflow list" onClick={() => setWorkflowListCollapsed(true)}><Icon name="chevron.left" size={12} /></button></div></div>{workflows.map((skill) => {
            const running = playback?.sourceKind === "workflow" && playback?.sourceId === skill.id && playbackView && !["completed", "failed", "cancelled"].includes(playbackView.phase);
            return <button key={skill.id} className={skill.id === selectedWorkflowId ? "active" : ""} onClick={() => selectWorkflow(skill.id)} onContextMenu={(event) => openWorkflowContextMenu(event, skill.id)}>
              <Icon name={running ? "play.fill" : "arrow.triangle.branch"} size={14} />
              <span><strong>{skill.title}</strong><small>{skill.actions.length} steps · {skill.domain || "Any site"}</small>{running ? <span className="workflow-run-live-tag"> Running now</span> : null}</span>
            </button>;
          })}{!workflows.length && <p className="muted small">Record a run or create a workflow from a task.</p>}</aside>
        {workflowContextMenu && (() => {
          const workflow = workflows.find((item) => item.id === workflowContextMenu.workflowId);
          if (!workflow) return null;
          const actionWorkflow = draft?.id === workflow.id ? draft : workflow;
          return <div ref={workflowContextMenuRef} className="workflow-context-menu" role="menu" aria-label={`Actions for ${workflow.title}`} style={{ left: workflowContextMenu.x, top: workflowContextMenu.y }} onContextMenu={(event) => event.preventDefault()}>
            <button role="menuitem" onClick={() => { setWorkflowContextMenu(undefined); setShareTarget({ kind: "workflow", id: workflow.id, title: workflow.title }); }}>Share workflow</button>
            <button role="menuitem" onClick={() => { setWorkflowContextMenu(undefined); void duplicateWorkflow(actionWorkflow); }}>Duplicate workflow</button>
            <button role="menuitem" className="danger-text" onClick={() => { setWorkflowContextMenu(undefined); void deleteWorkflow(workflow); }}>Delete workflow</button>
          </div>;
        })()}
        <div className={`workflow-canvas${workflowListCollapsed ? " has-collapsed-list" : ""}`}>{workflowListCollapsed && <button className="workflow-list-restore" aria-expanded={false} aria-label="Open workflow sidebar" title="Open workflow sidebar" onClick={() => setWorkflowListCollapsed(false)}><Icon name="sidebar.leading" size={13} /><span>Workflows</span><Icon name="chevron.right" size={11} /></button>}{draft ? <>
          <div className="workflow-editor-head"><div><input className="workflow-title-input" aria-label="Workflow name" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /><div className="workflow-editor-meta"><label className="workflow-domain-field"><Icon name="globe" size={13} /><span>Domain</span><input className="workflow-domain-input" aria-label="Website domain" value={draft.domain} placeholder="example.com" onChange={(event) => setDraft({ ...draft, domain: event.target.value })} /></label><span className="workflow-runtime-chip"><Icon name="play.rectangle.on.rectangle.fill" size={12} /> {automationProfile || "Default browser"}</span>{draftDirty ? <small className="workflow-unsaved">Unsaved</small> : <small className="workflow-saved"><Icon name="checkmark" size={10} /> Saved</small>}</div></div><div className="row workflow-editor-actions"><button className="secondary workflow-ai-toggle" aria-expanded={workflowAiOpen} disabled={workflowAiBusy} onClick={() => setWorkflowAiOpen((open) => !open)}><Icon name="sparkles" size={12} /> Edit with AI</button>{draftDirty && <button className="secondary workflow-save-button" disabled={saving || !!draftValidationError || !!Object.keys(actionErrors).length} title="Save changes without running" onClick={() => void saveDraft()}>Save</button>}<button className="primary" disabled={saving || executionBusy || !!draftValidationError || !!Object.keys(actionErrors).length} title={draftValidationError || (executionBusy ? "Stop the running automation first" : draftDirty ? "Save changes and run this workflow" : "Run workflow")} onClick={() => void runDraft()}>{saving && <Spinner size={12} />} {draftDirty ? "Save & run" : "Run"}</button><details className="workflow-more-menu"><summary aria-label="More workflow actions" title="More workflow actions"><Icon name="ellipsis.circle" size={16} /></summary><div><button onClick={() => setShareTarget({ kind: "workflow", id: draft.id, title: draft.title })}>Share workflow</button><button onClick={() => void duplicateWorkflow(draft)}>Duplicate workflow</button><button className="danger-text" onClick={() => void deleteWorkflow(draft)}>Delete workflow</button></div></details></div></div>
          {elementPick && <div className="workflow-picker-banner" role="status"><Spinner size={13} /><span><strong>Selecting an element for step {elementPick.actionIndex + 1}</strong><small>Click the highlighted element in the browser. Press Esc there to cancel.</small></span><button className="secondary" onClick={() => void cancelElementPick()}>Cancel</button></div>}
          {draftValidationError && <div className="error automation-inline-error" role="alert">{draftValidationError}</div>}
          {workflowAiOpen && <section className="workflow-ai-editor" aria-label="Edit workflow with AI">
            <div className="workflow-ai-editor-copy"><span className="workflow-goal-icon"><Icon name="sparkles" size={14} /></span><span><strong>Describe the change</strong><small>AI updates the blocks for you. The saved workflow still replays deterministically.</small></span></div>
            <textarea rows={3} autoFocus value={workflowAiRequest} placeholder="For example: Change the result limit from 5 to 10, then save it as research-results.json." onChange={(event) => setWorkflowAiRequest(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void editWorkflowWithAi(); }} />
            <div className="workflow-ai-editor-actions"><button className="secondary" disabled={workflowAiBusy} onClick={() => { setWorkflowAiOpen(false); setWorkflowAiRequest(""); }}>Cancel</button><button className="primary" disabled={workflowAiBusy || !workflowAiRequest.trim()} onClick={() => void editWorkflowWithAi()}>{workflowAiBusy ? <Spinner size={12} /> : <Icon name="sparkles" size={12} />} Update steps</button></div>
          </section>}
          <label className="workflow-goal-field">
            <span className="workflow-goal-heading">
              <span className="workflow-goal-icon"><Icon name="sparkles" size={14} /></span>
              <span><strong>What should this workflow accomplish?</strong><small>Describe the result you expect in plain language.</small></span>
            </span>
            <textarea
              rows={3}
              value={draft.task}
              placeholder="For example: Open the orders page, find pending orders, and export them as CSV."
              onChange={(event) => setDraft({ ...draft, task: event.target.value })}
            />
          </label>
          <div className="workflow-pipeline-layout">
            <section className="workflow-pipeline" aria-label="Workflow diagram">
              <div className="workflow-pipeline-head"><strong>Steps</strong><span>{selectedActionIndex + 1} of {draft.actions.length}</span><div><button className="mini" aria-label="Previous step" title="Previous step" disabled={selectedActionIndex === 0} onClick={() => setSelectedActionIndex((index) => Math.max(0, index - 1))}><Icon name="chevron.left" size={11} /></button><button className="mini" aria-label="Next step" title="Next step" disabled={selectedActionIndex >= draft.actions.length - 1} onClick={() => setSelectedActionIndex((index) => Math.min(draft.actions.length - 1, index + 1))}><Icon name="chevron.right" size={11} /></button></div></div>
              <div className="workflow-flow-terminal start"><span className="workflow-flow-status"><Icon name="play.fill" size={11} /></span><span><small>START</small><strong>Workflow triggered</strong><em>{draft.domain || "Any website"}</em></span></div>
              <div className="workflow-flow-connector"><i /><button className="workflow-flow-add" title="Add first step" aria-label="Add first step" onClick={() => addAction(-1)}><Icon name="plus" size={11} /></button><i /></div>
              {draft.actions.map((action, index) => {
                const isRunningThisWorkflow = playback?.sourceKind === "workflow" && playback.sourceId === draft.id && playbackView && !["completed", "failed", "cancelled"].includes(playbackView.phase);
                const completed = isRunningThisWorkflow && index < (playback.completedActions || 0);
                const current = isRunningThisWorkflow && index === (playback.completedActions || 0);
                const failed = playback?.sourceKind === "workflow" && playback.sourceId === draft.id && playbackView?.phase === "failed" && playback.failedStep === index;
                return <div className="workflow-flow-item" key={`${index}-${action.tool}`}>
                  <button type="button" className={`workflow-flow-node${selectedActionIndex === index ? " selected" : ""}${completed ? " completed" : ""}${current ? " running" : ""}${failed ? " failed" : ""}`} onClick={() => setSelectedActionIndex(index)} aria-pressed={selectedActionIndex === index}>
                    <span className="workflow-flow-number">{completed ? "✓" : index + 1}</span>
                    <span className="workflow-flow-copy"><small>STEP {index + 1}</small><strong>{actionLabel(action.tool)}</strong><em>{actionSummary(action)}</em></span>
                    <span className="workflow-flow-state">{current ? <Spinner size={13} /> : <Icon name="chevron.right" size={12} />}</span>
                  </button>
                  <div className="workflow-flow-connector"><i /><button className="workflow-flow-add" title={`Add step after step ${index + 1}`} aria-label={`Add step after step ${index + 1}`} onClick={() => addAction(index)}><Icon name="plus" size={11} /></button><i /></div>
                </div>;
              })}
              <div className="workflow-flow-terminal done"><span className="workflow-flow-status">✓</span><span><small>DONE</small><strong>Workflow complete</strong><em>{draft.actions.length} browser step{draft.actions.length === 1 ? "" : "s"}</em></span></div>
            </section>
            <aside className="workflow-step-inspector">
              {draft.actions[selectedActionIndex] ? (() => {
                const action = draft.actions[selectedActionIndex];
                const index = selectedActionIndex;
                return <>
                  <header><div><small>STEP {index + 1} OF {draft.actions.length}</small><h3>{actionLabel(action.tool)}</h3></div><div className="workflow-step-actions"><button className="mini" title="Move up" disabled={index === 0} onClick={() => moveAction(index, -1)}>↑</button><button className="mini" title="Move down" disabled={index === draft.actions.length - 1} onClick={() => moveAction(index, 1)}>↓</button><button className="mini danger-text" title="Delete step" onClick={() => removeAction(index)}><Icon name="trash" size={12} /></button></div></header>
                  <div className="workflow-step-body"><label>Action<select value={ACTION_OPTIONS.some(([value]) => value === action.tool) ? action.tool : "advanced"} aria-label={`Step ${index + 1} action`} onChange={(event) => { if (event.target.value !== "advanced") updateAction(index, "tool", event.target.value); }}><option value="advanced">{actionLabel(action.tool)}</option>{ACTION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    {["navigate", "open"].includes(action.tool) && <label>Page URL<input value={String(action.arguments.url || "")} placeholder="https://example.com/products" onChange={(event) => updateActionArgument(index, "url", event.target.value)} /></label>}
                    {["input", "click"].includes(action.tool) && <label>Target on the page<div className="workflow-visual-target"><span className={actionTarget(action) ? "selected" : ""}>{targetSummary(action)}</span><button type="button" className="secondary" disabled={!!elementPick} onClick={() => void pickElement(index, "target")}><Icon name="cursorarrow" size={12} /> {actionTarget(action) ? "Select again" : "Select on page"}</button></div></label>}
                    {action.tool === "input" && <label>Text to enter<input value={String(action.arguments.text || "")} placeholder="Search phrase or {{input}}" onChange={(event) => updateActionArgument(index, "text", event.target.value)} /></label>}
                    {action.tool === "press" && <label>Key<input value={String(action.arguments.key || "Enter")} placeholder="Enter" onChange={(event) => updateActionArgument(index, "key", event.target.value)} /></label>}
                    {action.tool === "select" && <><label>Target on the page<div className="workflow-visual-target"><span className={actionTarget(action) ? "selected" : ""}>{targetSummary(action)}</span><button type="button" className="secondary" disabled={!!elementPick} onClick={() => void pickElement(index, "target")}><Icon name="cursorarrow" size={12} /> {actionTarget(action) ? "Select again" : "Select on page"}</button></div></label><label>Option value<input value={String(action.arguments.value || "")} onChange={(event) => updateActionArgument(index, "value", event.target.value)} /></label></>}
                    {action.tool === "wait" && <label>Content that means the page is ready<div className="workflow-visual-target"><span className={action.arguments.selector ? "selected" : ""}>{action.arguments.selector ? "Selected page content" : "No content selected"}</span><button type="button" className="secondary" disabled={!!elementPick} onClick={() => void pickElement(index, "target")}><Icon name="cursorarrow" size={12} /> {action.arguments.selector ? "Select again" : "Select on page"}</button></div></label>}
                    {action.tool === "act" && <><label>Interaction<input value={String(action.arguments.action || "click")} placeholder="click, type, or press" onChange={(event) => updateActionArgument(index, "action", event.target.value)} /></label><label>Target on the page <small>Optional</small><div className="workflow-visual-target"><span className={action.arguments.selector ? "selected" : ""}>{action.arguments.selector ? "Selected page element" : "No element selected"}</span><button type="button" className="secondary" disabled={!!elementPick} onClick={() => void pickElement(index, "target")}><Icon name="cursorarrow" size={12} /> {action.arguments.selector ? "Select again" : "Select on page"}</button></div></label>{action.arguments.action === "type" && <label>Text to enter<input value={String(action.arguments.text || "")} onChange={(event) => updateActionArgument(index, "text", event.target.value)} /></label>}</>}
                    {["extract", "paginate_extract"].includes(action.tool) && <><label>One repeated result row<div className="workflow-visual-target"><span className={action.arguments.container ? "selected" : ""}>{action.arguments.container ? "Result row selected" : "Select one card, row, or search result"}</span><button type="button" className="secondary" disabled={!!elementPick} onClick={() => void pickElement(index, "container")}><Icon name="cursorarrow" size={12} /> {action.arguments.container ? "Select again" : "Select row on page"}</button></div></label><label>Results required <small>The run fails instead of saving a partial file</small><input type="number" min={1} max={1000} value={Number(action.arguments.required_rows || action.arguments.limit || 10)} onChange={(event) => updateExtractionResultCount(index, event.target.value)} /></label><label>Data fields <small>Name what you want to collect</small><input value={Object.keys(extractionFields(action)).join(", ")} placeholder="title, price, url" onChange={(event) => updateExtractionFields(index, event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} /></label>{Object.entries(extractionFields(action)).map(([name, spec]) => <label key={name}>{name}<div className="workflow-visual-target"><span className={spec.selector ? "selected" : ""}>{spec.selector ? `${name} selected${spec.attribute ? ` · ${String(spec.attribute)}` : ""}` : `Select ${name} inside the result row`}</span><button type="button" className="secondary" disabled={!!elementPick || !action.arguments.container} title={!action.arguments.container ? "Select the repeated result row first" : `Select ${name} on page`} onClick={() => void pickElement(index, "field", name)}><Icon name="cursorarrow" size={12} /> {spec.selector ? "Select again" : "Select on page"}</button></div></label>)}{action.tool === "paginate_extract" && <><label>Next page button<div className="workflow-visual-target"><span className={action.arguments.next_selector ? "selected" : ""}>{action.arguments.next_selector ? "Next button selected" : "No Next button selected"}</span><button type="button" className="secondary" disabled={!!elementPick} onClick={() => void pickElement(index, "next")}><Icon name="cursorarrow" size={12} /> {action.arguments.next_selector ? "Select again" : "Select on page"}</button></div></label><label className="workflow-checkbox"><input type="checkbox" checked={action.arguments.scroll === true} onChange={(event) => updateActionArgument(index, "scroll", event.target.checked || undefined)} /> Use infinite scrolling instead</label></>}</>}
                    {action.tool === "evaluate" && <label>Read-only page data script <small>Captured from the successful run. Use Edit with AI to change what it collects.</small><textarea className="workflow-page-script" rows={8} value={String(action.arguments.expression || "")} spellCheck={false} onChange={(event) => updateActionArgument(index, "expression", event.target.value)} /></label>}
                    {action.tool === "save_artifact" && <div className="workflow-artifact-step"><label>What to save<select value={String(action.arguments.source || "last_result")} onChange={(event) => updateActionArgument(index, "source", event.target.value)}><option value="last_result">Previous step result</option><option value="data_results">Collected data only</option><option value="run_results">All workflow results</option></select></label><label>File format<select value={String(action.arguments.format || "json")} onChange={(event) => updateArtifactFormat(index, event.target.value)}><option value="json">JSON</option><option value="csv">CSV table</option><option value="txt">Plain text</option></select></label><label>File name<input maxLength={180} value={String(action.arguments.name || "")} placeholder="workflow-result.json" onChange={(event) => updateActionArgument(index, "name", event.target.value)} /></label><div className="artifact-local-note"><Icon name="info.circle" size={13} /><span>Created after every successful run and stored only on this computer. Open it later in Artifact Center.</span></div></div>}
                    <details><summary>Advanced JSON</summary><textarea key={JSON.stringify(action.arguments)} defaultValue={JSON.stringify(action.arguments, null, 2)} aria-label={`Step ${index + 1} arguments`} onBlur={(event) => updateAction(index, "arguments", event.target.value)} /></details>{actionErrors[index] && <small className="error">{actionErrors[index]}</small>}
                  </div>
                </>;
              })() : <div className="automation-empty"><strong>No steps yet</strong><span>Use a + button in the diagram to add the first browser step.</span></div>}
            </aside>
          </div>
          <label className="field-label">AI repair instructions <small>Used automatically once when a saved page step can no longer find or read its target.</small><textarea rows={6} value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} /></label>
          <section className="workflow-run-history"><div><strong>Recent runs</strong><button className="mini" onClick={() => void loadRuns()}>Refresh</button></div>{selectedRuns.length ? <ul>{selectedRuns.map((run) => <li key={run.id}><span className={`run-status ${run.status}`}>{run.status}</span><span>Version {run.workflow_version}</span><time>{new Date(run.created_at).toLocaleString()}</time>{run.error && <small>{run.error}</small>}</li>)}</ul> : <p className="muted small">No runs yet. Run this workflow to create backend history.</p>}</section>
        </> : <div className="automation-empty"><Icon name="arrow.triangle.branch" size={28} /><strong>Select or record a workflow</strong></div>}</div>
      </section>}

      {section === "artifacts" && <section className="automation-panel">
        <div className="automation-panel-head"><div><h2>Artifact Center</h2><p>Up to 1 GiB per file. Stored only on this computer. Workflows can save results here automatically.</p></div><button className="primary" disabled={artifactBusy} onClick={() => void importArtifacts()}>{artifactBusy ? <Spinner size={13} /> : <Icon name="plus" size={13} />} Add files</button></div>
        <div className="artifact-local-note"><Icon name="info.circle" size={14} /><span><strong>Local storage.</strong> Files remain on this computer until you delete them. They are not uploaded or synced to other devices.</span></div>
        {artifactError && <div className="error automation-inline-error">{artifactError}</div>}
        <div className="automation-management-note"><Icon name="info.circle" size={13} /><span>Local files can be opened or deleted at any time. Built-in examples stay available for new users.</span></div>
        <div className="artifact-grid">{artifacts.map((artifact) => { const builtIn = isBuiltInArtifact(artifact); return <article className="artifact-card" key={artifact.id}><div className="artifact-icon"><Icon name="doc" size={22} /></div><div className="artifact-copy"><strong title={artifact.name}>{artifact.name}</strong>{builtIn && <small className="artifact-example-label">Built-in example</small>}<span>{artifact.extension.toUpperCase() || "FILE"} · {humanBytes(artifact.size)}</span><small>Added {new Date(artifact.createdAt).toLocaleString()} · Local only</small></div><div className="artifact-actions"><button className="secondary" title="Reveal this file without opening it" onClick={() => void revealArtifact(artifact)}><Icon name="folder" size={12} /> {revealArtifactLabel()}</button><button className="secondary" onClick={() => void openArtifact(artifact)}>Open</button>{!builtIn && <button className="mini danger-text" onClick={() => void deleteArtifact(artifact)}>Delete</button>}</div></article>; })}{!artifactBusy && !artifacts.length && <div className="automation-empty"><Icon name="tray.full.fill" size={28} /><strong>No artifacts in this workspace</strong><span>Add reports, downloads, screenshots, spreadsheets, or other run outputs. They will stay on this computer.</span></div>}</div>
      </section>}
      {recordingReview && <div className="modal-overlay recording-review-overlay" role="presentation">
        <section className="modal-card recording-review-dialog" role="dialog" aria-modal="true" aria-labelledby="recording-review-title">
          <div className="recording-review-icon"><Icon name="exclamationmark.triangle.fill" size={20} /></div>
          <div>
            <h2 id="recording-review-title">{recordingReview.saveError ? "The recording stopped, but was not saved" : "This recording may not replay successfully"}</h2>
            {recordingReview.saveError
              ? <p>Your captured actions are still available. Retry saving them or discard this recording. {recordingReview.saveError}</p>
              : <p>Only {recordingReview.actionCount} replayable action{recordingReview.actionCount === 1 ? " was" : "s were"} captured. {recordingReview.reason}</p>}
            {recordingReview.missingAgentTrace && <p className="recording-review-detail">The agent completed the chat task, but its structured extraction actions were not available to Recorder. Browser navigation and visible page interactions were captured; silent data extraction was not.</p>}
          </div>
          <div className="recording-review-actions">
            <button className="secondary danger-text" disabled={recordingStopping} onClick={() => { setRecordingReview(undefined); setNotice("Recording discarded."); }}>Discard</button>
            <button className="primary" disabled={recordingStopping} onClick={() => void saveRecordingReview()}>{recordingStopping && <Spinner size={12} />} {recordingReview.saveError ? "Retry save" : "Save anyway"}</button>
          </div>
        </section>
      </div>}
      {shareTarget && <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !shareBusy) setShareTarget(undefined); }}>
        <section className="modal-card automation-share-dialog" role="dialog" aria-modal="true" aria-labelledby="automation-share-title">
          <div><span className="recording-review-icon"><Icon name="person.2.fill" size={18} /></span><h2 id="automation-share-title">Share a copy</h2><p><strong>{shareTarget.title}</strong></p><p>The recipient gets an independent editable copy. Browser profiles, sessions, credentials, run history, and local artifacts are never included.</p></div>
          <label>Email address<input type="email" autoFocus maxLength={320} value={shareEmail} placeholder="teammate@example.com" onChange={(event) => setShareEmail(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void sendShare(); }} /></label>
          <div className="recording-review-actions"><button className="secondary" disabled={shareBusy} onClick={() => { setShareTarget(undefined); setShareEmail(""); }}>Cancel</button><button className="primary" disabled={shareBusy || !validShareEmail(shareEmail)} onClick={() => void sendShare()}>{shareBusy && <Spinner size={12} />} Share copy</button></div>
        </section>
      </div>}
    </div>
  );
}
