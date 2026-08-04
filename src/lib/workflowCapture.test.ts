import { describe, expect, it } from "vitest";
import { terminalBrowserTask, workflowDomain, workflowInstructions, workflowTitle } from "./workflowCapture";

const transcript = `
│ model:     gpt-5.6-sol low   /model to change │
› открой makler.md c американской проксей и найди все матизы
• Called clawbrowser.start({"country":"US","url":"https://makler.md"})
• Called clawbrowser.multi_action({"actions":[]})
• Called clawbrowser.paginate_extract({"limit":100})
• Нашёл 2 объявления.
› Explain this codebase
  gpt-5.6-sol low · ~/.nextbrowser/workspace
`;

describe("terminal workflow capture", () => {
  it("binds the workflow to the prompt before the last browser run", () => {
    expect(terminalBrowserTask(transcript)).toBe("открой makler.md c американской проксей и найди все матизы");
  });

  it("does not mistake a model version for a website", () => {
    expect(workflowDomain(`${terminalBrowserTask(transcript)}\n${transcript}`)).toBe("makler.md");
  });

  it("creates a useful title and normalized instructions", () => {
    const task = terminalBrowserTask(transcript);
    expect(workflowTitle(task, "makler.md")).toBe("makler.md — матизы");
    const instructions = workflowInstructions(task, transcript);
    expect(instructions).toContain("verify the requested proxy country");
    expect(instructions).toContain("deduplicate by canonical URL");
    expect(instructions).not.toContain("gpt-5.6-sol");
  });
});
