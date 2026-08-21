import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { invoke } from "../electronBridge";
import { uid } from "../lib/ids";
import {
  capturedWorkflowDomain,
  workflowQuality,
  workflowRecipe,
} from "../lib/workflowCapture";
import { capturedRuns, skillFromRun, type CapturedRun } from "../lib/automationStudio";
import type { AutomationArtifact, BrowserWorkflowAction, BrowserWorkflowSkill } from "../types";
import { humanBytes } from "../types";
import { Icon, Spinner } from "./Icon";

type StudioSection = "recorder" | "workflows" | "artifacts";
type BackendRecording = { id: string; status: string; revision: number; document: { run?: CapturedRun; started_at?: string }; updated_at: string };

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
  const [studioError, setStudioError] = useState<string>();
  const [artifacts, setArtifacts] = useState<AutomationArtifact[]>([]);
  const [artifactBusy, setArtifactBusy] = useState(false);
  const [artifactError, setArtifactError] = useState<string>();
  const workspaceId = s.activeWorkspaceId || "";
  const runs = useMemo(() => capturedRuns(s.conversations).slice(0, 12), [s.conversations]);
  const recordedRun = recordingSince > 0 ? runs.find((run) => run.answer.createdAt >= recordingSince) : undefined;

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

  const loadRecordings = async () => {
    if (!workspaceId) return setRecordings([]);
    try { setRecordings(await invoke<BackendRecording[]>("automation_recordings_list", { workspaceId })); }
    catch (error) { setStudioError(error instanceof Error ? error.message : String(error)); }
  };

  useEffect(() => { void loadRecordings(); }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    void invoke("automation_seed_examples", { workspaceId })
      .then(() => Promise.all([loadWorkflows(), loadRecordings(), loadArtifacts()]))
      .catch((error) => setStudioError(error instanceof Error ? error.message : String(error)));
  }, [workspaceId]);

  useEffect(() => {
    const id = localStorage.getItem("automationRecordingId");
    if (!id || !recordedRun || recordings.some((item) => item.id === id && item.status === "completed")) return;
    void invoke("automation_recording_put", { recording: { id, workspace_id: workspaceId, status: "completed", document: { run: recordedRun }, base_revision: 1 } })
      .then(loadRecordings)
      .catch((error) => setStudioError(error instanceof Error ? error.message : String(error)));
  }, [recordedRun, recordings, workspaceId]);

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

  useEffect(() => { if (section === "artifacts") void loadArtifacts(); }, [section, workspaceId]);

  const startRecording = async () => {
    if (!workspaceId) return setStudioError("Create or select a workspace before recording.");
    const startedAt = Date.now();
    const id = uid();
    localStorage.setItem("automationRecordingSince", String(startedAt));
    localStorage.setItem("automationRecordingId", id);
    setRecordingSince(startedAt);
    const recording = await invoke<BackendRecording>("automation_recording_put", { recording: { id, workspace_id: workspaceId, status: "recording", document: { started_at: new Date(startedAt).toISOString() }, base_revision: 0 } });
    setRecordings((current) => [recording, ...current]);
    s.setTab("chat");
  };

  const saveCapture = async (run: CapturedRun) => {
    const saved = await invoke<BrowserWorkflowSkill>("automation_workflow_put", { workspaceId, workflow: skillFromRun(run) });
    localStorage.removeItem("automationRecordingSince");
    localStorage.removeItem("automationRecordingId");
    setRecordingSince(0);
    await loadWorkflows();
    setSelectedWorkflowId(saved.id);
    setSection("workflows");
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

  const moveAction = (index: number, direction: -1 | 1) => {
    if (!draft) return;
    const target = index + direction;
    if (target < 0 || target >= draft.actions.length) return;
    const actions = [...draft.actions];
    [actions[index], actions[target]] = [actions[target], actions[index]];
    setDraft({ ...draft, actions, recipe: { ...draft.recipe, actions } });
  };

  const removeAction = (index: number) => {
    if (!draft) return;
    const actions = draft.actions.filter((_, candidate) => candidate !== index);
    setDraft({ ...draft, actions, recipe: { ...draft.recipe, actions } });
  };

  const addAction = () => {
    if (!draft) return;
    const action: BrowserWorkflowAction = { tool: "navigate", arguments: { url: draft.domain ? `https://${draft.domain}` : "https://example.com" } };
    const actions = [...draft.actions, action];
    setDraft({ ...draft, actions, recipe: { ...draft.recipe, actions } });
  };

  const saveDraft = async () => {
    if (!draft || Object.keys(actionErrors).length) return;
    setSaving(true);
    try {
      const saved = await invoke<BrowserWorkflowSkill>("automation_workflow_put", { workspaceId, workflow: { ...draft, recipe: { ...draft.recipe, actions: draft.actions } } });
      setWorkflows((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current]);
      setDraft(saved);
    }
    finally { setSaving(false); }
  };

  const createWorkflow = async () => {
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
    const saved = await invoke<BrowserWorkflowSkill>("automation_workflow_put", { workspaceId, workflow });
    setWorkflows((current) => [saved, ...current]);
    setSelectedWorkflowId(saved.id);
  };

  const runWorkflow = async (workflow: BrowserWorkflowSkill) => {
    const runId = uid();
    await invoke("automation_run_create", { run: { id: runId, workspace_id: workspaceId, workflow_id: workflow.id, input: { task: workflow.task } } });
    await invoke("automation_run_update", { id: runId, update: { status: "running", output: {} } });
    s.runLocalSkill(workflow);
  };

  const importArtifacts = async () => {
    setArtifactBusy(true);
    setArtifactError(undefined);
    try { setArtifacts(await invoke<AutomationArtifact[]>("artifact_import", { workspaceId })); }
    catch (error) { setArtifactError(error instanceof Error ? error.message : String(error)); }
    finally { setArtifactBusy(false); }
  };

  return (
    <div className="automation-studio page">
      <header className="automation-hero">
        <div><span className="eyebrow">Automation Studio</span><h1>Record, build, and collect</h1><p>Turn successful browser runs into repeatable workflows and keep their files with the workspace.</p></div>
        <div className="automation-summary"><strong>{workflows.length}</strong><span>workflows</span><strong>{artifacts.length}</strong><span>artifacts</span></div>
      </header>
      <div className="automation-sections" role="tablist">
        {(["recorder", "workflows", "artifacts"] as StudioSection[]).map((item) => (
          <button key={item} className={section === item ? "active" : ""} onClick={() => setSection(item)}>
            <Icon name={item === "recorder" ? "play.rectangle.on.rectangle.fill" : item === "workflows" ? "arrow.triangle.branch" : "tray.full.fill"} size={15} />
            {item === "recorder" ? "Recorder" : item === "workflows" ? "Workflow Builder" : "Artifact Center"}
          </button>
        ))}
      </div>

      {section === "recorder" && <section className="automation-panel">
        <div className="automation-panel-head"><div><h2>Browser Automation Recorder</h2><p>Capture semantic browser tool calls from the next agent run.</p></div>
          <button className="primary" onClick={() => void startRecording()}><Icon name="circle.fill" size={12} /> {recordingSince ? "Record another run" : "Record next run"}</button>
        </div>
        {recordingSince > 0 && <div className="recording-banner"><span className="recording-dot" />{recordedRun ? "Run captured — review and save it below." : "Recording is armed. Complete a browser task in Project, then return here."}</div>}
        <div className="capture-list">
          {recordings.filter((item) => item.document.run).map((recording) => recording.document.run!).map((run) => {
            const domain = capturedWorkflowDomain(run.task, run.evidence);
            const quality = workflowQuality(run.task, run.evidence, domain);
            const actions = workflowRecipe(run.task, run.evidence).actions;
            return <article className={"capture-card" + (recordedRun?.id === run.id ? " is-new" : "")} key={run.id}>
              <div className="capture-card-copy"><strong>{run.task.slice(0, 120)}</strong><span>{run.conversationTitle} · {domain || "Unknown website"} · {actions.length} actions</span><small className={quality.reusable ? "ok" : "muted"}>{quality.reason}</small></div>
              <button className="btn-bordered-prominent" disabled={!quality.reusable} onClick={() => void saveCapture(run)}>Save workflow</button>
            </article>;
          })}
          {!recordings.some((item) => item.document.run) && <div className="automation-empty"><Icon name="play.rectangle.on.rectangle.fill" size={28} /><strong>No browser runs captured yet</strong><span>Record a task that navigates, interacts with, or extracts from a website.</span></div>}
        </div>
      </section>}

      {section === "workflows" && <section className="automation-panel workflow-builder">
        <aside className="workflow-list"><div className="workflow-list-title"><span>Workflows</span><button className="mini" title="Create workflow" aria-label="Create workflow" onClick={() => void createWorkflow()}><Icon name="plus" size={12} /></button></div>{workflows.map((skill) => <button key={skill.id} className={skill.id === selectedWorkflowId ? "active" : ""} onClick={() => setSelectedWorkflowId(skill.id)}><Icon name="arrow.triangle.branch" size={14} /><span><strong>{skill.title}</strong><small>{skill.actions.length} steps · {skill.domain || "Any site"}</small></span></button>)}{!workflows.length && <p className="muted small">Record a run or create a workflow from a task.</p>}</aside>
        <div className="workflow-canvas">{draft ? <>
          <div className="workflow-editor-head"><div><input className="workflow-title-input" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /><input className="workflow-domain-input" value={draft.domain} placeholder="example.com" onChange={(event) => setDraft({ ...draft, domain: event.target.value })} /></div><div className="row"><button className="secondary" onClick={() => void runWorkflow(draft)}>Run</button><button className="primary" disabled={saving || !!Object.keys(actionErrors).length} onClick={() => void saveDraft()}>{saving && <Spinner size={12} />} Save</button></div></div>
          <label className="field-label">Task template<textarea value={draft.task} onChange={(event) => setDraft({ ...draft, task: event.target.value })} /></label>
          <div className="workflow-steps">{draft.actions.map((action, index) => <div className="workflow-step" key={`${index}-${action.tool}`}><div className="workflow-step-number">{index + 1}</div><div className="workflow-step-body"><input value={action.tool} aria-label={`Step ${index + 1} tool`} onChange={(event) => updateAction(index, "tool", event.target.value)} /><textarea defaultValue={JSON.stringify(action.arguments, null, 2)} aria-label={`Step ${index + 1} arguments`} onBlur={(event) => updateAction(index, "arguments", event.target.value)} />{actionErrors[index] && <small className="error">{actionErrors[index]}</small>}</div><div className="workflow-step-actions"><button className="mini" disabled={index === 0} onClick={() => moveAction(index, -1)}>↑</button><button className="mini" disabled={index === draft.actions.length - 1} onClick={() => moveAction(index, 1)}>↓</button><button className="mini danger-text" onClick={() => removeAction(index)}>×</button></div></div>)}</div>
          <button className="secondary workflow-add-step" onClick={addAction}><Icon name="plus" size={13} /> Add browser step</button>
          <label className="field-label">Agent fallback instructions<textarea rows={6} value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} /></label>
        </> : <div className="automation-empty"><Icon name="arrow.triangle.branch" size={28} /><strong>Select or record a workflow</strong></div>}</div>
      </section>}

      {section === "artifacts" && <section className="automation-panel">
        <div className="automation-panel-head"><div><h2>Artifact Center</h2><p>Files are copied into this workspace and remain available across chats.</p></div><button className="primary" disabled={artifactBusy} onClick={() => void importArtifacts()}>{artifactBusy ? <Spinner size={13} /> : <Icon name="plus" size={13} />} Add files</button></div>
        {(artifactError || studioError) && <div className="error automation-inline-error">{artifactError || studioError}</div>}
        <div className="artifact-grid">{artifacts.map((artifact) => <article className="artifact-card" key={artifact.id}><div className="artifact-icon"><Icon name="doc" size={22} /></div><div className="artifact-copy"><strong title={artifact.name}>{artifact.name}</strong><span>{artifact.extension.toUpperCase() || "FILE"} · {humanBytes(artifact.size)}</span><small>{new Date(artifact.createdAt).toLocaleString()}</small></div><div className="artifact-actions"><button className="secondary" onClick={() => void invoke("artifact_open", { id: artifact.id, name: artifact.name })}>Open</button><button className="mini danger-text" onClick={() => { if (window.confirm(`Delete ${artifact.name} from this workspace?`)) void invoke("artifact_delete", { id: artifact.id }).then(loadArtifacts); }}>Delete</button></div></article>)}{!artifactBusy && !artifacts.length && <div className="automation-empty"><Icon name="tray.full.fill" size={28} /><strong>No artifacts in this workspace</strong><span>Add reports, downloads, screenshots, spreadsheets, or other run outputs.</span></div>}</div>
      </section>}
    </div>
  );
}
