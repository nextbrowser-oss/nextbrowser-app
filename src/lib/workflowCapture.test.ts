import { describe, expect, it } from "vitest";
import { capturedWorkflowDomain, terminalBrowserTask, workflowDomain, workflowInstructions, workflowTitle } from "./workflowCapture";

const transcript = `
│ model:     gpt-5.6-sol low   /model to change │
› открой makler.md c американской проксей и найди все матизы
• Called clawbrowser.start({"profile":"us-makler-md","country":"US","url":"https://makler.md","return_state":true})
• Called clawbrowser.multi_action({"profile":"us-makler-md","actions":[{"type":"input","element_id":6,"text":"Matiz"},{"type":"press","key":"Enter"}],"stop_on_navigation":true})
• Called clawbrowser.paginate_extract({"profile":"us-makler-md","container":"a[href]","filters":[{"field":"title","op":"contains","value":"Matiz"}],"dedupe_by":["url"],"scroll":true,"max_pages":5,"limit":100})
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

  it("ignores verification and service domains when resolving the target website", () => {
    const verified = `
› найди все матизы
• Called clawbrowser.start({"url":"https://app.clawbrowser.ai/dashboard/browser-streaming?id=rs_123"})
• Called clawbrowser.navigate({"url":"https://makler.md/ro/an/search?query=Matiz"})
`;
    expect(capturedWorkflowDomain(terminalBrowserTask(verified), verified)).toBe("makler.md");
  });

  it("creates a useful title and normalized instructions", () => {
    const task = terminalBrowserTask(transcript);
    expect(workflowTitle(task, "makler.md")).toBe("makler.md — матизы");
    const instructions = workflowInstructions(task, transcript);
    expect(instructions).toContain("verify the requested proxy country");
    expect(instructions).toContain("deduplicate by canonical URL");
    expect(instructions).toContain('clawbrowser.start({"profile":"us-makler-md","country":"US","url":"https://makler.md"})');
    expect(instructions).toContain('"element_id":6');
    expect(instructions).toContain('"dedupe_by":["url"]');
    expect(instructions).not.toContain("return_state");
    expect(instructions).not.toContain("gpt-5.6-sol");
  });

  it("keeps one successful extraction and marks a non-self-contained search", () => {
    const retryTranscript = `
› открой makler.md c американской проксей и найди все матизы
• Called clawbrowser.start({"profile":"us-makler-md","country":"US","url":"https://makler.md"})
  {"ok":true}
• Called clawbrowser.paginate_extract({"container":"li","fields":{"title":{"selector":"h3"}},"limit":500})
  {"rows":[],"count":0}
• Called clawbrowser.paginate_extract({"container":"li","fields":{"title":{"selector":"h3 a"}},"scroll":true,"limit":500})
  Error: selector failed
• Called clawbrowser.paginate_extract({"container":"a[href]","fields":{"title":{"selector":""},"url":{"selector":"","attribute":"href"}},"filters":[{"field":"title","op":"contains","value":"Matiz"}],"dedupe_by":["url"],"scroll":true,"limit":500})
  {"rows":[{"title":"Daewoo Matiz","url":"https://makler.md/1"}],"count":1}
`;
    const instructions = workflowInstructions(terminalBrowserTask(retryTranscript), retryTranscript);
    expect(instructions.match(/clawbrowser\.paginate_extract/g)).toHaveLength(1);
    expect(instructions).toContain('"container":"a[href]"');
    expect(instructions).toContain("fast path is partial");
    expect(instructions).toContain("apply the requested search");
    expect(instructions).not.toContain("element_id values");
  });
});
