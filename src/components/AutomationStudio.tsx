import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { invoke } from "../electronBridge";
import { uid } from "../lib/ids";
import { activeAutomationRecording, AUTOMATION_RECORDING_EVENT, clearActiveAutomationRecording, setActiveAutomationRecording } from "../lib/automationRecording";
import {
  capturedWorkflowDomain,
  recordedBrowserActions,
  workflowQuality,
} from "../lib/workflowCapture";
import { capturedRunsForRecording, skillFromRun, type CapturedRun } from "../lib/automationStudio";
import type { AutomationArtifact, BrowserWorkflowAction, BrowserWorkflowSkill } from "../types";
import { humanBytes } from "../types";
import { Icon, Spinner } from "./Icon";
import { activeAutomationExecution, automationExecutionView, AUTOMATION_EXECUTION_EVENT, clearActiveAutomationExecution, setActiveAutomationExecution, type AutomationExecution } from "../lib/automationExecution";

type StudioSection = "recorder" | "workflows" | "artifacts";
type BackendRecording = { id: string; status: string; revision: number; document: { run?: CapturedRun }; updated_at: string };
type BackendRun = { id: string; workflow_id: string; workflow_version: number; status: "queued" | "running" | "completed" | "failed" | "cancelled"; error?: string; created_at: string; completed_at?: string };
type ElementPickMode = "target" | "container" | "field" | "next";
type ElementPickState = { pickId: string; actionIndex: number; mode: ElementPickMode; fieldName?: string };
type ElementPickResult = { cancelled?: boolean; selector?: string; locator?: { role?: string; name?: string; text?: string }; label?: string; tag?: string; attribute?: string; pageUrl?: string };

const ACTION_OPTIONS = [
  ["navigate", "Open a web page"], ["open", "Open a URL"], ["input", "Enter text"], ["click", "Click something"],
  ["press", "Press a key"], ["select", "Choose an option"], ["wait", "Wait for page content"], ["scroll", "Scroll the page"],
  ["extract", "Collect data"], ["paginate_extract", "Collect data from pages"], ["form_fill", "Fill a form"],
  ["multi_action", "Grouped interactions"], ["act", "Recorded page interaction"],
] as const;
const DETERMINISTIC_ACTIONS = new Set(["navigate", "open", "input", "click", "press", "select", "wait", "scroll", "dismiss", "upload", "extract", "paginate_extract", "tabs_extract", "form_fill", "multi_action", "site_recipe_run", "act"]);
const DEFAULT_EXAMPLES_VERSION = "5";

function defaultExamplesKey(workspaceId: string) {
  return `nextbrowser:automation-default-examples:${workspaceId}`;
}

function actionLabel(tool: string) {
  return ACTION_OPTIONS.find(([value]) => value === tool)?.[1] || `Advanced: ${tool}`;
}

function extractionFields(action: BrowserWorkflowAction): Record<string, Record<string, unknown>> {
  const fields = action.arguments.fields;
  return fields && typeof fields === "object" && !Array.isArray(fields) ? fields as Record<string, Record<string, unknown>> : {};
}

function isBuiltInArtifact(artifact: AutomationArtifact) {
  return artifact.name === "product-research-demo.csv" || artifact.name === "automation-run-demo.json";
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
    if (action.tool === "paginate_extract" && !action.arguments.next_selector && action.arguments.scroll !== true) return `Step ${index + 1} needs a Next button selector or scrolling enabled.`;
    if (containsStoredSecret(action.arguments)) {
      return `Step ${index + 1} appears to contain credentials or payment data. Secrets cannot be stored in a workflow.`;
    }
  }
  return undefined;
}

