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
type RecordingFilter = "all" | "ready" | "recording" | "stopped";
type BackendRecording = { id: string; status: string; revision: number; document: { run?: CapturedRun; started_at?: string }; updated_at: string };
type BackendRun = { id: string; workflow_id: string; workflow_version: number; status: "queued" | "running" | "completed" | "failed" | "cancelled"; error?: string; created_at: string; completed_at?: string };

const ACTION_OPTIONS = [
  ["navigate", "Open a web page"], ["open", "Open a URL"], ["input", "Enter text"], ["click", "Click something"],
  ["press", "Press a key"], ["select", "Choose an option"], ["wait", "Wait for page content"], ["scroll", "Scroll the page"],
  ["extract", "Collect data"], ["paginate_extract", "Collect data from pages"], ["form_fill", "Fill a form"],
  ["multi_action", "Grouped interactions"], ["act", "Recorded page interaction"],
] as const;
const DEFAULT_EXAMPLES_VERSION = "4";

function defaultExamplesKey(workspaceId: string) {
  return `nextbrowser:automation-default-examples:${workspaceId}`;
}

function actionLabel(tool: string) {
  return ACTION_OPTIONS.find(([value]) => value === tool)?.[1] || `Advanced: ${tool}`;
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
    if (!action.arguments || typeof action.arguments !== "object" || Array.isArray(action.arguments)) return `Step ${index + 1} arguments must be a JSON object.`;
    if (["navigate", "open"].includes(action.tool)) {
      try {
        const url = new URL(String(action.arguments.url || ""));
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch { return `Step ${index + 1} needs a valid http:// or https:// URL.`; }
    }
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
  const [recordingFilter, setRecordingFilter] = useState<RecordingFilter>("all");
  const [recordingStopping, setRecordingStopping] = useState(false);
  const workspaceId = s.activeWorkspaceId || "";
  const recordingAgentId = activeAutomationRecording()?.agentId;
  const runs = useMemo(() => recordingSince > 0 ? capturedRunsForRecording(s.conversations, {
    workspaceId, agentId: recordingAgentId, startedAt: recordingSince,
  }).slice(0, 12) : [], [s.conversations, workspaceId, recordingAgentId, recordingSince]);
  const recordedRun = runs[0];
  const visibleRecordings = recordings.filter((recording) => {
    if (recordingFilter === "ready") return !!recording.document.run;
    if (recordingFilter === "recording") return !recording.document.run && recording.status === "recording";
    if (recordingFilter === "stopped") return !recording.document.run && recording.status !== "recording";
    return true;
  });
  const stoppedRecordingCount = recordings.filter((recording) => !recording.document.run && recording.status !== "recording").length;
  const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId);
  const draftDirty = !!draft && !!selectedWorkflow && JSON.stringify(draft) !== JSON.stringify(selectedWorkflow);
  const draftValidationError = workflowDraftError(draft);
  const selectedRuns = backendRuns.filter((run) => run.workflow_id === selectedWorkflowId).slice(0, 5);
  const playbackView = useMemo(() => {
    if (!playback || playback.workspaceId !== workspaceId) return undefined;
    return automationExecutionView(playback, s.conversations, playbackClock);
  }, [playback, playbackClock, s.conversations, workspaceId]);
  const executionBusy = !!playback && !!playbackView && !["completed", "failed", "cancelled"].includes(playbackView.phase);

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
      setRecordings(items);
      const active = activeAutomationRecording();
      if (active?.workspaceId === workspaceId && Date.now() - active.startedAt > 10_000 && !items.some((item) => item.id === active.id)) {
        clearActiveAutomationRecording();
        setRecordingSince(0);
      }
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
        if (recordedRun && existing.workspaceId === workspaceId) {
          await invoke("automation_recording_put", { recording: { id: existing.id, workspace_id: existing.workspaceId, status: "completed", document: { run: recordedRun }, base_revision: 1 } });
        } else {
          await invoke("automation_recording_delete", { id: existing.id });
          setRecordings((current) => current.filter((item) => item.id !== existing.id));
        }
      }
      const startedAt = Date.now();
      const id = uid();
      setActiveAutomationRecording({ id, workspaceId, agentId: s.agentId, startedAt, phase: "recording" });
      setRecordingSince(startedAt);
      const recording = await invoke<BackendRecording>("automation_recording_put", { recording: { id, workspace_id: workspaceId, status: "recording", document: { started_at: new Date(startedAt).toISOString() }, base_revision: 0 } });
      setRecordings((current) => [recording, ...current]);
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
        await invoke("automation_recording_put", { recording: { id: active.id, workspace_id: workspaceId, status: "completed", document: { run: captured }, base_revision: 1 } });
        clearActiveAutomationRecording();
        setRecordingSince(0);
        setNotice("Recording stopped and saved. Review it below or turn it into a workflow.");
      } else {
        await invoke("automation_recording_delete", { id: active.id });
        clearActiveAutomationRecording();
        setRecordingSince(0);
        setRecordings((current) => current.filter((item) => item.id !== active.id));
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

  const runWorkflow = async (workflow: BrowserWorkflowSkill) => {
    if (!s.agentReady()) return setStudioError("Connect an agent before running this workflow.");
    if (executionBusy) return setStudioError(`“${playback?.workflowTitle || "Another workflow"}” is already running. Stop it before starting another automation.`);
    if (playback) clearActiveAutomationExecution();
    const runId = uid();
    const next: AutomationExecution = { executionId: uid(), sourceId: workflow.id, sourceKind: "workflow", backendRunId: runId, workspaceId, workflowTitle: workflow.title, task: workflow.task, startedAt: Date.now(), expectedActions: workflow.actions.length, actionTools: workflow.actions.map((action) => action.tool), phase: "preparing" };
    try {
      await invoke("automation_run_create", { run: { id: runId, workspace_id: workspaceId, workflow_id: workflow.id, input: { task: workflow.task } } });
      await invoke("automation_run_update", { id: runId, update: { status: "running", output: {} } });
      setPlayback(next);
      setActiveAutomationExecution(next);
      setNotice("Workflow started. Its progress and Stop control remain visible in the main menu.");
      setStudioError(undefined);
      const replyId = await s.runLocalSkill(workflow);
      const current = activeAutomationExecution();
      if (current?.executionId !== next.executionId) return;
      if (current.phase === "stopping") {
        if (replyId && s.cancelQueuedReply(replyId)) clearActiveAutomationExecution();
        else if (replyId) s.stopReply(replyId);
        else { s.stopRunning(); clearActiveAutomationExecution(); }
        return;
      }
      if (!replyId) throw new Error("The browser session could not be prepared, so the workflow was not started.");
      const running = { ...next, replyId, phase: "running" as const };
      setPlayback(running);
      setActiveAutomationExecution(running);
    } catch (error) {
      await invoke("automation_run_update", { id: runId, update: { status: "failed", output: { error: error instanceof Error ? error.message : String(error) } } }).catch(() => undefined);
      clearActiveAutomationExecution();
      reportError(error);
    }
  };

  const replayRecording = async (run: CapturedRun) => {
    if (!s.agentReady()) return setStudioError("Connect an agent before running this recording.");
    if (executionBusy) return setStudioError(`“${playback?.workflowTitle || "Another workflow"}” is already running. Stop it before starting another automation.`);
    if (playback) clearActiveAutomationExecution();
    const workflow = skillFromRun(run);
    const next: AutomationExecution = { executionId: uid(), sourceId: run.id, sourceKind: "recording", workspaceId, workflowTitle: workflow.title, task: run.task, startedAt: Date.now(), expectedActions: workflow.actions.length, actionTools: workflow.actions.map((action) => action.tool), phase: "preparing" };
    setPlayback(next);
    setActiveAutomationExecution(next);
    setNotice("Preparing this recording. Its progress and Stop control remain visible in the main menu.");
    try {
      const replyId = await s.runLocalSkill(workflow, run.task);
      const current = activeAutomationExecution();
      if (current?.executionId !== next.executionId) return;
      if (current.phase === "stopping") {
        if (replyId && s.cancelQueuedReply(replyId)) clearActiveAutomationExecution();
        else if (replyId) s.stopReply(replyId);
        else { s.stopRunning(); clearActiveAutomationExecution(); }
        return;
      }
      if (!replyId) throw new Error("The browser session could not be prepared, so the recording was not started.");
      const running = { ...next, replyId, phase: "running" as const };
      setPlayback(running);
      setActiveAutomationExecution(running);
    } catch (error) { clearActiveAutomationExecution(); reportError(error); }
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

  const recoverRecording = async (recording: BackendRecording, run: CapturedRun) => {
    try {
      await invoke("automation_recording_put", { recording: { id: recording.id, workspace_id: workspaceId, status: "completed", document: { run }, base_revision: recording.revision } });
      await loadRecordings();
      setNotice("Stopped recording recovered and saved.");
    } catch (error) { reportError(error); }
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

  const clearStoppedRecordings = async () => {
    const stopped = recordings.filter((recording) => !recording.document.run && recording.status !== "recording");
    if (!stopped.length || !window.confirm(`Delete ${stopped.length} stopped recording attempt${stopped.length === 1 ? "" : "s"}?`)) return;
    try {
      await Promise.all(stopped.map((recording) => invoke("automation_recording_delete", { id: recording.id })));
      setRecordings((current) => current.filter((item) => !stopped.some((stoppedItem) => stoppedItem.id === item.id)));
      setNotice("Stopped recording attempts cleared.");
    } catch (error) { reportError(error); await loadRecordings(); }
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
      {playback && playbackView && <div className={`recording-progress-card ${playbackView.phase}`} role="status"><div className="recording-progress-head"><span><Icon name={playbackView.phase === "completed" ? "checkmark.circle.fill" : ["failed", "cancelled"].includes(playbackView.phase) ? "xmark.circle.fill" : playbackView.phase === "stopping" ? "stop.fill" : "play.fill"} size={14} /><strong>{playbackView.phase === "completed" ? "Execution completed" : playbackView.phase === "cancelled" ? "Execution stopped" : playbackView.phase === "failed" ? "Execution failed" : playbackView.phase === "stopping" ? "Stopping execution" : playbackView.phase === "preparing" ? "Preparing execution" : "Workflow is running"}</strong></span><b>{playbackView.progress}%</b></div><div className="recording-progress-track"><i style={{ width: `${playbackView.progress}%` }} /></div><small>{playbackView.detail}</small>{["completed", "failed", "cancelled"].includes(playbackView.phase) && <button onClick={() => { setPlayback(undefined); clearActiveAutomationExecution(); }}>Dismiss</button>}</div>}

      {section === "recorder" && <section className="automation-panel">
        <div className="automation-panel-head"><div><h2>Recordings</h2><p>A recording is a completed browser task. Run it again as-is, or turn it into an editable workflow.</p></div>
          <div className="row">{stoppedRecordingCount > 0 && <button className="secondary" onClick={() => void clearStoppedRecordings()}>Clear stopped ({stoppedRecordingCount})</button>}{recordingSince > 0 ? <button className="secondary danger-text" disabled={recordingStopping} onClick={() => void stopRecording()}>{recordingStopping ? <Spinner size={12} /> : <Icon name="stop.fill" size={12} />} Stop recording</button> : <button className="primary" onClick={() => void startRecording()}><Icon name="circle.fill" size={12} /> Start recording</button>}</div>
        </div>
        <div className="recording-filters" aria-label="Filter recordings">{(["all", "ready", "recording", "stopped"] as RecordingFilter[]).map((filter) => <button key={filter} className={recordingFilter === filter ? "active" : ""} onClick={() => setRecordingFilter(filter)}>{filter === "all" ? `All ${recordings.length}` : filter === "ready" ? `Ready ${recordings.filter((item) => item.document.run).length}` : filter === "recording" ? `Recording ${recordings.filter((item) => !item.document.run && item.status === "recording").length}` : `Stopped ${stoppedRecordingCount}`}</button>)}</div>
        <div className="automation-management-note"><Icon name="info.circle" size={13} /><span>Records agent-driven browser actions in Project Chat—not manual clicks or Terminal sessions. There is no pause because page state may change.</span></div>
        {recordingSince > 0 && <div className="recording-banner"><span className="recording-dot" />{recordedRun ? "Browser run captured — click Stop recording to save it." : "Recording is armed. Complete one browser task in Project Chat, then click Stop recording."}</div>}
        <div className="capture-list">
          {visibleRecordings.filter((item) => item.document.run).map((recording) => {
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
          {visibleRecordings.filter((item) => !item.document.run).map((recording) => {
            const startedAt = Date.parse(recording.document.started_at || "");
            const stoppedAt = Date.parse(recording.updated_at || "");
            const recoverable = runs.find((run) => run.answer.createdAt >= startedAt && (!Number.isFinite(stoppedAt) || run.answer.createdAt <= stoppedAt));
            return <article className="capture-card capture-attempt" key={recording.id}><div className="capture-kind"><span className={recording.status === "recording" ? "recording" : "stopped"}>{recording.status === "recording" ? "RECORDING" : "STOPPED"}</span><small>{recording.status}</small></div><div className="capture-card-copy"><strong>{recoverable ? "A completed browser run can be recovered" : recording.status === "recording" ? "Waiting for a browser task" : "No completed browser run was captured"}</strong><span>{recording.document.started_at ? `Started ${new Date(recording.document.started_at).toLocaleString()}` : "Recording attempt"}</span><small>{recoverable ? "The browser task finished before this recording was stopped. Save it now." : recording.status === "recording" ? "Complete a browser task in Project, or use Stop to finish recording." : "This attempt was stopped before the agent completed a reusable browser task."}</small></div><div className="capture-card-actions">{recoverable && <button className="btn-bordered-prominent" onClick={() => void recoverRecording(recording, recoverable)}>Recover recording</button>}{recording.status === "recording" && <button className="secondary" onClick={() => s.setTab("chat")}>Go to Project</button>}<button className="mini danger-text" title="Delete recording attempt" onClick={() => void deleteRecording(recording)}><Icon name="trash" size={12} /> Delete</button></div></article>;
          })}
          {!visibleRecordings.length && <div className="automation-empty"><Icon name="play.rectangle.on.rectangle.fill" size={28} /><strong>No recordings in this view</strong><span>Choose another filter or record a new browser task.</span></div>}
        </div>
      </section>}

      {section === "workflows" && <section className="automation-panel workflow-builder">
        <aside className="workflow-list"><div className="workflow-list-title"><span>Workflows</span><button className="mini" title="Create workflow" aria-label="Create workflow" onClick={() => void createWorkflow()}><Icon name="plus" size={12} /></button></div>{workflows.map((skill) => <button key={skill.id} className={skill.id === selectedWorkflowId ? "active" : ""} onClick={() => selectWorkflow(skill.id)}><Icon name="arrow.triangle.branch" size={14} /><span><strong>{skill.title}</strong><small>{skill.actions.length} steps · {skill.domain || "Any site"}</small></span></button>)}{!workflows.length && <p className="muted small">Record a run or create a workflow from a task.</p>}</aside>
        <div className="workflow-canvas">{draft ? <>
          <div className="workflow-editor-head"><div><input className="workflow-title-input" aria-label="Workflow name" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /><input className="workflow-domain-input" aria-label="Website domain" value={draft.domain} placeholder="example.com" onChange={(event) => setDraft({ ...draft, domain: event.target.value })} />{draftDirty && <small className="workflow-unsaved">Unsaved changes</small>}</div><div className="row"><button className="mini danger-text" onClick={() => void deleteWorkflow(draft)}>Delete</button><button className="secondary" onClick={() => void duplicateWorkflow(draft)}>Duplicate</button><button className="secondary" disabled={draftDirty || executionBusy || !!draftValidationError} title={draftDirty ? "Save changes before running" : draftValidationError || (executionBusy ? "Stop the running automation first" : "Run workflow")} onClick={() => void runWorkflow(draft)}>Run</button><button className="primary" disabled={saving || !draftDirty || !!draftValidationError || !!Object.keys(actionErrors).length} onClick={() => void saveDraft()}>{saving && <Spinner size={12} />} Save</button></div></div>
          <div className="workflow-builder-help"><strong>No code or page source needed.</strong><span>Choose what the browser should do. Targets are optional—the agent can find controls by their visible label or text and adapt when a page changes.</span></div>
          {draftValidationError && <div className="error automation-inline-error" role="alert">{draftValidationError}</div>}
          <label className="field-label">What should this workflow accomplish?<textarea value={draft.task} onChange={(event) => setDraft({ ...draft, task: event.target.value })} /></label>
          <div className="workflow-steps">{draft.actions.map((action, index) => <div className="workflow-step" key={`${index}-${action.tool}`}><div className="workflow-step-number">{index + 1}</div><div className="workflow-step-body"><select value={ACTION_OPTIONS.some(([value]) => value === action.tool) ? action.tool : "advanced"} aria-label={`Step ${index + 1} action`} onChange={(event) => { if (event.target.value !== "advanced") updateAction(index, "tool", event.target.value); }}><option value="advanced">{actionLabel(action.tool)}</option>{ACTION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            {["navigate", "open"].includes(action.tool) && <label>Page URL<input value={String(action.arguments.url || "")} placeholder="https://example.com/products" onChange={(event) => updateActionArgument(index, "url", event.target.value)} /></label>}
            {["input", "click"].includes(action.tool) && <label>Target on the page <small>Optional</small><input value={String(action.arguments.selector || "")} placeholder="Visible label, text, or CSS selector" onChange={(event) => updateActionArgument(index, "selector", event.target.value)} /></label>}
            {action.tool === "input" && <label>Text to enter<input value={String(action.arguments.text || "")} placeholder="Search phrase or {{input}}" onChange={(event) => updateActionArgument(index, "text", event.target.value)} /></label>}
            {action.tool === "press" && <label>Key<input value={String(action.arguments.key || "Enter")} placeholder="Enter" onChange={(event) => updateActionArgument(index, "key", event.target.value)} /></label>}
            {action.tool === "select" && <><label>Target on the page<input value={String(action.arguments.selector || "")} placeholder="Select label or CSS selector" onChange={(event) => updateActionArgument(index, "selector", event.target.value)} /></label><label>Option value<input value={String(action.arguments.value || "")} onChange={(event) => updateActionArgument(index, "value", event.target.value)} /></label></>}
            {action.tool === "wait" && <label>Wait for text or selector<input value={String(action.arguments.selector || action.arguments.text || "")} placeholder="Results loaded or .result-card" onChange={(event) => updateActionArgument(index, "selector", event.target.value)} /></label>}
            {action.tool === "act" && <><label>Interaction<input value={String(action.arguments.action || "click")} placeholder="click, type, or press" onChange={(event) => updateActionArgument(index, "action", event.target.value)} /></label><label>Target on the page <small>Optional</small><input value={String(action.arguments.selector || "")} placeholder="Visible label, text, or CSS selector" onChange={(event) => updateActionArgument(index, "selector", event.target.value)} /></label>{action.arguments.action === "type" && <label>Text to enter<input value={String(action.arguments.text || "")} onChange={(event) => updateActionArgument(index, "text", event.target.value)} /></label>}</>}
            {["extract", "paginate_extract"].includes(action.tool) && <><label>Results area <small>Optional</small><input value={String(action.arguments.container || "")} placeholder="Main content, product cards, table…" onChange={(event) => updateActionArgument(index, "container", event.target.value)} /></label><label>Data to collect<input value={Array.isArray(action.arguments.fields) ? action.arguments.fields.join(", ") : ""} placeholder="title, price, url" onChange={(event) => updateActionArgument(index, "fields", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} /></label></>}
            <details><summary>Advanced JSON</summary><textarea key={JSON.stringify(action.arguments)} defaultValue={JSON.stringify(action.arguments, null, 2)} aria-label={`Step ${index + 1} arguments`} onBlur={(event) => updateAction(index, "arguments", event.target.value)} /></details>{actionErrors[index] && <small className="error">{actionErrors[index]}</small>}</div><div className="workflow-step-actions"><button className="mini" disabled={index === 0} onClick={() => moveAction(index, -1)}>↑</button><button className="mini" disabled={index === draft.actions.length - 1} onClick={() => moveAction(index, 1)}>↓</button><button className="mini danger-text" onClick={() => removeAction(index)}>×</button></div></div>)}</div>
          <button className="secondary workflow-add-step" onClick={addAction}><Icon name="plus" size={13} /> Add browser step</button>
          <label className="field-label">Agent fallback instructions<textarea rows={6} value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} /></label>
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
