import { uid } from "./ids";
import {
  capturedWorkflowDomain,
  rawRecordedBrowserActions,
  workflowCapability,
  workflowInstructions,
  workflowRecipe,
  workflowTitle,
} from "./workflowCapture";
import type { BrowserWorkflowAction, BrowserWorkflowSkill, ChatMessage, Conversation } from "../types";

export interface CapturedRun {
  id: string;
  task: string;
  answer: ChatMessage;
  evidence: string;
  conversationTitle: string;
  captureSource?: "tool-trace" | "structured-recipe" | "manual" | "hybrid";
}

export interface ManualBrowserRecording {
  actions: Array<{ tool: string; arguments: Record<string, unknown>; at?: number }>;
  url?: string;
  title?: string;
  stoppedAt?: number;
  error?: string;
}

export function capturedRunFromManualRecording(id: string, recording: ManualBrowserRecording): CapturedRun | undefined {
  if (!recording.actions.length) return undefined;
  const stoppedAt = recording.stoppedAt || Date.now();
  let domain = "browser";
  try { domain = new URL(recording.url || "").hostname || domain; } catch { /* keep generic title */ }
  const task = `Replay the recorded browser actions on ${domain}.`;
  const evidence = recording.actions.map((action) => `Called clawbrowser.${action.tool}(${JSON.stringify(action.arguments)})\n{"ok":true}`).join("\n");
  return {
    id,
    task,
    answer: {
      id,
      role: "assistant",
      text: `Recorded ${recording.actions.length} manual browser action${recording.actions.length === 1 ? "" : "s"}.`,
      status: "done",
      createdAt: stoppedAt,
      toolEvents: recording.actions.map((action, index) => ({
        id: `${id}-${index}`,
        name: `clawbrowser.${action.tool}`,
        detail: JSON.stringify(action.arguments),
        createdAt: stoppedAt,
      })),
    },
    evidence,
    conversationTitle: recording.title || `Manual recording — ${domain}`,
    captureSource: "manual",
  };
}

const PAGE_EVENT_TOOLS = new Set(["open", "navigate", "click", "input", "press", "select", "scroll"]);

function normalizedRecordedTool(tool: string) {
  const clean = tool.replace(/^(?:clawbrowser|nextbrowser)\./, "");
  return clean === "navigate" ? "open" : clean;
}

/** Merge page events with agent tool traces, preferring the page event when both describe the same action. */
export function capturedRunFromHybridRecording(id: string, recording: ManualBrowserRecording, agentRun?: CapturedRun): CapturedRun | undefined {
  const manual = recording.actions.map((action, index) => ({
    tool: normalizedRecordedTool(action.tool), arguments: action.arguments, at: action.at || index,
  }));
  if (!agentRun) return capturedRunFromManualRecording(id, { ...recording, actions: manual });
  if (!manual.length) return agentRun;

  const events = agentRun.answer.toolEvents || [];
  const usedEvents = new Set<number>();
  const agent = rawRecordedBrowserActions(agentRun.evidence).map((action, index) => {
    const tool = normalizedRecordedTool(action.tool);
    const eventIndex = events.findIndex((event, candidate) => !usedEvents.has(candidate) && normalizedRecordedTool(event.name) === tool);
    if (eventIndex >= 0) usedEvents.add(eventIndex);
    return { tool, arguments: action.arguments, at: events[eventIndex]?.createdAt || agentRun.answer.createdAt + index };
  });
  const matchedManual = new Set<number>();
  const agentOnly = agent.filter((action) => {
    if (!PAGE_EVENT_TOOLS.has(action.tool)) return true;
    const match = manual.findIndex((candidate, index) =>
      !matchedManual.has(index) && candidate.tool === action.tool && Math.abs(candidate.at - action.at) <= 3_000,
    );
    if (match < 0) return true;
    matchedManual.add(match);
    return false;
  });
  const mergedActions = [...manual, ...agentOnly]
    .sort((left, right) => left.at - right.at)
    .reduce<typeof manual>((kept, action) => {
      const previous = kept.at(-1);
      // Recorder observes the page that was already open when Start was pressed,
      // then the agent may explicitly open that same URL. Replaying both is noisy
      // and can restart a dynamic page before extraction.
      if (action.tool === "open" && previous?.tool === "open"
        && String(previous.arguments.url || "") === String(action.arguments.url || "")) return kept;
      kept.push(action);
      return kept;
    }, []);
  const requestedArtifact = artifactActionFromTask(agentRun.task);
  if (requestedArtifact && !mergedActions.some((action) => action.tool === "save_artifact")) {
    mergedActions.push({ ...requestedArtifact, at: (mergedActions.at(-1)?.at || agentRun.answer.createdAt) + 1 });
  }
  const actions = mergedActions.slice(0, 100).map(({ tool, arguments: arguments_ }) => ({ tool, arguments: arguments_ }));
  const merged = capturedRunFromManualRecording(id, { ...recording, actions });
  if (!merged) return agentRun;
  return {
    ...merged,
    task: agentRun.task,
    conversationTitle: agentRun.conversationTitle,
    captureSource: "hybrid",
  };
}

