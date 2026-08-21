import { uid } from "./ids";
import {
  capturedWorkflowDomain,
  workflowCapability,
  workflowInstructions,
  workflowRecipe,
  workflowTitle,
} from "./workflowCapture";
import type { BrowserWorkflowSkill, ChatMessage, Conversation } from "../types";

export interface CapturedRun {
  id: string;
  task: string;
  answer: ChatMessage;
  evidence: string;
  conversationTitle: string;
  captureSource?: "tool-trace" | "structured-recipe";
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

export function skillFromRun(run: CapturedRun): BrowserWorkflowSkill {
  const domain = capturedWorkflowDomain(run.task, run.evidence);
  const capability = workflowCapability(run.task, run.evidence);
  const recipe = workflowRecipe(run.task, run.evidence);
  return {
    id: uid(), title: workflowTitle(run.task, domain), domain, task: run.task,
    instructions: workflowInstructions(run.task, run.evidence), actions: recipe.actions,
    capability, parametersSchema: { type: "object", properties: { task: { type: "string", default: run.task } } },
    outputSchema: { type: "object", properties: { success: { type: "boolean" }, results: { type: "array" } } },
    recipe, createdAt: Date.now(), updatedAt: Date.now(),
  };
}
