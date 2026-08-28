import type { BrowserWorkflowSkill, ChatMessage, Conversation } from "../types";

export type AutomationExecution = {
  executionId: string;
  sourceId: string;
  sourceKind: "recording" | "workflow";
  backendRunId?: string;
  replyId?: string;
  workspaceId: string;
  workflowTitle: string;
  task: string;
  startedAt: number;
  expectedActions: number;
  actionTools?: string[];
  engine?: "deterministic" | "agent";
  phase: "preparing" | "running" | "stopping" | "completed" | "failed" | "cancelled";
  completedActions?: number;
  progress?: number;
  detail?: string;
  error?: string;
  failedStep?: number;
  autoRepairAttempted?: boolean;
  expectedArtifactName?: string;
  outputValidated?: boolean;
  outputValidationError?: string;
  repairValidationRequired?: boolean;
  repairPersisted?: boolean;
  repairPersistenceError?: string;
  repairAttempt?: number;
  workflowSnapshot?: BrowserWorkflowSkill;
};

export function automationAgentBrowserActionCount(execution: AutomationExecution, conversations: Conversation[]) {
  const answer = automationAgentAnswer(execution, conversations);
  return (answer?.toolEvents || []).filter((event) => /^(?:clawbrowser|nextbrowser)\.(?:open|wait|click|input|press|select|scroll|dismiss|upload|extract|paginate_extract|tabs_extract|form_fill|multi_action|site_recipe_run|act|evaluate|save_artifact)$/.test(event.name)).length;
}

export type AutomationExecutionView = {
  phase: "preparing" | "running" | "stopping" | "completed" | "failed" | "cancelled";
  progress: number;
  detail: string;
};

export type AutomationRecipeProgress = {
  executionId: string;
  phase: "preparing" | "running" | "completed" | "failed" | "cancelled";
  stepIndex: number;
  total: number;
  tool?: string;
  detail: string;
  error?: string;
};

const STATE_KEY = "automationRecordingPlayback";
const SESSION_KEY = "nextbrowser:automation-execution-session";
export const AUTOMATION_EXECUTION_EVENT = "nextbrowser:automation-execution-change";
const PROGRESS_TOOLS = new Set([
  "open", "navigate", "click", "input", "press", "select", "scroll", "dismiss", "wait", "act",
  "multi_action", "form_fill", "upload", "extract", "paginate_extract", "tabs_extract", "site_recipe_run",
]);

export function activeAutomationExecution(): AutomationExecution | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(STATE_KEY) || "null");
    const sourceId = value?.sourceId || value?.recordingId;
    if (!sourceId || !value?.workspaceId || !value?.startedAt) return undefined;
    const execution = {
      ...value,
      executionId: value.executionId || `${sourceId}-${value.startedAt}`,
      sourceId,
      sourceKind: value.sourceKind === "workflow" ? "workflow" : "recording",
      phase: ["preparing", "running", "stopping", "completed", "failed", "cancelled"].includes(value.phase) ? value.phase : "running",
    } as AutomationExecution;
    if (!["completed", "failed", "cancelled"].includes(execution.phase)
      && sessionStorage.getItem(SESSION_KEY) !== execution.executionId) {
      const interrupted: AutomationExecution = {
        ...execution,
        phase: "failed",
        progress: 100,
        detail: "This automation was interrupted when NextBrowser closed. Run it again to restart from the beginning.",
        error: "The previous app session ended before automation completed.",
      };
      localStorage.setItem(STATE_KEY, JSON.stringify(interrupted));
      return interrupted;
    }
    return execution;
  } catch { return undefined; }
}

export function setActiveAutomationExecution(execution: AutomationExecution) {
  localStorage.setItem(STATE_KEY, JSON.stringify(execution));
  sessionStorage.setItem(SESSION_KEY, execution.executionId);
  window.dispatchEvent(new CustomEvent(AUTOMATION_EXECUTION_EVENT, { detail: execution }));
}

export function clearActiveAutomationExecution() {
  localStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new CustomEvent(AUTOMATION_EXECUTION_EVENT));
}