const SENSITIVE_KEY = /^(?:password|passwd|passcode|secret|token|access_token|refresh_token|api[_-]?key|authorization|cookie|card[_-]?(?:number|no)|cvv|cvc)$/i;
const SENSITIVE_CONTEXT = /password|passcode|security code|credit.?card|card.?number|cvv|cvc|api.?key|auth(?:orization)? token/i;

function redactText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer {{redacted}}")
    .replace(/(["']?(?:password|passwd|passcode|secret|token|api[_-]?key|authorization|cookie|cvv|cvc)["']?\s*[:=]\s*["']?)[^\s,"'}&]+/gi, "$1{{redacted}}")
    .replace(/((?:password|passcode|security code|credit.?card|card.?number|cvv|cvc)[^\n]{0,80}?["'](?:text|value)["']\s*:\s*["'])[^"']+/gi, "$1{{redacted}}");
}

function redactValue(value: unknown, sensitiveContext = false): unknown {
  if (Array.isArray(value)) return value.map((item) => redactValue(item, sensitiveContext));
  if (!value || typeof value !== "object") return typeof value === "string" && sensitiveContext ? "{{redacted}}" : value;
  const source = value as Record<string, unknown>;
  const context = sensitiveContext || Object.entries(source).some(([key, item]) =>
    ["selector", "label", "name", "placeholder", "type"].includes(key) && typeof item === "string" && SENSITIVE_CONTEXT.test(item),
  );
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) || (context && ["text", "value"].includes(key)) ? "{{redacted}}" : redactValue(item, context),
  ]));
}

function sanitizeDetail(detail?: string): string | undefined {
  if (!detail) return detail;
  try { return JSON.stringify(redactValue(JSON.parse(detail))); }
  catch { return redactText(detail); }
}

export function sanitizedRecordedAnswer(answer: ChatMessage): ChatMessage {
  return {
    ...answer,
    text: redactText(answer.text),
    toolEvents: answer.toolEvents?.map((event) => ({ ...event, detail: sanitizeDetail(event.detail) })),
  };
}

function runEvidence(answer: ChatMessage): string {
  const trace = (answer.toolEvents ?? []).map((event) =>
    `Called ${event.name}${event.detail ? `(${event.detail})` : ""}`,
  ).join("\n");
  return [trace, answer.text].filter(Boolean).join("\n");
}

function embeddedRecipe(task: ChatMessage): { task: string; evidence: string } | undefined {
  if (task.commandChip?.kind !== "skill") return undefined;
  const taskMatch = task.text.match(/Task for this run:\s*\n([\s\S]*?)\n\nStructured recipe \(execute first\):/);
  const recipeMatch = task.text.match(/Structured recipe \(execute first\):\s*\n([\s\S]*?)\n\nWorkflow fallback:/);
  if (!taskMatch?.[1] || !recipeMatch?.[1]) return undefined;
  try {
    const recipe = JSON.parse(recipeMatch[1]) as { actions?: Array<{ tool?: unknown; arguments?: unknown }> };
    const actions = Array.isArray(recipe.actions) ? recipe.actions.filter((action) =>
      typeof action?.tool === "string" && action.arguments && typeof action.arguments === "object" && !Array.isArray(action.arguments),
    ) : [];
    if (!actions.length) return undefined;
    return {
      task: taskMatch[1].trim(),
      evidence: actions.map((action) => `Called clawbrowser.${action.tool}(${JSON.stringify(action.arguments)})\n{"ok":true}`).join("\n"),
    };
  } catch { return undefined; }
}

function successfulBrowserAnswer(answer: ChatMessage): boolean {
  return answer.status === "done" && !/^\s*(?:no (?:results?|products?|items?) (?:found|available)|could not|unable to|failed to|nothing (?:was )?found)\b/i.test(answer.text);
}

