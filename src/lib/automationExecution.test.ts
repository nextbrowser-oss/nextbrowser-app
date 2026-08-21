import { describe, expect, it } from "vitest";
import { automationExecutionView, type AutomationExecution } from "./automationExecution";
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
  it("reports action-based progress while a workflow runs", () => {
    expect(automationExecutionView(execution, [conversation("streaming", 2)], 150)).toMatchObject({ phase: "running", progress: 55 });
  });

  it("reports completion from the owning agent reply", () => {
    expect(automationExecutionView(execution, [conversation("done", 4)], 150)).toMatchObject({ phase: "completed", progress: 100 });
  });

  it("keeps a visible stopping state until the agent confirms cancellation", () => {
    expect(automationExecutionView({ ...execution, phase: "stopping" }, [conversation("streaming", 1)], 150)).toMatchObject({ phase: "stopping" });
    expect(automationExecutionView({ ...execution, phase: "stopping" }, [conversation("cancelled", 1)], 150)).toMatchObject({ phase: "failed", detail: "Execution stopped." });
  });
});
