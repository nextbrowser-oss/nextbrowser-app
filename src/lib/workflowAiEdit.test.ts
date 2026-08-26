import { describe, expect, it } from "vitest";
import { parseWorkflowAiEdit, workflowAiEditPrompt } from "./workflowAiEdit";
import type { BrowserWorkflowSkill } from "../types";

const workflow: BrowserWorkflowSkill = {
  id: "workflow-1", title: "CMC top 5", domain: "coinmarketcap.com", task: "Collect the top 5 trending coins.",
  instructions: "Replay the recipe.", capability: "scrape", parametersSchema: {}, outputSchema: {},
  actions: [{ tool: "extract", arguments: { container: "tbody tr", fields: { name: { selector: "td.name" } }, limit: 5 } }],
  recipe: { version: 1, capability: "scrape", actions: [] }, createdAt: 1, updatedAt: 1,
};

describe("workflow AI editing", () => {
  it("prompts for an edit without turning AI into a runtime step", () => {
    const prompt = workflowAiEditPrompt(workflow, "Change top 5 to top 10");
    expect(prompt).toContain("Change top 5 to top 10");
    expect(prompt).toContain("replay remains deterministic");
    expect(prompt).toContain('"limit": 5');
  });

  it("parses a JSON edit surrounded by agent output", () => {
    const parsed = parseWorkflowAiEdit(`Done\n${JSON.stringify({
      title: "CMC top 10", domain: "coinmarketcap.com", task: "Collect the top 10 trending coins.", capability: "scrape",
      actions: [{ tool: "clawbrowser.extract", arguments: { container: "tbody tr", fields: { name: { selector: "td.name" } }, limit: 10 } }],
      summary: "Changed the extraction limit from 5 to 10.",
    })}\n`);
    expect(parsed?.actions[0].tool).toBe("extract");
    expect(parsed?.actions[0].arguments.limit).toBe(10);
  });

  it("rejects incomplete edits", () => {
    expect(parseWorkflowAiEdit('{"title":"Broken","actions":[]}')).toBeUndefined();
  });
});