export function capturedRuns(conversations: Conversation[]): CapturedRun[] {
  const runs: CapturedRun[] = [];
  for (const conversation of conversations) {
    for (let index = 0; index < conversation.messages.length - 1; index += 1) {
      const task = conversation.messages[index];
      const answer = conversation.messages[index + 1];
      if (task.role !== "user" || answer.role !== "assistant" || !successfulBrowserAnswer(answer)) continue;
      const sanitizedAnswer = sanitizedRecordedAnswer(answer);
      const directEvidence = runEvidence(sanitizedAnswer);
      const recipe = embeddedRecipe({ ...task, text: redactText(task.text) });
      const evidence = /(?:clawbrowser|nextbrowser)\.[a-z_]+\s*\(/i.test(directEvidence)
        ? directEvidence
        : recipe ? `${recipe.evidence}\n${sanitizedAnswer.text}` : directEvidence;
      if (!/(?:clawbrowser|nextbrowser)\.[a-z_]+\s*\(/i.test(evidence)) continue;
      runs.push({
        id: answer.id,
        task: recipe?.task || redactText(task.text),
        answer: sanitizedAnswer,
        evidence,
        conversationTitle: conversation.title,
        captureSource: recipe && evidence !== directEvidence ? "structured-recipe" : "tool-trace",
      });
    }
  }
  return runs.sort((a, b) => b.answer.createdAt - a.answer.createdAt);
}

export function capturedRunsForRecording(
  conversations: Conversation[],
  recording: { workspaceId: string; agentId?: string; startedAt: number },
): CapturedRun[] {
  return capturedRuns(conversations.filter((conversation) =>
    (!conversation.workspaceId || conversation.workspaceId === recording.workspaceId)
      && (!recording.agentId || conversation.agent === recording.agentId),
  )).filter((run) => run.answer.createdAt >= recording.startedAt);
}

/**
 * Return the latest completed browser task even when the agent transport did
 * not expose structured tool calls. Hybrid recording still needs this run to
 * retain the user's real task/title instead of becoming a generic manual run.
 */
export function capturedTaskRunsForRecording(
  conversations: Conversation[],
  recording: { workspaceId: string; agentId?: string; startedAt: number },
): CapturedRun[] {
  const traced = new Map(capturedRunsForRecording(conversations, recording).map((run) => [run.id, run]));
  const runs: CapturedRun[] = [];
  for (const conversation of conversations) {
    if ((conversation.workspaceId && conversation.workspaceId !== recording.workspaceId)
      || (recording.agentId && conversation.agent !== recording.agentId)) continue;
    for (let index = 0; index < conversation.messages.length - 1; index += 1) {
      const task = conversation.messages[index];
      const answer = conversation.messages[index + 1];
      if (task.role !== "user" || answer.role !== "assistant" || !successfulBrowserAnswer(answer)
        || answer.createdAt < recording.startedAt) continue;
      const existing = traced.get(answer.id);
      if (existing) runs.push(existing);
      else {
        const sanitizedAnswer = sanitizedRecordedAnswer(answer);
        runs.push({
          id: answer.id,
          task: redactText(task.text),
          answer: sanitizedAnswer,
          evidence: runEvidence(sanitizedAnswer),
          conversationTitle: conversation.title,
        });
      }
    }
  }
  return runs.sort((a, b) => b.answer.createdAt - a.answer.createdAt);
}

export function artifactActionFromTask(task: string): BrowserWorkflowAction | undefined {
  const saveIntent = /(?:\bsave\b|\bexport\b|сохран(?:и|ить|яй)|экспорт(?:ируй|ировать)?)/i.test(task);
  const artifactIntent = /(?:artifact\s*center|артефакт(?:ный|ов)?\s*(?:центр|центре)?|\b(?:csv|json|txt)\b|\bfile\b|\bфайл\w*)/i.test(task);
  if (!saveIntent || !artifactIntent) return undefined;
  const format = /\bcsv\b/i.test(task) ? "csv" : /\btxt\b|текстов(?:ый|ом)/i.test(task) ? "txt" : "json";
  const explicitName = task.match(/(?:^|[\s"'«])([\p{L}\p{N}_.-]+\.(?:csv|json|txt))(?=$|[\s"'».,])/iu)?.[1];
  const name = explicitName || `workflow-result.${format}`;
  const source = /\b(?:all|every)\s+(?:workflow\s+)?results?\b|все\s+результат|весь\s+(?:ход|журнал)/i.test(task) ? "run_results" : "last_result";
  return { tool: "save_artifact", arguments: { source, format, name } };
}

export function skillFromRun(run: CapturedRun): BrowserWorkflowSkill {
  const domain = capturedWorkflowDomain(run.task, run.evidence);
  const capability = workflowCapability(run.task, run.evidence);
  const recipe = workflowRecipe(run.task, run.evidence);
  const artifactAction = artifactActionFromTask(run.task);
  const actions = artifactAction && !recipe.actions.some((action) => action.tool.replace(/^(?:clawbrowser|nextbrowser)\./, "") === "save_artifact")
    ? [...recipe.actions, artifactAction]
    : recipe.actions;
  return {
    id: uid(), title: workflowTitle(run.task, domain), domain, task: run.task,
    instructions: workflowInstructions(run.task, run.evidence), actions,
    capability, parametersSchema: { type: "object", properties: { task: { type: "string", default: run.task } } },
    outputSchema: { type: "object", properties: { success: { type: "boolean" }, results: { type: "array" } } },
    recipe: { ...recipe, actions }, createdAt: Date.now(), updatedAt: Date.now(),
  };
}
