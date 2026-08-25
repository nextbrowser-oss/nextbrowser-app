import { describe, expect, it } from "vitest";
import {
  automationExecutionView,
  executionWithRecipeProgress,
  type AutomationExecution,
} from "./automationExecution";
import type { Conversation } from "../types";

const execution: AutomationExecution = {
  executionId: "execution",
  sourceId: "workflow",
  sourceKind: "workflow",
  workspaceId: "workspace",
  workflowTitle: "Collect products",
  task: "Collect product cards",
  startedAt: 100,
  expectedActions: 4,
  phase: "running",
};

function conversation(status: "streaming" | "done" | "cancelled", toolEvents = 0): Conversation {
  return {
    id: "conversation", title: "Automation", agent: "codex", createdAt: 100, updatedAt: 200,
    messages: [
      { id: "task", role: "user", text: "Run it", status: "done", createdAt: 110, commandChip: { kind: "skill", title: execution.workflowTitle, detail: "example.com" } },
      { id: "answer", role: "assistant", text: status === "done" ? "Finished" : "", status, createdAt: 120, toolEvents: Array.from({ length: toolEvents }, (_, index) => ({ id: String(index), name: "clawbrowser.act", detail: "{}", createdAt: 120 + index })) },
    ],
  };
}

describe("automation execution indicator", () => {
  it("maps deterministic runner events to exact step progress", () => {
    const deterministic = { ...execution, engine: "deterministic" as const };
    const updated = executionWithRecipeProgress(deterministic, {
      executionId: "execution",
      phase: "running",
      stepIndex: 2,
      total: 4,
      tool: "extract",
      detail: "Step 3 of 4: extract",
    });

    expect(updated).toMatchObject({
      engine: "deterministic",
      completedActions: 2,
      expectedActions: 4,
      progress: 50,
      detail: "Step 3 of 4: extract",
    });
    expect(automationExecutionView(updated, [])).toMatchObject({
      phase: "running",
      progress: 50,
    });
  });

  it("ignores runner events belonging to another execution", () => {
    const deterministic = { ...execution, engine: "deterministic" as const };
    expect(executionWithRecipeProgress(deterministic, {
      executionId: "other",
      phase: "completed",
      stepIndex: 4,
      total: 4,
      detail: "Done",
    })).toBe(deterministic);
  });

  it("preserves the failed step and repair context", () => {
    const deterministic = { ...execution, engine: "deterministic" as const };
    expect(executionWithRecipeProgress(deterministic, {
      executionId: "execution",
      phase: "failed",
      stepIndex: 1,
      total: 4,
      tool: "click",
      detail: "Step 2 failed",
      error: "No matching element",
    })).toMatchObject({
      phase: "failed",
      failedStep: 1,
      progress: 25,
      error: "No matching element",
    });
  });

  it("reports action-based progress while a workflow runs", () => {
    expect(automationExecutionView(execution, [conversation("streaming", 2)], 150)).toMatchObject({ phase: "running", progress: 55 });
  });

  it("does not count browser setup and inspection noise as completed workflow steps", () => {
    const noisy = conversation("streaming", 0);
    noisy.messages[1].toolEvents = [
      { id: "start", name: "clawbrowser.start", detail: "{}", createdAt: 120 },
      { id: "state", name: "clawbrowser.state", detail: "{}", createdAt: 121 },
      { id: "action", name: "clawbrowser.act", detail: "{}", createdAt: 122 },
    ];
    expect(automationExecutionView(execution, [noisy], 150)).toMatchObject({ phase: "running", progress: 38, detail: "1 browser action completed" });
  });

  it("shows live agent activity and advances long-running indeterminate work", () => {
    const active = conversation("streaming", 0);
    active.messages[1].activityLabel = "Parsing data…";
    expect(automationExecutionView(execution, [active], 40_100)).toMatchObject({
      phase: "running", progress: 40, detail: "Parsing data…",
    });
  });

  it("reports completion from the owning agent reply", () => {
    expect(automationExecutionView(execution, [conversation("done", 4)], 150)).toMatchObject({ phase: "completed", progress: 100 });
  });

  it("keeps a visible stopping state until the agent confirms cancellation", () => {
    expect(automationExecutionView({ ...execution, phase: "stopping" }, [conversation("streaming", 1)], 150)).toMatchObject({ phase: "stopping" });
    expect(automationExecutionView({ ...execution, phase: "stopping" }, [conversation("cancelled", 1)], 150)).toMatchObject({ phase: "cancelled", detail: "Execution stopped." });
  });

  it("does not attach progress to a similarly named task in another workspace", () => {
    const other = conversation("done", 4);
    other.workspaceId = "other-workspace";
    expect(automationExecutionView(execution, [other], 150)).toMatchObject({ phase: "running", progress: 15 });
  });
});
