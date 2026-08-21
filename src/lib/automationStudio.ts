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
}

function runEvidence(answer: ChatMessage): string {
  const trace = (answer.toolEvents ?? []).map((event) =>
    `Called ${event.name}${event.detail ? `(${event.detail})` : ""}`,
  ).join("\n");
  return [trace, answer.text].filter(Boolean).join("\n");
}

export function capturedRuns(conversations: Conversation[]): CapturedRun[] {
  const runs: CapturedRun[] = [];
  for (const conversation of conversations) {
    for (let index = 0; index < conversation.messages.length - 1; index += 1) {
      const task = conversation.messages[index];
      const answer = conversation.messages[index + 1];
      if (task.role !== "user" || answer.role !== "assistant" || answer.status !== "done") continue;
      const evidence = runEvidence(answer);
      if (!/(?:clawbrowser|nextbrowser)\.[a-z_]+\s*\(/i.test(evidence)) continue;
      runs.push({ id: answer.id, task: task.text, answer, evidence, conversationTitle: conversation.title });
    }
  }
  return runs.sort((a, b) => b.answer.createdAt - a.answer.createdAt);
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
