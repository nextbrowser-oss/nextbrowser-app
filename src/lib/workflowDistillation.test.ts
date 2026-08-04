import { describe, expect, it } from "vitest";
import { parseDistilledWorkflow, workflowDistillationPrompt } from "./workflowDistillation";

const fallback = {
  title: "makler.md — матизы", domain: "makler.md",
  instructions: "Technical fast path: clawbrowser.start({}) then clawbrowser.paginate_extract({}). " + "x".repeat(100),
};

describe("workflow agent distillation", () => {
  it("accepts a grounded structured skill", () => {
    const raw = JSON.stringify({
      title: "Makler vehicle search", domain: "makler.md",
      instructions: "Prepare the proxy, apply the requested search, then run clawbrowser.start({}) and clawbrowser.paginate_extract({}) with the saved filters. " + "x".repeat(80),
    });
    expect(parseDistilledWorkflow(raw, fallback)?.title).toBe("Makler vehicle search");
  });

  it("parses JSON surrounded by CLI output and permits generic endpoint guidance", () => {
    const raw = `Codex CLI\n${JSON.stringify({
      title: "Makler search", domain: "makler.md",
      instructions: "Reuse the active endpoint only after proxy verification, then run clawbrowser.start({}) and clawbrowser.paginate_extract({}). " + "x".repeat(80),
    })}\nDone`;
    expect(parseDistilledWorkflow(raw, fallback)?.domain).toBe("makler.md");
  });

  it("rejects invented tools, changed domains, and transient connection data", () => {
    expect(parseDistilledWorkflow(JSON.stringify({ title: "x", domain: "evil.test", instructions: "x".repeat(100) }), fallback)).toBeUndefined();
    expect(parseDistilledWorkflow(JSON.stringify({ title: "x", domain: "makler.md", instructions: `Use clawbrowser.delete_all({}). ${"x".repeat(100)}` }), fallback)).toBeUndefined();
    expect(parseDistilledWorkflow(JSON.stringify({ title: "x", domain: "makler.md", instructions: `endpoint http://127.0.0.1:1234 ${"x".repeat(100)}` }), fallback)).toBeUndefined();
  });

  it("forbids tool use in the authoring prompt", () => {
    expect(workflowDistillationPrompt(fallback)).toContain("Do not call tools");
  });
});
