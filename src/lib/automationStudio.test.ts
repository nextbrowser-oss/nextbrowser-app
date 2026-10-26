import { describe, expect, it } from "vitest";
import { artifactActionFromTask, capturedRunFromHybridRecording, capturedRunFromManualRecording, capturedTaskRunsForRecording, hasPendingTaskRunForRecording, skillFromRun, type CapturedRun, type ManualBrowserRecording } from "./automationStudio";
import { capturedWorkflowDomain, recordedBrowserActions, workflowQuality } from "./workflowCapture";
import type { Conversation } from "../types";

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
  it("recognizes the visible final answer while its completion status is still settling", () => {
    const conversations: Conversation[] = [{
      id: "conversation", title: "CMC research", agent: "codex", workspaceId: "workspace", createdAt: 900, updatedAt: 1_200,
      messages: [
        { id: "task", role: "user", text: "Collect the top five", status: "done", createdAt: 1_100 },
        { id: "answer", role: "assistant", text: "Saved five results.", status: "streaming", createdAt: 1_200 },
      ],
    }];
    const recording = { workspaceId: "workspace", agentId: "codex", startedAt: 1_000 };
    expect(hasPendingTaskRunForRecording(conversations, recording)).toBe(true);
    expect(capturedTaskRunsForRecording(conversations, recording)).toEqual([]);
    conversations[0].messages[1].status = "done";
    expect(hasPendingTaskRunForRecording(conversations, recording)).toBe(false);
    expect(capturedTaskRunsForRecording(conversations, recording)).toHaveLength(1);
  });

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

  it("redacts sensitive text again before a manual recording is persisted", () => {
    const result = capturedRunFromManualRecording("manual-secret", { actions: [
      { tool: "open", arguments: { url: "https://example.com/login" }, at: 1_000 },
      { tool: "input", arguments: { selector: "input[type=password]", text: "actual-password" }, at: 2_000 },
      { tool: "click", arguments: { locator: { role: "button", name: "Sign in" } }, at: 3_000 },
    ] });
    expect(result?.evidence).not.toContain("actual-password");
    expect(result?.evidence).toContain("{{redacted}}");
  });

  it("drops the previously open page from a stopped manual capture", () => {
    const result = capturedRunFromManualRecording("manual", { actions: [
      { tool: "open", arguments: { url: "https://arxiv.org/abs/1706.03762" }, at: 1_000 },
      { tool: "open", arguments: { url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status" }, at: 2_000 },
      { tool: "evaluate", arguments: { expression: "document.title" }, at: 3_000 },
    ] });
    expect(recordedBrowserActions(result?.evidence || "")).toEqual([
      { tool: "open", arguments: { url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status" } },
      { tool: "evaluate", arguments: { expression: "document.title" } },
    ]);
  });

  it("names a manual recording after its captured destination instead of the verification tab", () => {
    const result = capturedRunFromManualRecording("manual-github", {
      url: "clawbrowser://verify/",
      title: "Clawbrowser Verification",
      actions: [{ tool: "open", arguments: { url: "https://github.com/nextbrowser-oss/nextbrowser-app/commits/main" } }],
    });
    expect(result?.conversationTitle).toBe("Manual recording — github.com");
    expect(result?.task).toContain("github.com");
  });

  it("replays a captured open + click on a public site", () => {
    const repo = "https://github.com/nextbrowser-oss/nextbrowser-app";
    const result = capturedRunFromHybridRecording("manual-open-click", {
      url: `${repo}/commits/main`,
      title: "Commits · nextbrowser-oss/nextbrowser-app",
      actions: [
        { tool: "navigate", arguments: { url: repo }, at: 1_000 },
        { tool: "click", arguments: { locator: { role: "link", name: "Commits" } }, at: 2_000, url: repo },
      ],
    })!;
    const domain = capturedWorkflowDomain(result.task, result.evidence);
    expect(domain).toBe("github.com");
    expect(workflowQuality(result.task, result.evidence, domain).reusable).toBe(true);
    expect(recordedBrowserActions(result.evidence)).toEqual([
      { tool: "open", arguments: { url: repo } },
      { tool: "click", arguments: { locator: { role: "link", name: "Commits" } } },
    ]);
    expect(skillFromRun(result).actions.map((action) => action.tool)).toEqual(["open", "click"]);
  });

  it("starts a manual recording on the page of its first click when the navigation there was missed", () => {
    // The tab was already on the repository when the recorder first saw it,
    // so only the click (stamped with its page) was captured.
    const repo = "https://github.com/nextbrowser-oss/nextbrowser-app";
    const result = capturedRunFromHybridRecording("manual-missed-open", {
      url: `${repo}/commits/main`,
      title: "GitHub - nextbrowser-oss/nextbrowser-app · GitHub",
      actions: [
        { tool: "click", arguments: { locator: { role: "link", name: "Commits" } }, at: 2_000, url: repo },
        { tool: "scroll", arguments: { x: 0, y: 400 }, at: 3_000, url: `${repo}/commits/main` },
      ],
    })!;
    const domain = capturedWorkflowDomain(result.task, result.evidence);
    expect(domain).toBe("github.com");
    expect(workflowQuality(result.task, result.evidence, domain)).toEqual({ reusable: true, reason: "The trace contains a completed, repeatable browser workflow." });
    expect(recordedBrowserActions(result.evidence).map((action) => action.tool)).toEqual(["open", "click", "scroll"]);
    expect(recordedBrowserActions(result.evidence)[0].arguments).toEqual({ url: repo });
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
      { tool: "open", arguments: { profile: "demo", url: "https://example.com" } },
      { tool: "evaluate", arguments: { expression: "(() => [{ rank: 1 }])()" } },
      { tool: "save_artifact", arguments: { source: "last_result", format: "json", name: "top-five.json" } },
    ]);
  });

  it("drops the previously open page when the recorded task immediately navigates elsewhere", () => {
    const agent = {
      ...agentRun(),
      task: "Collect recent papers from arxiv.org and save papers.json in Artifact Center.",
      evidence: "Saved the requested papers.",
      answer: { ...agentRun().answer, toolEvents: [] },
    };
    const recording: ManualBrowserRecording = { actions: [
      { tool: "open", arguments: { url: "https://github.com/trending" }, at: 1_000 },
      { tool: "open", arguments: { url: "https://arxiv.org/list/cs.AI/recent" }, at: 5_000 },
      { tool: "evaluate", arguments: { expression: "(() => [...document.querySelectorAll('dt')])()" }, at: 6_000 },
    ] };
    const result = capturedRunFromHybridRecording("hybrid", recording, agent);
    expect(recordedBrowserActions(result?.evidence || "").map((action) => action.arguments.url).filter(Boolean)).toEqual([
      "https://arxiv.org/list/cs.AI/recent",
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

  it("keeps all page datasets when the task explicitly requests run_results", () => {
    expect(artifactActionFromTask('Save all collected datasets as combined.json with source "run_results" in Artifact Center')).toEqual({
      tool: "save_artifact",
      arguments: { source: "run_results", format: "json", name: "combined.json" },
    });
    const run = {
      ...agentRun(),
      task: 'Save all collected datasets as combined.json with source "run_results" in Artifact Center',
      evidence: `${agentRun().evidence}\nCalled clawbrowser.save_artifact({"source":"last_result","format":"json","name":"combined.json"})\n{"ok":true}`,
    };
    expect(skillFromRun(run).actions.at(-1)?.arguments.source).toBe("run_results");
  });

  it("does not infer an artifact from an unrelated save instruction", () => {
    expect(artifactActionFromTask("Save the form and continue browsing")).toBeUndefined();
  });
});
