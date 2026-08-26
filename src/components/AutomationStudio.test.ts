import { describe, expect, it } from "vitest";
import { capturedRuns, capturedRunsForRecording, skillFromRun } from "../lib/automationStudio";
import { workflowQuality } from "../lib/workflowCapture";
import type { Conversation } from "../types";

describe("Automation Studio recorder", () => {
  it("turns a successful semantic browser trace into an editable workflow", () => {
    const conversations: Conversation[] = [{
      id: "conversation",
      title: "Research",
      agent: "codex",
      createdAt: 1,
      updatedAt: 3,
      messages: [
        { id: "task", role: "user", text: "Find products on https://example.com", status: "done", createdAt: 1 },
        {
          id: "answer", role: "assistant", text: "Found 2 products.", status: "done", createdAt: 2,
          toolEvents: [
            { id: "open", name: "clawbrowser.navigate", detail: '{"url":"https://example.com/products"}', createdAt: 2 },
            { id: "extract", name: "clawbrowser.extract", detail: '{"container":"article"}', createdAt: 2 },
          ],
        },
      ],
    }];

    const runs = capturedRuns(conversations);
    expect(runs).toHaveLength(1);
    const workflow = skillFromRun(runs[0]);
    expect(workflow.domain).toBe("example.com");
    expect(workflow.actions).toEqual([
      { tool: "navigate", arguments: { url: "https://example.com/products" } },
      { tool: "wait", arguments: { selector: "article", timeout: 30 } },
      { tool: "extract", arguments: { container: "article" } },
    ]);
    expect(workflow.recipe.actions).toEqual(workflow.actions);
  });

  it("ignores ordinary chat replies without browser actions", () => {
    const conversations: Conversation[] = [{
      id: "conversation", title: "Chat", agent: "codex", createdAt: 1, updatedAt: 2,
      messages: [
        { id: "task", role: "user", text: "Hello", status: "done", createdAt: 1 },
        { id: "answer", role: "assistant", text: "Hi", status: "done", createdAt: 2 },
      ],
    }];
    expect(capturedRuns(conversations)).toEqual([]);
  });

  it("only captures runs from the recording workspace, agent, and time window", () => {
    const makeConversation = (id: string, workspaceId: string, agent: string, createdAt: number): Conversation => ({
      id, title: id, workspaceId, agent, createdAt, updatedAt: createdAt,
      messages: [
        { id: `${id}-task`, role: "user", text: "Open example.com", status: "done", createdAt: createdAt - 1 },
        { id: `${id}-answer`, role: "assistant", text: "Done", status: "done", createdAt, toolEvents: [
          { id: `${id}-tool`, name: "clawbrowser.navigate", detail: '{"url":"https://example.com"}', createdAt },
        ] },
      ],
    });
    const result = capturedRunsForRecording([
      makeConversation("wanted", "workspace-a", "codex", 200),
      makeConversation("old", "workspace-a", "codex", 50),
      makeConversation("wrong-workspace", "workspace-b", "codex", 200),
      makeConversation("wrong-agent", "workspace-a", "claude", 200),
    ], { workspaceId: "workspace-a", agentId: "codex", startedAt: 100 });
    expect(result.map((run) => run.id)).toEqual(["wanted-answer"]);
  });

  it("redacts credentials from persisted recordings and blocks their workflow conversion", () => {
    const conversations: Conversation[] = [{
      id: "secret", title: "Sign in", workspaceId: "workspace-a", agent: "codex", createdAt: 1, updatedAt: 2,
      messages: [
        { id: "task", role: "user", text: "Sign in to example.com with password=hunter2", status: "done", createdAt: 1 },
        { id: "answer", role: "assistant", text: "Authorization: Bearer raw-token", status: "done", createdAt: 2, toolEvents: [
          { id: "navigate", name: "clawbrowser.navigate", detail: '{"url":"https://example.com/login"}', createdAt: 2 },
          { id: "input", name: "clawbrowser.input", detail: '{"selector":"input[type=password]","text":"hunter2","api_key":"raw-key"}', createdAt: 2 },
        ] },
      ],
    }];
    const [run] = capturedRuns(conversations);
    const serialized = JSON.stringify(run);
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("raw-token");
    expect(serialized).not.toContain("raw-key");
    expect(serialized).toContain("{{redacted}}");
    expect(workflowQuality(run.task, run.evidence).reusable).toBe(false);
  });

  it("captures a real Codex skill run from its embedded recipe when tool events are empty", () => {
    const recipe = { version: 1, capability: "scrape", actions: [
      { tool: "navigate", arguments: { url: "https://books.toscrape.com/" } },
      { tool: "extract", arguments: { container: "article.product_pod", fields: ["title", "price"] } },
    ] };
    const conversations: Conversation[] = [{
      id: "codex", title: "Books", workspaceId: "workspace-a", agent: "codex", createdAt: 1, updatedAt: 3,
      messages: [
        {
          id: "task", role: "user", status: "done", createdAt: 2,
          commandChip: { kind: "skill", title: "Books", detail: "books.toscrape.com" },
          text: `Prepared session.\n\nTask for this run:\nCollect books from https://books.toscrape.com\n\nStructured recipe (execute first):\n${JSON.stringify(recipe, null, 2)}\n\nWorkflow fallback:\nAdapt if needed.`,
        },
        { id: "answer", role: "assistant", text: "Collected 20 books.", status: "done", createdAt: 3, toolEvents: [] },
      ],
    }];
    const [run] = capturedRuns(conversations);
    expect(run.captureSource).toBe("structured-recipe");
    expect(run.task).toBe("Collect books from https://books.toscrape.com");
    expect(skillFromRun(run).actions.map((action) => action.tool)).toEqual(["navigate", "wait", "extract"]);
  });

  it("does not save a failed skill result merely because its planned recipe was valid", () => {
    const conversation: Conversation = {
      id: "failed", title: "Failed", agent: "codex", createdAt: 1, updatedAt: 3,
      messages: [
        { id: "task", role: "user", status: "done", createdAt: 2, commandChip: { kind: "skill", title: "Search", detail: "example.com" }, text: 'Task for this run:\nSearch example.com\n\nStructured recipe (execute first):\n{"actions":[{"tool":"navigate","arguments":{"url":"https://example.com"}}]}\n\nWorkflow fallback:\nAdapt.' },
        { id: "answer", role: "assistant", text: "No results found on the requested site.", status: "done", createdAt: 3, toolEvents: [] },
      ],
    };
    expect(capturedRuns([conversation])).toEqual([]);
  });
});