export function AutomationStudio() {
  const s = useStore();
  const [section, setSection] = useState<StudioSection>("recorder");
  const [recordingSince, setRecordingSince] = useState(() => Number(localStorage.getItem("automationRecordingSince") || 0));
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>();
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
  const [elementPick, setElementPick] = useState<ElementPickState>();
  const workspaceId = s.activeWorkspaceId || "";
  const recordingAgentId = activeAutomationRecording()?.agentId;
  const runs = useMemo(() => recordingSince > 0 ? capturedRunsForRecording(s.conversations, {
    workspaceId, agentId: recordingAgentId, startedAt: recordingSince,
  }).slice(0, 12) : [], [s.conversations, workspaceId, recordingAgentId, recordingSince]);
  const recordedRun = runs[0];
  const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId);
  const draftDirty = !!draft && !!selectedWorkflow && JSON.stringify(draft) !== JSON.stringify(selectedWorkflow);
  const draftValidationError = workflowDraftError(draft);
  const selectedRuns = backendRuns.filter((run) => run.workflow_id === selectedWorkflowId).slice(0, 5);
  const playbackView = useMemo(() => {
    if (!playback || playback.workspaceId !== workspaceId) return undefined;
    return automationExecutionView(playback, s.conversations, playbackClock);
  }, [playback, playbackClock, s.conversations, workspaceId]);
  const executionBusy = !!playback && !!playbackView && !["completed", "failed", "cancelled"].includes(playbackView.phase);

  useEffect(() => () => {
    if (elementPick) void invoke("automation_element_pick_cancel", { pickId: elementPick.pickId }).catch(() => undefined);
  }, [elementPick?.pickId]);

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
    setActionErrors({});
  }, [selectedWorkflowId, workflows]);

  const loadWorkflows = async () => {
    if (!workspaceId) return setWorkflows([]);
    try { setWorkflows(await invoke<BrowserWorkflowSkill[]>("automation_workflows_list", { workspaceId })); setStudioError(undefined); }
    catch (error) { setStudioError(error instanceof Error ? error.message : String(error)); }
  };

  useEffect(() => { void loadWorkflows(); }, [workspaceId]);

  const loadRuns = async () => {
    if (!workspaceId) return setBackendRuns([]);
    try { setBackendRuns(await invoke<BackendRun[]>("automation_runs_list", { workspaceId })); }
    catch (error) { setStudioError(error instanceof Error ? error.message : String(error)); }
  };

  useEffect(() => { void loadRuns(); }, [workspaceId]);

  const loadRecordings = async () => {
    if (!workspaceId) return setRecordings([]);
    try {
      const items = await invoke<BackendRecording[]>("automation_recordings_list", { workspaceId });
      const completed = items.filter((item) => !!item.document.run);
      const unfinished = items.filter((item) => !item.document.run);
      setRecordings(completed);
      if (unfinished.length) await Promise.allSettled(unfinished.map((item) => invoke("automation_recording_delete", { id: item.id })));
    }
    catch (error) { setStudioError(error instanceof Error ? error.message : String(error)); }
  };

  useEffect(() => { void loadRecordings(); }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    const storageKey = defaultExamplesKey(workspaceId);
    if (window.localStorage.getItem(storageKey) === DEFAULT_EXAMPLES_VERSION) return;
    void invoke("automation_seed_examples", { workspaceId })
      .then(() => {
        window.localStorage.setItem(storageKey, DEFAULT_EXAMPLES_VERSION);
        return Promise.all([loadWorkflows(), loadRecordings(), loadRuns(), loadArtifacts()]);
      })
      .catch((error) => setStudioError(error instanceof Error ? error.message : String(error)));
  }, [workspaceId]);

  useEffect(() => {
    if (!playbackView || !["completed", "failed", "cancelled"].includes(playbackView.phase)) return;
    const timer = window.setTimeout(() => void loadRuns(), 750);
    return () => window.clearTimeout(timer);
  }, [playbackView?.phase]);

  useEffect(() => {
    const syncRecording = () => {
      const active = activeAutomationRecording();
      setRecordingSince(active?.workspaceId === workspaceId ? active.startedAt : 0);
      void loadRecordings();
    };
    const openRecorder = () => setSection("recorder");
    const openExecution = (event: Event) => setSection((event as CustomEvent<{ sourceKind?: "recording" | "workflow" }>).detail?.sourceKind === "workflow" ? "workflows" : "recorder");
    syncRecording();
    window.addEventListener(AUTOMATION_RECORDING_EVENT, syncRecording);
    window.addEventListener("nextbrowser:open-recorder", openRecorder);
    window.addEventListener("nextbrowser:open-automation-execution", openExecution);
    return () => {
      window.removeEventListener(AUTOMATION_RECORDING_EVENT, syncRecording);
      window.removeEventListener("nextbrowser:open-recorder", openRecorder);
      window.removeEventListener("nextbrowser:open-automation-execution", openExecution);
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

  useEffect(() => { if (workspaceId) void loadArtifacts(); else setArtifacts([]); }, [workspaceId]);

  const reportError = (error: unknown) => {
    setStudioError(error instanceof Error ? error.message : String(error));
    setNotice(undefined);
  };

  const startRecording = async () => {
    if (!workspaceId) return setStudioError("Create or select a workspace before recording.");
    try {
      const existing = activeAutomationRecording();
      if (existing?.phase === "recording") {
        if (existing.workspaceId !== workspaceId) return setStudioError("Stop the recording in the other workspace before starting a new one.");
        return;
      }
      const startedAt = Date.now();
      const id = uid();
      setActiveAutomationRecording({ id, workspaceId, agentId: s.agentId, startedAt, phase: "recording" });
      setRecordingSince(startedAt);
      setStudioError(undefined);
      if (s.terminalChat) s.setTerminalChat(false);
      s.setTab("chat");
    } catch (error) { reportError(error); }
  };

  const stopRecording = async () => {
    const active = activeAutomationRecording();
    if (!active || active.phase !== "recording" || active.workspaceId !== workspaceId || recordingStopping) return;
    setRecordingStopping(true);
    try {
      const captured = runs.find((run) => run.answer.createdAt >= active.startedAt);
      if (captured) {
        await invoke("automation_recording_put", { recording: { id: active.id, workspace_id: workspaceId, status: "completed", document: { run: captured }, base_revision: 0 } });
        clearActiveAutomationRecording();
        setRecordingSince(0);
        setNotice("Recording stopped and saved. Review it below or turn it into a workflow.");
      } else {
        clearActiveAutomationRecording();
        setRecordingSince(0);
        setNotice("Recording stopped. The incomplete attempt was discarded.");
      }
      await loadRecordings();
    } catch (error) { reportError(error); }
    finally { setRecordingStopping(false); }
  };

  const saveCapture = async (run: CapturedRun) => {
    try {
      const saved = await invoke<BrowserWorkflowSkill>("automation_workflow_put", { workspaceId, workflow: skillFromRun(run) });
      clearActiveAutomationRecording();
      setRecordingSince(0);
      await loadWorkflows();
      setSelectedWorkflowId(saved.id);
      setSection("workflows");
      setNotice("Recording saved as a reusable workflow.");
    } catch (error) { reportError(error); }
  };

  const updateAction = (index: number, field: "tool" | "arguments", value: string) => {
    if (!draft) return;
    const actions = [...draft.actions];
    if (field === "tool") actions[index] = { ...actions[index], tool: value.replace(/^(?:clawbrowser|nextbrowser)\./, "") };
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

  const selectedBrowserRuntime = () => {
    if (!s.selectedProfile) return "clawbrowser";
    for (const workspace of s.workspaces) {
      if (workspace.profileNames.includes(s.selectedProfile)) return workspace.profileToolsets[s.selectedProfile] || "clawbrowser";
    }
    return "clawbrowser";
  };

  const pickElement = async (actionIndex: number, mode: ElementPickMode, fieldName?: string) => {
    if (!draft || elementPick) return;
    const pickId = uid();
    const state = { pickId, actionIndex, mode, fieldName };
    setElementPick(state);
    setStudioError(undefined);
    setNotice("The workflow page is opening. Click the highlighted element in the browser, or press Esc to cancel.");
    try {
      if (s.selectedProfile) {
        const status = s.statuses[s.selectedProfile] ?? s.profileSessions[s.selectedProfile]?.status;
        if (status !== "running") await s.startProfile(s.selectedProfile);
      } else if (s.defaultSession?.status !== "running") {
        await s.startDefaultSession();
      }
      const action = draft.actions[actionIndex];
      const result = await invoke<ElementPickResult>("automation_element_pick", {
        pickId,
        mode,
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
    setDraft({ ...draft, actions, recipe: { ...draft.recipe, actions } });
  };

  const removeAction = (index: number) => {
    if (!draft) return;
    const actions = draft.actions.filter((_, candidate) => candidate !== index);
    setActionErrors({});
    setDraft({ ...draft, actions, recipe: { ...draft.recipe, actions } });
  };

  const addAction = () => {
    if (!draft) return;
    const action: BrowserWorkflowAction = { tool: "navigate", arguments: { url: draft.domain ? `https://${draft.domain}` : "https://example.com" } };
    const actions = [...draft.actions, action];
    setActionErrors({});
    setDraft({ ...draft, actions, recipe: { ...draft.recipe, actions } });
  };

  const saveDraft = async () => {
    if (!draft || draftValidationError || Object.keys(actionErrors).length) return;
    setSaving(true);
    try {
      const saved = await invoke<BrowserWorkflowSkill>("automation_workflow_put", { workspaceId, workflow: { ...draft, recipe: { ...draft.recipe, actions: draft.actions } } });
      setWorkflows((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current]);
      setDraft(saved);
      setStudioError(undefined);
      setNotice("Workflow saved.");
    } catch (error) { reportError(error); }
    finally { setSaving(false); }
  };

  const createWorkflow = async () => {
    if (draftDirty && !window.confirm("Discard unsaved workflow changes and create a new workflow?")) return;
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
      const saved = await invoke<BrowserWorkflowSkill>("automation_workflow_put", { workspaceId, workflow });
      setWorkflows((current) => [saved, ...current]);
      setSelectedWorkflowId(saved.id);
      setNotice("Workflow created. Edit its task and steps, then save it.");
    } catch (error) { reportError(error); }
  };

  const deleteWorkflow = async (workflow: BrowserWorkflowSkill) => {
    if (!window.confirm(`Delete “${workflow.title}”?`)) return;
    try {
      await invoke("automation_workflow_delete", { id: workflow.id });
      setWorkflows((current) => current.filter((item) => item.id !== workflow.id));
      setSelectedWorkflowId(undefined);
      setNotice("Workflow deleted.");
    } catch (error) { reportError(error); }
  };

  const duplicateWorkflow = async (workflow: BrowserWorkflowSkill) => {
    const now = Date.now();
    try {
      const copy = await invoke<BrowserWorkflowSkill>("automation_workflow_put", { workspaceId, workflow: { ...structuredClone(workflow), id: uid(), title: `${workflow.title} copy`, revision: 0, createdAt: now, updatedAt: now, recipe: { ...workflow.recipe, example_key: undefined, example_version: undefined, demo_key: undefined, demo_version: undefined } } });
      setWorkflows((current) => [copy, ...current]);
      setSelectedWorkflowId(copy.id);
      setNotice("Workflow duplicated. Edit the copy without changing the original.");
    } catch (error) { reportError(error); }
  };

  const selectWorkflow = (id: string) => {
    if (draftDirty && !window.confirm("Discard unsaved workflow changes?")) return;
    setSelectedWorkflowId(id);
  };

  const executeRecipe = async (workflow: BrowserWorkflowSkill, sourceKind: "recording" | "workflow", sourceId: string) => {
    if (executionBusy) return setStudioError(`“${playback?.workflowTitle || "Another workflow"}” is already running. Stop it before starting another automation.`);
    if (playback) clearActiveAutomationExecution();
    const runId = sourceKind === "workflow" ? uid() : undefined;
    const next: AutomationExecution = { executionId: uid(), sourceId, sourceKind, backendRunId: runId, workspaceId, workflowTitle: workflow.title, task: workflow.task, startedAt: Date.now(), expectedActions: workflow.actions.length, actionTools: workflow.actions.map((action) => action.tool), engine: "deterministic", phase: "preparing", completedActions: 0, progress: 8, detail: "Preparing the browser session…" };
    try {
      if (runId) {
        await invoke("automation_run_create", { run: { id: runId, workspace_id: workspaceId, workflow_id: workflow.id, input: { task: workflow.task, engine: "deterministic" } } });
        await invoke("automation_run_update", { id: runId, update: { status: "running", output: { engine: "deterministic" } } });
      }
      setPlayback(next);
      setActiveAutomationExecution(next);
      setNotice(`${sourceKind === "workflow" ? "Workflow" : "Recording"} started without an AI agent. Progress and Stop remain visible in the main menu.`);
      setStudioError(undefined);
      const result = await s.runAutomationRecipe(workflow, next.executionId, { task: workflow.task, ...(runId ? { backendRunId: runId } : {}) });
      const completedActions = result.results.filter((step) => step.ok).length;
      const detail = result.status === "completed"
        ? `Completed all ${workflow.actions.length} browser steps without AI.`
        : result.status === "cancelled" ? "Execution stopped by user."
          : `Step ${(result.failedStep ?? completedActions) + 1} failed: ${result.error || "The saved browser action could not be completed."}`;
      const progress = result.status === "completed" ? 100 : Math.max(12, Math.round(completedActions / Math.max(1, workflow.actions.length) * 100));
      const finished: AutomationExecution = { ...next, phase: result.status, completedActions, progress, detail, error: result.error, failedStep: result.failedStep };
      setPlayback(finished);
      setActiveAutomationExecution(finished);
      if (runId) await invoke("automation_run_update", { id: runId, update: { status: result.status, output: { engine: "deterministic", steps: result.results.map(({ index, tool, ok, error }) => ({ index, tool, ok, error })), detail } } });
      if (result.status === "completed") setNotice("Deterministic replay completed successfully without using an AI agent.");
      else if (result.status === "failed") setStudioError("A saved browser step failed. You can inspect the step or use Repair & run with AI.");
      await loadRuns();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed: AutomationExecution = { ...next, phase: "failed", progress: 8, detail: message, error: message };
      setPlayback(failed);
      setActiveAutomationExecution(failed);
      if (runId) await invoke("automation_run_update", { id: runId, update: { status: "failed", output: { engine: "deterministic", error: message } } }).catch(() => undefined);
      setStudioError("The deterministic browser runner could not complete this automation. You can retry or use Repair & run with AI.");
    }
  };

  const runWorkflow = async (workflow: BrowserWorkflowSkill) => executeRecipe(workflow, "workflow", workflow.id);

  const replayRecording = async (run: CapturedRun) => {
    const workflow = skillFromRun(run);
    await executeRecipe(workflow, "recording", run.id);
  };

  const repairWithAgent = async () => {
    if (!playback || playback.phase !== "failed") return;
    if (!s.agentReady()) return setStudioError("Connect an agent to repair this failed automation.");
    const workflow = playback.sourceKind === "workflow"
      ? workflows.find((item) => item.id === playback.sourceId)
      : recordings.map((item) => item.document.run).filter((run): run is CapturedRun => !!run).find((run) => run.id === playback.sourceId);
    const repairWorkflow = workflow && "recipe" in workflow ? workflow : workflow ? skillFromRun(workflow) : undefined;
    if (!repairWorkflow) return setStudioError("The source automation is no longer available.");
    const agentExecution: AutomationExecution = { ...playback, executionId: uid(), engine: "agent", phase: "preparing", startedAt: Date.now(), progress: undefined, completedActions: undefined, detail: "Preparing AI-assisted repair…", error: undefined, failedStep: undefined, backendRunId: undefined };
    setPlayback(agentExecution);
    setActiveAutomationExecution(agentExecution);
    try {
      const repairTask = `${repairWorkflow.task}\n\nThe deterministic replay failed${playback.failedStep != null ? ` at step ${playback.failedStep + 1}` : ""}: ${playback.error || playback.detail || "unknown browser error"}. Inspect the current page, adapt the failed selector or action, complete the task, and explain the repair so the recording can be updated.`;
      const replyId = await s.runLocalSkill(repairWorkflow, repairTask);
      if (!replyId) throw new Error("The AI repair run could not be started.");
      const running = { ...agentExecution, replyId, phase: "running" as const };
      setPlayback(running);
      setActiveAutomationExecution(running);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = { ...agentExecution, phase: "failed" as const, progress: 100, detail: message, error: message };
      setPlayback(failed);
      setActiveAutomationExecution(failed);
      setStudioError(message);
    }
  };

  const stopExecution = async () => {
    if (!playback || ["completed", "failed", "cancelled", "stopping"].includes(playback.phase)) return;
    const stopping: AutomationExecution = { ...playback, phase: "stopping", detail: "Stopping execution…" };
    setPlayback(stopping);
    setActiveAutomationExecution(stopping);
    if (stopping.engine === "deterministic") {
      await invoke("automation_recipe_cancel", { executionId: stopping.executionId }).catch(reportError);
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
    catch (error) { setArtifactError(error instanceof Error ? error.message : String(error)); }
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
    <div className="automation-studio page">
      <header className="automation-hero">
        <div><span className="eyebrow">Automation Studio</span><h1>Record, build, and collect</h1><p>Turn successful browser runs into repeatable workflows and keep their files with the workspace.</p></div>
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
        <span><b>1</b> Record a successful browser task</span><i>→</i><span><b>2</b> Review and save its steps</span><i>→</i><span><b>3</b> Run it and collect files</span>
      </div>
      {studioError && <div className="error automation-global-message" role="alert"><strong>Automation couldn’t complete the action.</strong><span>{studioError}</span><button onClick={() => setStudioError(undefined)}>Dismiss</button></div>}
      {notice && <div className="automation-global-message success" role="status"><span>{notice}</span><button onClick={() => setNotice(undefined)}>Dismiss</button></div>}
      {playback && playbackView && <div className={`recording-progress-card ${playbackView.phase}`} role="status"><div className="recording-progress-head"><span><Icon name={playbackView.phase === "completed" ? "checkmark.circle.fill" : ["failed", "cancelled"].includes(playbackView.phase) ? "xmark.circle.fill" : playbackView.phase === "stopping" ? "stop.fill" : "play.fill"} size={14} /><strong>{playbackView.phase === "completed" ? "Execution completed" : playbackView.phase === "cancelled" ? "Execution stopped" : playbackView.phase === "failed" ? "Execution failed" : playbackView.phase === "stopping" ? "Stopping execution" : playbackView.phase === "preparing" ? "Preparing execution" : playback.engine === "deterministic" ? "Running saved steps" : "AI repair is running"}</strong></span><b>{playbackView.progress}%</b></div><div className="recording-progress-track"><i style={{ width: `${playbackView.progress}%` }} /></div><small>{playbackView.detail}</small><div className="row">{playbackView.phase === "failed" && <button className="primary" disabled={!s.agentReady()} title={s.agentReady() ? "Let the agent inspect and repair the failed step" : "Connect an agent to repair this workflow"} onClick={() => void repairWithAgent()}>Repair &amp; run with AI</button>}{["completed", "failed", "cancelled"].includes(playbackView.phase) ? <button onClick={() => { setPlayback(undefined); clearActiveAutomationExecution(); }}>Dismiss</button> : <button className="secondary danger-text" disabled={playbackView.phase === "stopping"} onClick={() => void stopExecution()}><Icon name="stop.fill" size={12} /> {playbackView.phase === "stopping" ? "Stopping…" : "Stop"}</button>}</div></div>}

      {section === "recorder" && <section className="automation-panel">
        <div className="automation-panel-head"><div><h2>Recordings</h2><p>A recording is a completed browser task. Run it again as-is, or turn it into an editable workflow.</p></div>
          <div className="row">{recordingSince > 0 ? <button className="secondary danger-text" disabled={recordingStopping} onClick={() => void stopRecording()}>{recordingStopping ? <Spinner size={12} /> : <Icon name="stop.fill" size={12} />} Stop recording</button> : <button className="primary" onClick={() => void startRecording()}><Icon name="circle.fill" size={12} /> Start recording</button>}</div>
        </div>
        <div className="automation-management-note"><Icon name="info.circle" size={13} /><span>Records agent-driven browser actions in Project Chat—not manual clicks or Terminal sessions. There is no pause because page state may change.</span></div>
        {recordingSince > 0 && <div className="recording-banner"><span className="recording-dot" />{recordedRun ? "Browser run captured — click Stop recording to save it." : "Recording is armed. Complete one browser task in Project Chat, then click Stop recording."}</div>}
        <div className="capture-list">
          {recordings.map((recording) => {
            const run = recording.document.run!;
            const domain = capturedWorkflowDomain(run.task, run.evidence);
            const quality = workflowQuality(run.task, run.evidence, domain);
            const actions = recordedBrowserActions(run.evidence);
            return <article className={"capture-card" + (recordedRun?.id === run.id ? " is-new" : "")} key={run.id}>
              <div className="capture-kind"><span className="ready">READY RECORDING</span><small>{recording.status === "completed" ? "Completed" : recording.status}</small></div>
              <div className="capture-card-copy"><strong>{run.task.slice(0, 160)}</strong><span>{run.conversationTitle} · {domain || "Unknown website"} · {actions.length} recorded actions</span>{run.captureSource === "structured-recipe" && <small>Captured from the workflow recipe used by the agent; raw Codex tool events were not available.</small>}<small className={quality.reusable ? "ok" : "muted"}>{quality.reason}</small><details className="capture-steps"><summary>Show recorded steps</summary><ol>{actions.map((action, index) => <li key={`${index}-${action.tool}`}><b>{actionLabel(action.tool)}</b><code>{JSON.stringify(action.arguments)}</code></li>)}</ol></details></div>
              <div className="capture-card-actions">{playback?.sourceId === run.id && playbackView && !["completed", "failed", "cancelled"].includes(playbackView.phase) ? <div className="capture-running"><Spinner size={13} /><span>{playbackView.phase === "preparing" ? "Preparing…" : playbackView.phase === "stopping" ? "Stopping…" : `${playbackView.progress}% running`}</span></div> : <button className="secondary" disabled={!quality.reusable || executionBusy} title={executionBusy ? "Stop the running automation first" : "Run recording"} onClick={() => void replayRecording(run)}><Icon name="play.fill" size={12} /> Run again</button>}<button className="btn-bordered-prominent" disabled={!quality.reusable} onClick={() => void saveCapture(run)}>Turn into workflow</button><button className="mini danger-text" title="Delete recording" onClick={() => void deleteRecording(recording)}><Icon name="trash" size={12} /> Delete</button></div>
            </article>;
          })}
          {!recordings.length && <div className="automation-empty"><Icon name="play.rectangle.on.rectangle.fill" size={28} /><strong>No recordings yet</strong><span>Record and stop a successful browser task to save it here.</span></div>}
        </div>
      </section>}

      {section === "workflows" && <section className="automation-panel workflow-builder">
        <aside className="workflow-list"><div className="workflow-list-title"><span>Workflows</span><button className="mini" title="Create workflow" aria-label="Create workflow" onClick={() => void createWorkflow()}><Icon name="plus" size={12} /></button></div>{workflows.map((skill) => <button key={skill.id} className={skill.id === selectedWorkflowId ? "active" : ""} onClick={() => selectWorkflow(skill.id)}><Icon name="arrow.triangle.branch" size={14} /><span><strong>{skill.title}</strong><small>{skill.actions.length} steps · {skill.domain || "Any site"}</small></span></button>)}{!workflows.length && <p className="muted small">Record a run or create a workflow from a task.</p>}</aside>
        <div className="workflow-canvas">{draft ? <>
          <div className="workflow-editor-head"><div><input className="workflow-title-input" aria-label="Workflow name" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /><input className="workflow-domain-input" aria-label="Website domain" value={draft.domain} placeholder="example.com" onChange={(event) => setDraft({ ...draft, domain: event.target.value })} />{draftDirty && <small className="workflow-unsaved">Unsaved changes</small>}</div><div className="row"><button className="mini danger-text" onClick={() => void deleteWorkflow(draft)}>Delete</button><button className="secondary" onClick={() => void duplicateWorkflow(draft)}>Duplicate</button><button className="secondary" disabled={draftDirty || executionBusy || !!draftValidationError} title={draftDirty ? "Save changes before running" : draftValidationError || (executionBusy ? "Stop the running automation first" : "Run workflow")} onClick={() => void runWorkflow(draft)}>Run</button><button className="primary" disabled={saving || !draftDirty || !!draftValidationError || !!Object.keys(actionErrors).length} onClick={() => void saveDraft()}>{saving && <Spinner size={12} />} Save</button></div></div>
          <div className="workflow-builder-help"><strong>Build by clicking the real page—no HTML or CSS knowledge required.</strong><span>Set the page URL, then use Select on page. NextBrowser opens the selected browser and creates the locator automatically. Technical locators remain under Advanced JSON.</span></div>
          {elementPick && <div className="workflow-picker-banner" role="status"><Spinner size={13} /><span><strong>Selecting an element for step {elementPick.actionIndex + 1}</strong><small>Click the highlighted element in the browser. Press Esc there to cancel.</small></span><button className="secondary" onClick={() => void cancelElementPick()}>Cancel</button></div>}
          {draftValidationError && <div className="error automation-inline-error" role="alert">{draftValidationError}</div>}
          <label className="field-label">What should this workflow accomplish?<textarea value={draft.task} onChange={(event) => setDraft({ ...draft, task: event.target.value })} /></label>
          <div className="workflow-steps">{draft.actions.map((action, index) => <div className="workflow-step" key={`${index}-${action.tool}`}><div className="workflow-step-number">{index + 1}</div><div className="workflow-step-body"><select value={ACTION_OPTIONS.some(([value]) => value === action.tool) ? action.tool : "advanced"} aria-label={`Step ${index + 1} action`} onChange={(event) => { if (event.target.value !== "advanced") updateAction(index, "tool", event.target.value); }}><option value="advanced">{actionLabel(action.tool)}</option>{ACTION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            {["navigate", "open"].includes(action.tool) && <label>Page URL<input value={String(action.arguments.url || "")} placeholder="https://example.com/products" onChange={(event) => updateActionArgument(index, "url", event.target.value)} /></label>}
            {["input", "click"].includes(action.tool) && <label>Target on the page<div className="workflow-visual-target"><span className={actionTarget(action) ? "selected" : ""}>{targetSummary(action)}</span><button type="button" className="secondary" disabled={!!elementPick} onClick={() => void pickElement(index, "target")}><Icon name="cursorarrow" size={12} /> {actionTarget(action) ? "Select again" : "Select on page"}</button></div></label>}
            {action.tool === "input" && <label>Text to enter<input value={String(action.arguments.text || "")} placeholder="Search phrase or {{input}}" onChange={(event) => updateActionArgument(index, "text", event.target.value)} /></label>}
            {action.tool === "press" && <label>Key<input value={String(action.arguments.key || "Enter")} placeholder="Enter" onChange={(event) => updateActionArgument(index, "key", event.target.value)} /></label>}
            {action.tool === "select" && <><label>Target on the page<div className="workflow-visual-target"><span className={actionTarget(action) ? "selected" : ""}>{targetSummary(action)}</span><button type="button" className="secondary" disabled={!!elementPick} onClick={() => void pickElement(index, "target")}><Icon name="cursorarrow" size={12} /> {actionTarget(action) ? "Select again" : "Select on page"}</button></div></label><label>Option value<input value={String(action.arguments.value || "")} onChange={(event) => updateActionArgument(index, "value", event.target.value)} /></label></>}
            {action.tool === "wait" && <label>Content that means the page is ready<div className="workflow-visual-target"><span className={action.arguments.selector ? "selected" : ""}>{action.arguments.selector ? "Selected page content" : "No content selected"}</span><button type="button" className="secondary" disabled={!!elementPick} onClick={() => void pickElement(index, "target")}><Icon name="cursorarrow" size={12} /> {action.arguments.selector ? "Select again" : "Select on page"}</button></div></label>}
            {action.tool === "act" && <><label>Interaction<input value={String(action.arguments.action || "click")} placeholder="click, type, or press" onChange={(event) => updateActionArgument(index, "action", event.target.value)} /></label><label>Target on the page <small>Optional</small><div className="workflow-visual-target"><span className={action.arguments.selector ? "selected" : ""}>{action.arguments.selector ? "Selected page element" : "No element selected"}</span><button type="button" className="secondary" disabled={!!elementPick} onClick={() => void pickElement(index, "target")}><Icon name="cursorarrow" size={12} /> {action.arguments.selector ? "Select again" : "Select on page"}</button></div></label>{action.arguments.action === "type" && <label>Text to enter<input value={String(action.arguments.text || "")} onChange={(event) => updateActionArgument(index, "text", event.target.value)} /></label>}</>}
            {["extract", "paginate_extract"].includes(action.tool) && <><label>One repeated result row<div className="workflow-visual-target"><span className={action.arguments.container ? "selected" : ""}>{action.arguments.container ? "Result row selected" : "Select one card, row, or search result"}</span><button type="button" className="secondary" disabled={!!elementPick} onClick={() => void pickElement(index, "container")}><Icon name="cursorarrow" size={12} /> {action.arguments.container ? "Select again" : "Select row on page"}</button></div></label><label>Data fields <small>Name what you want to collect</small><input value={Object.keys(extractionFields(action)).join(", ")} placeholder="title, price, url" onChange={(event) => updateExtractionFields(index, event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} /></label>{Object.entries(extractionFields(action)).map(([name, spec]) => <label key={name}>{name}<div className="workflow-visual-target"><span className={spec.selector ? "selected" : ""}>{spec.selector ? `${name} selected${spec.attribute ? ` · ${String(spec.attribute)}` : ""}` : `Select ${name} inside the result row`}</span><button type="button" className="secondary" disabled={!!elementPick || !action.arguments.container} title={!action.arguments.container ? "Select the repeated result row first" : `Select ${name} on page`} onClick={() => void pickElement(index, "field", name)}><Icon name="cursorarrow" size={12} /> {spec.selector ? "Select again" : "Select on page"}</button></div></label>)}{action.tool === "paginate_extract" && <><label>Next page button<div className="workflow-visual-target"><span className={action.arguments.next_selector ? "selected" : ""}>{action.arguments.next_selector ? "Next button selected" : "No Next button selected"}</span><button type="button" className="secondary" disabled={!!elementPick} onClick={() => void pickElement(index, "next")}><Icon name="cursorarrow" size={12} /> {action.arguments.next_selector ? "Select again" : "Select on page"}</button></div></label><label className="workflow-checkbox"><input type="checkbox" checked={action.arguments.scroll === true} onChange={(event) => updateActionArgument(index, "scroll", event.target.checked || undefined)} /> Use infinite scrolling instead</label></>}</>}
            <details><summary>Advanced JSON</summary><textarea key={JSON.stringify(action.arguments)} defaultValue={JSON.stringify(action.arguments, null, 2)} aria-label={`Step ${index + 1} arguments`} onBlur={(event) => updateAction(index, "arguments", event.target.value)} /></details>{actionErrors[index] && <small className="error">{actionErrors[index]}</small>}</div><div className="workflow-step-actions"><button className="mini" disabled={index === 0} onClick={() => moveAction(index, -1)}>↑</button><button className="mini" disabled={index === draft.actions.length - 1} onClick={() => moveAction(index, 1)}>↓</button><button className="mini danger-text" onClick={() => removeAction(index)}>×</button></div></div>)}</div>
          <button className="secondary workflow-add-step" onClick={addAction}><Icon name="plus" size={13} /> Add browser step</button>
          <label className="field-label">AI repair instructions <small>Used only when you explicitly choose Repair &amp; run with AI.</small><textarea rows={6} value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} /></label>
          <section className="workflow-run-history"><div><strong>Recent runs</strong><button className="mini" onClick={() => void loadRuns()}>Refresh</button></div>{selectedRuns.length ? <ul>{selectedRuns.map((run) => <li key={run.id}><span className={`run-status ${run.status}`}>{run.status}</span><span>Version {run.workflow_version}</span><time>{new Date(run.created_at).toLocaleString()}</time>{run.error && <small>{run.error}</small>}</li>)}</ul> : <p className="muted small">No runs yet. Run this workflow to create backend history.</p>}</section>
        </> : <div className="automation-empty"><Icon name="arrow.triangle.branch" size={28} /><strong>Select or record a workflow</strong></div>}</div>
      </section>}

      {section === "artifacts" && <section className="automation-panel">
        <div className="automation-panel-head"><div><h2>Artifact Center</h2><p>Up to 1 GiB per file. Stored only on this computer.</p></div><button className="primary" disabled={artifactBusy} onClick={() => void importArtifacts()}>{artifactBusy ? <Spinner size={13} /> : <Icon name="plus" size={13} />} Add files</button></div>
        <div className="artifact-local-note"><Icon name="info.circle" size={14} /><span><strong>Local storage.</strong> Files remain on this computer until you delete them. They are not uploaded or synced to other devices.</span></div>
        {artifactError && <div className="error automation-inline-error">{artifactError}</div>}
        <div className="automation-management-note"><Icon name="info.circle" size={13} /><span>Local files can be opened or deleted at any time. Built-in examples stay available for new users.</span></div>
        <div className="artifact-grid">{artifacts.map((artifact) => { const builtIn = isBuiltInArtifact(artifact); return <article className="artifact-card" key={artifact.id}><div className="artifact-icon"><Icon name="doc" size={22} /></div><div className="artifact-copy"><strong title={artifact.name}>{artifact.name}</strong>{builtIn && <small className="artifact-example-label">Built-in example</small>}<span>{artifact.extension.toUpperCase() || "FILE"} · {humanBytes(artifact.size)}</span><small>Added {new Date(artifact.createdAt).toLocaleString()} · Local only</small></div><div className="artifact-actions"><button className="secondary" onClick={() => void openArtifact(artifact)}>Open</button>{!builtIn && <button className="mini danger-text" onClick={() => void deleteArtifact(artifact)}>Delete</button>}</div></article>; })}{!artifactBusy && !artifacts.length && <div className="automation-empty"><Icon name="tray.full.fill" size={28} /><strong>No artifacts in this workspace</strong><span>Add reports, downloads, screenshots, spreadsheets, or other run outputs. They will stay on this computer.</span></div>}</div>
      </section>}
    </div>
  );
}
