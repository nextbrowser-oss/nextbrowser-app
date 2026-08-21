import type { ChatMessage, Conversation } from "../types";

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
  phase: "preparing" | "running" | "stopping";
};

export type AutomationExecutionView = {
  phase: "preparing" | "running" | "stopping" | "completed" | "failed" | "cancelled";
  progress: number;
  detail: string;
};

const STATE_KEY = "automationRecordingPlayback";
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
    return {
      ...value,
      executionId: value.executionId || `${sourceId}-${value.startedAt}`,
      sourceId,
      sourceKind: value.sourceKind === "workflow" ? "workflow" : "recording",
      phase: ["preparing", "running", "stopping"].includes(value.phase) ? value.phase : "running",
    } as AutomationExecution;
  } catch { return undefined; }
}

export function setActiveAutomationExecution(execution: AutomationExecution) {
  localStorage.setItem(STATE_KEY, JSON.stringify(execution));
  window.dispatchEvent(new CustomEvent(AUTOMATION_EXECUTION_EVENT, { detail: execution }));
}

export function clearActiveAutomationExecution() {
  localStorage.removeItem(STATE_KEY);
  window.dispatchEvent(new CustomEvent(AUTOMATION_EXECUTION_EVENT));
}

export function automationExecutionView(execution: AutomationExecution, conversations: Conversation[], now = Date.now()): AutomationExecutionView {
  let answer: ChatMessage | undefined;
  for (const conversation of conversations) {
    if (conversation.workspaceId && conversation.workspaceId !== execution.workspaceId) continue;
    const taskIndex = conversation.messages.findIndex((message) => message.role === "user" && message.createdAt >= execution.startedAt && (message.commandChip?.title === execution.workflowTitle || message.text.includes(execution.task)));
    if (taskIndex >= 0) answer = conversation.messages.slice(taskIndex + 1).find((message) => message.role === "assistant");
    if (answer) break;
  }
  if (answer?.status === "cancelled") return { phase: "cancelled", progress: 100, detail: "Execution stopped." };
  if (["failed", "timedOut"].includes(answer?.status || "")) return { phase: "failed", progress: 100, detail: answer?.text || "The workflow could not complete." };
  if (answer?.status === "done") return { phase: "completed", progress: 100, detail: "Workflow completed successfully." };
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
