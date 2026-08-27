import { describe, expect, it, vi } from "vitest";
import {
  activeAutomationExecution,
  automationAgentAnswer,
  automationAgentBrowserActionCount,
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

  it("shows browser recovery instead of a false failure while the same profile restarts", () => {
    const deterministic = { ...execution, engine: "deterministic" as const };
    expect(executionWithRecipeProgress(deterministic, {
      executionId: "execution", phase: "failed", stepIndex: 0, total: 4, tool: "open",
      detail: "Step 1 failed", error: "list cdp targets: dial tcp: connection refused",
    })).toMatchObject({
      phase: "preparing", failedStep: undefined,
      detail: "The browser was closed. Reopening the selected profile and retrying once…",
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
    expect(automationAgentBrowserActionCount(execution, [noisy])).toBe(1);
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

  it("binds AI repair progress to its exact reply even when the saved title changed", () => {
    const renamed = conversation("done", 2);
    renamed.messages[0].commandChip = { kind: "skill", title: "Stale server title" };
    renamed.messages[1].id = "repair-reply";
    expect(automationAgentAnswer({ ...execution, replyId: "repair-reply", workflowTitle: "Fresh edited title" }, [renamed])?.id).toBe("repair-reply");
  });

  it("does not accept AI repair until its expected artifact is verified", () => {
    const repair = { ...execution, engine: "agent" as const, expectedArtifactName: "expected.json", repairValidationRequired: true };
    expect(automationExecutionView(repair, [conversation("done", 4)], 150)).toMatchObject({
      phase: "running", progress: 95, detail: "Validating the repaired Artifact Center output…",
    });
    expect(automationExecutionView({ ...repair, outputValidated: true }, [conversation("done", 4)], 150)).toMatchObject({ phase: "completed" });
    expect(automationExecutionView({ ...repair, outputValidated: true, detail: "AI repaired the fast path." }, [conversation("done", 4)], 150)).toMatchObject({ phase: "completed", detail: "AI repaired the fast path." });
    expect(automationExecutionView({ ...repair, outputValidationError: "Expected artifact missing" }, [conversation("done", 4)], 150)).toMatchObject({ phase: "failed", detail: "Expected artifact missing" });
  });

  it("preserves an AI repair launch failure instead of saying the agent is still starting", () => {
    const failed = {
      ...execution,
      engine: "agent" as const,
      phase: "failed" as const,
      detail: "The AI repair run could not be started.",
      error: "The AI repair run could not be started.",
    };
    expect(automationExecutionView(failed, [], 500)).toEqual({
      phase: "failed",
      progress: 100,
      detail: "The AI repair run could not be started.",
    });
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

  it("turns a run left by a closed app session into a clear retryable failure", () => {
    const local = new Map<string, string>([["automationRecordingPlayback", JSON.stringify({ ...execution, engine: "deterministic" })]]);
    const session = new Map<string, string>();
    const storage = (values: Map<string, string>) => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    vi.stubGlobal("localStorage", storage(local));
    vi.stubGlobal("sessionStorage", storage(session));
    try {
      expect(activeAutomationExecution()).toMatchObject({
        phase: "failed",
        progress: 100,
        detail: expect.stringContaining("interrupted when NextBrowser closed"),
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