export function executionWithRecipeProgress(execution: AutomationExecution, update: AutomationRecipeProgress): AutomationExecution {
  if (execution.executionId !== update.executionId || execution.engine !== "deterministic") return execution;
  const browserSessionLost = update.phase === "failed" && /(?:list cdp targets|session .*not found|connection refused|CDP became reachable|browser (?:process )?(?:closed|exited)|target closed)/i.test(update.error || update.detail);
  const completedActions = Math.max(0, Math.min(update.total, update.stepIndex));
  return {
    ...execution,
    phase: browserSessionLost ? "preparing" : update.phase,
    expectedActions: update.total,
    completedActions,
    progress: update.phase === "completed"
      ? 100
      : update.phase === "preparing" ? 8 : Math.max(12, Math.round(completedActions / Math.max(1, update.total) * 100)),
    detail: browserSessionLost ? "The browser was closed. Reopening the selected profile and retrying once…" : update.detail,
    error: update.error,
    failedStep: update.phase === "failed" && !browserSessionLost ? update.stepIndex : undefined,
  };
}

export function automationAgentAnswer(execution: AutomationExecution, conversations: Conversation[]): ChatMessage | undefined {
  for (const conversation of conversations) {
    if (conversation.workspaceId && conversation.workspaceId !== execution.workspaceId) continue;
    if (execution.replyId) {
      const exact = conversation.messages.find((message) => message.role === "assistant" && message.id === execution.replyId);
      if (exact) return exact;
    }
    const taskIndex = conversation.messages.findIndex((message) => message.role === "user" && message.createdAt >= execution.startedAt && (message.commandChip?.title === execution.workflowTitle || message.text.includes(execution.task)));
    if (taskIndex >= 0) {
      const answer = conversation.messages.slice(taskIndex + 1).find((message) => message.role === "assistant");
      if (answer) return answer;
    }
  }
  return undefined;
}

export function automationExecutionView(execution: AutomationExecution, conversations: Conversation[], now = Date.now()): AutomationExecutionView {
  if (execution.engine === "deterministic") {
    const completed = execution.completedActions || 0;
    const progress = execution.progress ?? (execution.phase === "preparing" ? 8 : Math.min(100, Math.round(completed / Math.max(1, execution.expectedActions) * 100)));
    return { phase: execution.phase, progress, detail: execution.detail || (execution.phase === "preparing" ? "Preparing the browser session…" : "Running the saved browser steps…") };
  }
  const answer = automationAgentAnswer(execution, conversations);
  if (!answer && execution.phase === "failed") {
    return { phase: "failed", progress: 100, detail: execution.detail || execution.error || "The workflow could not start." };
  }
  if (!answer && execution.phase === "cancelled") {
    return { phase: "cancelled", progress: 100, detail: execution.detail || "Execution stopped." };
  }
  if (answer?.status === "cancelled") return { phase: "cancelled", progress: 100, detail: "Execution stopped." };
  if (["failed", "timedOut"].includes(answer?.status || "")) return { phase: "failed", progress: 100, detail: answer?.text || "The workflow could not complete." };
  if (answer?.status === "done") {
    if (execution.outputValidationError) return { phase: "failed", progress: 100, detail: execution.outputValidationError };
    if (execution.repairValidationRequired && !execution.outputValidated) return { phase: "running", progress: 95, detail: execution.expectedArtifactName ? "Validating the repaired Artifact Center output…" : "Validating and saving the repaired fast path…" };
    return { phase: "completed", progress: 100, detail: execution.detail || "Workflow completed successfully." };
  }
  const expectedTools = execution.actionTools?.length ? new Set(execution.actionTools) : PROGRESS_TOOLS;
  const actions = (answer?.toolEvents || []).filter((event) => {
    const match = event.name.match(/^(?:clawbrowser|nextbrowser)\.(.+)$/);
    return !!match && PROGRESS_TOOLS.has(match[1]) && expectedTools.has(match[1]);
  }).length;
  const elapsedProgress = Math.min(65, 20 + Math.floor(Math.max(0, now - execution.startedAt) / 10_000) * 5);
  const progress = answer ? Math.min(90, Math.max(elapsedProgress, 20 + Math.round(actions / Math.max(1, execution.expectedActions) * 70))) : execution.phase === "preparing" ? 8 : 15;
  if (execution.phase === "stopping") return { phase: "stopping", progress: Math.max(15, progress), detail: "Stopping the active agent and browser task…" };
  if (answer) return { phase: "running", progress, detail: answer.activityLabel || (actions ? `${actions} browser action${actions === 1 ? "" : "s"} completed` : "The agent is working on the browser task…") };
  if (now - execution.startedAt > 120_000) return { phase: "failed", progress: 100, detail: "The workflow did not start within two minutes. Check the selected agent and browser profile." };
  return { phase: execution.phase, progress, detail: execution.phase === "preparing" ? "Preparing the browser session…" : "Waiting for the agent to begin…" };
}
