import { describe, expect, it } from "vitest";
import { capturedRuns, skillFromRun } from "../lib/automationStudio";
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
});
