import { describe, expect, it } from "vitest";
import { artifactActionFromTask, capturedRunFromHybridRecording, capturedTaskRunsForRecording, skillFromRun, type CapturedRun, type ManualBrowserRecording } from "./automationStudio";
import { recordedBrowserActions } from "./workflowCapture";

function agentRun(): CapturedRun {
  return {
    id: "agent-run",
    task: "Collect the visible result after opening the page.",
    conversationTitle: "Agent task",
    captureSource: "tool-trace",
    evidence: [
      'Called clawbrowser.open({"url":"https://example.com"})',
      '{"ok":true}',
      'Called clawbrowser.click({"element_id":4})',
      '{"ok":true}',
      'Called clawbrowser.extract({"container":".result","fields":{"title":{"selector":"h2"}}})',
      '{"ok":true,"count":1}',
    ].join("\n"),
    answer: {
      id: "answer",
      role: "assistant",
      text: "Collected the result.",
      status: "done",
      createdAt: 1_000,
      toolEvents: [
        { id: "open", name: "clawbrowser.open", createdAt: 1_100 },
        { id: "click", name: "clawbrowser.click", createdAt: 2_100 },
        { id: "extract", name: "clawbrowser.extract", createdAt: 3_000 },
      ],
    },
  };
}

describe("hybrid browser recording", () => {
  it("retains the real chat task when structured agent tool telemetry is unavailable", () => {
    const runs = capturedTaskRunsForRecording([{
      id: "conversation", title: "CMC research", agent: "codex", workspaceId: "workspace", createdAt: 900, updatedAt: 1_200,
      messages: [
        { id: "task", role: "user", text: "Collect the top five trending coins", status: "done", createdAt: 1_100 },
        { id: "answer", role: "assistant", text: "Collected and saved the top five coins.", status: "done", createdAt: 1_200, toolEvents: [] },
      ],
    }], { workspaceId: "workspace", agentId: "codex", startedAt: 1_000 });
    expect(runs).toHaveLength(1);
    expect(runs[0].task).toBe("Collect the top five trending coins");
    expect(runs[0].evidence).toBe("Collected and saved the top five coins.");
  });

  it("keeps a manual-only recording", () => {
    const recording: ManualBrowserRecording = { actions: [{ tool: "open", arguments: { url: "https://example.com" }, at: 1_000 }] };
    const result = capturedRunFromHybridRecording("manual", recording);
    expect(result?.captureSource).toBe("manual");
    expect(recordedBrowserActions(result?.evidence || "")).toEqual([{ tool: "open", arguments: { url: "https://example.com" } }]);
  });

  it("keeps an agent-only recording when no page events were observable", () => {
    const agent = agentRun();
    expect(capturedRunFromHybridRecording("agent", { actions: [] }, agent)).toBe(agent);
  });

  it("merges manual and agent actions chronologically without duplicating observable page events", () => {
    const recording: ManualBrowserRecording = { actions: [
      { tool: "open", arguments: { url: "https://example.com" }, at: 1_000 },
      { tool: "click", arguments: { locator: { role: "button", name: "Load" } }, at: 2_000 },
      { tool: "input", arguments: { selector: "input.note", text: "done" }, at: 3_500 },
    ] };
    const result = capturedRunFromHybridRecording("hybrid", recording, agentRun());
    expect(result?.captureSource).toBe("hybrid");
    expect(result?.task).toBe("Collect the visible result after opening the page.");
    expect(recordedBrowserActions(result?.evidence || "").map((action) => action.tool)).toEqual(["open", "click", "wait", "extract", "input"]);
  });

  it("collapses a repeated initial URL and keeps an explicitly requested artifact output", () => {
    const agent = {
      ...agentRun(),
      task: "Open https://example.com and save the extracted rows as top-five.json in Artifact Center.",
      evidence: "Saved the requested rows.",
      answer: { ...agentRun().answer, toolEvents: [] },
    };
    const recording: ManualBrowserRecording = { actions: [
      { tool: "open", arguments: { url: "https://example.com" }, at: 1_000 },
      { tool: "open", arguments: { profile: "demo", url: "https://example.com" }, at: 5_000 },
      { tool: "evaluate", arguments: { expression: "(() => [{ rank: 1 }])()" }, at: 6_000 },
    ] };
    const result = capturedRunFromHybridRecording("hybrid", recording, agent);
    expect(recordedBrowserActions(result?.evidence || "")).toEqual([
      { tool: "open", arguments: { url: "https://example.com" } },
      { tool: "evaluate", arguments: { expression: "(() => [{ rank: 1 }])()" } },
      { tool: "save_artifact", arguments: { source: "last_result", format: "json", name: "top-five.json" } },
    ]);
  });
});

describe("agent-requested artifacts", () => {
  it("turns a Russian save request into an editable deterministic artifact step", () => {
    expect(artifactActionFromTask("Собери товары и сохрани результат как products.csv в Artifact Center")).toEqual({
      tool: "save_artifact",
      arguments: { source: "last_result", format: "csv", name: "products.csv" },
    });
    expect(skillFromRun({ ...agentRun(), task: "Собери товары и сохрани результат как products.csv в Artifact Center" }).actions.at(-1)?.tool).toBe("save_artifact");
  });

  it("does not infer an artifact from an unrelated save instruction", () => {
    expect(artifactActionFromTask("Save the form and continue browsing")).toBeUndefined();
  });
});
