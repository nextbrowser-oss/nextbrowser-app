import { describe, expect, it } from "vitest";
import { AUTOMATION_REPAIR_MARKER, automationRepairTask, parseAutomationRepairRecipe, shouldAutoRepairAutomation } from "./automationRepair";

describe("automatic automation repair", () => {
  it("repairs saved page selectors and extraction scripts automatically", () => {
    expect(shouldAutoRepairAutomation("click", "No element matches the saved locator")).toBe(true);
    expect(shouldAutoRepairAutomation("evaluate", "Expected 5 populated trending rows")).toBe(true);
    expect(shouldAutoRepairAutomation("evaluate", "runtime evaluation failed: Expected at least 5 populated trending rows")).toBe(true);
    expect(shouldAutoRepairAutomation("paginate_extract", "The saved extraction returned only empty rows")).toBe(true);
    expect(shouldAutoRepairAutomation("open", "The saved page returned 404 Not Found")).toBe(true);
    expect(shouldAutoRepairAutomation("save_artifact", "The replayed dataset is missing a populated title field")).toBe(true);
  });

  it("does not spend an AI run on infrastructure or user-controlled failures", () => {
    expect(shouldAutoRepairAutomation("evaluate", "Project sync failed (401). The account token is invalid")).toBe(false);
    expect(shouldAutoRepairAutomation("click", "Profile Worker session is missing")).toBe(false);
    expect(shouldAutoRepairAutomation("wait", "Automation execution was cancelled")).toBe(false);
    expect(shouldAutoRepairAutomation("open", "No element matches")).toBe(true);
    expect(shouldAutoRepairAutomation("save_artifact", "Artifact storage failed")).toBe(false);
    expect(shouldAutoRepairAutomation("click", "A CAPTCHA requires verification")).toBe(false);
  });

  it("asks the agent to finish the original goal and return a reusable fast path", () => {
    const prompt = automationRepairTask("Collect Wikipedia headings", [
      { tool: "open", arguments: { url: "https://en.wikipedia.org/wiki/Web_browser" } },
      { tool: "extract", arguments: { container: "section", fields: { heading: { selector: "h2" } } } },
    ], 1, "No element matches section");
    expect(prompt).toContain("Complete the original user goal");
    expect(prompt).toContain(AUTOMATION_REPAIR_MARKER);
    expect(prompt).toContain("complete successful action list");
    expect(prompt).toContain("self-contained");
  });

  it("keeps repaired navigation on the workflow domain when the fast path has no open step", () => {
    const safe = `${AUTOMATION_REPAIR_MARKER} {"version":1,"actions":[{"tool":"open","arguments":{"url":"https://news.ycombinator.com/newest"}},{"tool":"extract","arguments":{"container":"tr.athing","fields":{"title":{"selector":".titleline > a"}}}}]}`;
    const unsafe = `${AUTOMATION_REPAIR_MARKER} {"version":1,"actions":[{"tool":"open","arguments":{"url":"https://evil.example/collect"}},{"tool":"extract","arguments":{"container":"div","fields":{"title":{"selector":"span"}}}}]}`;
    expect(parseAutomationRepairRecipe(safe, [{ tool: "extract", arguments: { container: "tr.athing", fields: {} } }], "news.ycombinator.com")).toBeDefined();
    expect(parseAutomationRepairRecipe(unsafe, [{ tool: "extract", arguments: { container: "tr.athing", fields: {} } }], "news.ycombinator.com")).toBeUndefined();
    expect(parseAutomationRepairRecipe(`${AUTOMATION_REPAIR_MARKER} {"version":1,"actions":[{"tool":"extract","arguments":{"container":"tr.athing","fields":{"title":{"selector":"a"}}}}]}`, [{ tool: "extract", arguments: { container: "tr.athing", fields: {} } }], "news.ycombinator.com")).toBeUndefined();
  });

  it("keeps the original starting page when AI only returns repaired data steps", () => {
    const original = [
      { tool: "open", arguments: { url: "https://news.ycombinator.com/newest" } },
      { tool: "extract", arguments: { container: ".old", fields: { title: { selector: "a" } } } },
    ];
    const raw = `${AUTOMATION_REPAIR_MARKER} {"version":1,"actions":[{"tool":"extract","arguments":{"container":"tr.athing","fields":{"title":{"selector":".titleline > a"}}}}]}`;
    expect(parseAutomationRepairRecipe(raw, original)?.actions[0]).toEqual(original[0]);
  });

  it("normalizes an agent navigate_extract fast path into deterministic blocks", () => {
    const raw = `${AUTOMATION_REPAIR_MARKER} ${JSON.stringify({ version: 1, actions: [
      { tool: "navigate_extract", arguments: { profile: "Worker", runtime: "clawbrowser", url: "https://news.ycombinator.com/newest", ready_selector: "tr.athing", container: "tr.athing", fields: { title: { selector: ".titleline > a" } }, limit: 5, timeout: 30 } },
      { tool: "save_artifact", arguments: { source: "last_result", format: "json", name: "hn.json" } },
    ] })}`;
    expect(parseAutomationRepairRecipe(raw, [
      { tool: "extract", arguments: { container: "tr.athing", fields: {} } },
      { tool: "save_artifact", arguments: { source: "last_result", format: "json", name: "hn.json" } },
    ], "news.ycombinator.com")?.actions).toEqual([
      { tool: "open", arguments: { url: "https://news.ycombinator.com/newest" } },
      { tool: "wait", arguments: { selector: "tr.athing", timeout: 30 } },
      { tool: "extract", arguments: { container: "tr.athing", fields: { title: { selector: ".titleline > a" } }, limit: 5 } },
      { tool: "save_artifact", arguments: { source: "last_result", format: "json", name: "hn.json" } },
    ]);
    expect(parseAutomationRepairRecipe(raw, [
      { tool: "extract", arguments: { container: "tr.athing", fields: {} } },
      { tool: "save_artifact", arguments: { source: "last_result", format: "json", name: "hn.json" } },
    ], "agent-hn-top-5.json")).toBeDefined();
  });

  it.each([
    ["Wikipedia", "https://en.wikipedia.org/wiki/Web_browser"],
    ["Hacker News", "https://news.ycombinator.com/newest"],
    ["GitHub", "https://github.com/trending"],
    ["DefiLlama", "https://defillama.com/chains"],
  ])("accepts a same-origin repaired recipe for %s", (_name, url) => {
    const original = [
      { tool: "open", arguments: { url } },
      { tool: "extract", arguments: { container: ".old", fields: { title: { selector: ".old-title" } } } },
      { tool: "save_artifact", arguments: { source: "last_result", format: "json", name: "result.json" } },
    ];
    const repaired = [
      { tool: "open", arguments: { url } },
      { tool: "wait", arguments: { selector: "main", timeout: 15 } },
      { tool: "extract", arguments: { container: "main a", fields: { title: { selector: "" } } } },
      { tool: "save_artifact", arguments: { source: "last_result", format: "json", name: "result.json" } },
    ];
    expect(parseAutomationRepairRecipe(`${AUTOMATION_REPAIR_MARKER} ${JSON.stringify({ version: 1, actions: repaired })}`, original)).toEqual({ version: 1, actions: repaired });
  });

  it("rejects a repaired recipe that changes origin or drops the requested artifact", () => {
    const original = [
      { tool: "open", arguments: { url: "https://en.wikipedia.org/wiki/Web_browser" } },
      { tool: "save_artifact", arguments: { name: "headings.json" } },
    ];
    const changedOrigin = { version: 1, actions: [{ tool: "open", arguments: { url: "https://attacker.invalid" } }, { tool: "save_artifact", arguments: { name: "headings.json" } }] };
    const changedArtifact = { version: 1, actions: [{ tool: "open", arguments: { url: original[0].arguments.url } }, { tool: "save_artifact", arguments: { name: "other.json" } }] };
    expect(parseAutomationRepairRecipe(`${AUTOMATION_REPAIR_MARKER} ${JSON.stringify(changedOrigin)}`, original)).toBeUndefined();
    expect(parseAutomationRepairRecipe(`${AUTOMATION_REPAIR_MARKER} ${JSON.stringify(changedArtifact)}`, original)).toBeUndefined();
  });
});
