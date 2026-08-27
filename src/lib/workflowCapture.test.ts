import { describe, expect, it } from "vitest";
import { capturedWorkflowDomain, terminalBrowserTask, workflowDomain, workflowInstructions, workflowQuality, workflowRecipe, workflowTitle } from "./workflowCapture";

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

  it("uses a public result link when normal chat output has no embedded tool trace", () => {
    const answer = "Нашёл объявление: [Daewoo Matiz](https://makler.md/ro/transport/cars/an/467749). Verification: https://app.clawbrowser.ai/dashboard/browser-streaming.";
    expect(capturedWorkflowDomain("найди все матизы", answer)).toBe("makler.md");
  });

  it("does not mistake an artifact filename for the website that was opened", () => {
    const answer = 'Called clawbrowser.open({"url":"https://news.ycombinator.com/newest"})\n{"ok":true}';
    expect(capturedWorkflowDomain("Collect stories and save them as hacker-news-newest.csv", answer)).toBe("news.ycombinator.com");
  });

  it("creates a useful title and normalized instructions", () => {
    const task = terminalBrowserTask(transcript);
    expect(workflowTitle(task, "makler.md")).toBe("makler.md — матизы");
    const instructions = workflowInstructions(task, transcript);
    expect(instructions).toContain("deduplicate by canonical URL");
    expect(instructions).not.toContain("clawbrowser.start");
    expect(instructions).toContain('"element_id":6');
    expect(instructions).toContain('"dedupe_by":["url"]');
    expect(instructions).not.toContain("return_state");
    expect(instructions).not.toContain("gpt-5.6-sol");
  });

  it("stores portable task actions, dropping transient element ids and session lifecycle", () => {
    const recipe = workflowRecipe(terminalBrowserTask(transcript), transcript);
    expect(recipe.capability).toBe("search");
    expect(recipe.actions.map((action) => action.tool)).toEqual(["paginate_extract"]);
    expect(recipe.actions.some((action) => ["start", "prepare"].includes(action.tool))).toBe(false);
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

  it("preserves every successful action in a complex workflow and drops failed retries", () => {
    const complex = `
Called clawbrowser.navigate({"url":"https://example.com/catalog"})
{"ok":true}
Called clawbrowser.click({"selector":"button.filters"})
{"ok":true}
Called clawbrowser.input({"selector":"input[name=query]","text":"laptop"})
{"ok":true}
Called clawbrowser.select({"selector":"select[name=sort]","value":"price"})
{"ok":true}
Called clawbrowser.click({"selector":"button.missing"})
Error: element not found
Called clawbrowser.press({"key":"Enter"})
{"ok":true}
Called clawbrowser.wait({"selector":"article.product"})
{"ok":true}
Called clawbrowser.extract({"container":"article.product","fields":["title","price"]})
{"count":12}
`;
    expect(workflowRecipe("Find laptops on example.com", complex).actions.map((action) => action.tool)).toEqual([
      "navigate", "click", "input", "select", "press", "wait", "extract",
    ]);
  });

  it("keeps the final selector probe and waits for its container after navigation", () => {
    const probes = [
      'Called nextbrowser.open({"url":"https://coinmarketcap.com/trending-cryptocurrencies/"})\n{"ok":true}',
      'Called nextbrowser.evaluate({"expression":"Array.from(document.querySelectorAll(\\"table tbody tr\\")).slice(0,5)"})\n{"ok":true}',
      'Called nextbrowser.extract({"container":"table tbody tr","fields":{"bad":{"selector":"td:nth-child(2)"}},"limit":5})\n{"count":5,"rows":[{}]}',
      'Called nextbrowser.extract({"container":"table tbody tr","fields":{"name":{"selector":"td:nth-child(3)"},"price":{"selector":"td:nth-child(4)"}},"limit":5})\n{"count":5,"rows":[{"name":"Bitcoin"}]}',
      'Called nextbrowser.save_artifact({"source":"last_result","format":"json","name":"top-five.json"})\n{"ok":true}',
    ].join("\n");

    expect(workflowRecipe("Save the top five", probes).actions).toEqual([
      { tool: "open", arguments: { url: "https://coinmarketcap.com/trending-cryptocurrencies/" } },
      { tool: "wait", arguments: { selector: "table tbody tr", timeout: 30 } },
      { tool: "extract", arguments: { container: "table tbody tr", fields: { name: { selector: "td:nth-child(3)" }, price: { selector: "td:nth-child(4)" } }, limit: 5 } },
      { tool: "save_artifact", arguments: { source: "last_result", format: "json", name: "top-five.json" } },
    ]);
  });

  it("waits for table body rows used by a dynamic evaluate script", () => {
    const transcript = [
      'Called nextbrowser.open({"url":"https://example.com/trending"})\n{"ok":true}',
      'Called nextbrowser.evaluate({"expression":"(() => { const table=[...document.querySelectorAll(\\"table\\")].find(t=>t.querySelectorAll(\\"tbody tr\\").length>=5); return [...table.querySelectorAll(\\"tbody tr\\")]; })()"})\n{"ok":true}',
    ].join("\n");
    expect(workflowRecipe("Collect five rows", transcript).actions).toEqual([
      { tool: "open", arguments: { url: "https://example.com/trending" } },
      { tool: "wait", arguments: { selector: "table tbody tr", timeout: 30 } },
      { tool: "evaluate", arguments: { expression: '(() => { const table=[...document.querySelectorAll("table")].find(t=>t.querySelectorAll("tbody tr").length>=5); return [...table.querySelectorAll("tbody tr")]; })()' } },
    ]);
  });

  it("drops stale adjacent navigation and an ambiguous bare-tag click", () => {
    const noisy = [
      'Called clawbrowser.open({"url":"https://old.reddit.com/login"})\n{"ok":true}',
      'Called clawbrowser.open({"url":"https://www.reddit.com/r/programming/top"})\n{"ok":true}',
      'Called clawbrowser.click({"selector":"button"})\n{"ok":true}',
      'Called clawbrowser.evaluate({"expression":"Array.from(document.querySelectorAll(\\"shreddit-post\\"))"})\n{"ok":true}',
    ].join("\n");
    expect(workflowRecipe("Collect Reddit posts", noisy).actions).toEqual([
      { tool: "open", arguments: { url: "https://www.reddit.com/r/programming/top" } },
      { tool: "wait", arguments: { selector: "shreddit-post", timeout: 30 } },
      { tool: "evaluate", arguments: { expression: 'Array.from(document.querySelectorAll("shreddit-post"))' } },
    ]);
  });

  it("drops transient element ids, diagnostic probes, and a failed search branch before a results URL fallback", () => {
    const noisySearch = [
      'Called clawbrowser.open({"url":"https://github.com/search"})\n{"ok":true}',
      'Called clawbrowser.multi_action({"actions":[{"type":"input","element_id":1557,"text":"browser automation"},{"type":"press","key":"Enter"}]})\n{"ok":true}',
      'Called clawbrowser.click({"element_id":1569})\n{"ok":true}',
      'Called clawbrowser.evaluate({"expression":"document.querySelector(\\"input\\")?.outerHTML"})\n{"ok":true}',
      'Called clawbrowser.input({"locator":{"role":"textbox","name":"Search GitHub"},"text":"browser automation"})\n{"ok":true}',
      'Called clawbrowser.press({"locator":{"role":"textbox","name":"Search GitHub"},"key":"Enter"})\n{"ok":true}',
      'Called clawbrowser.open({"url":"https://github.com/search?q=browser+automation&type=repositories"})\n{"ok":true}',
      'Called clawbrowser.evaluate({"expression":"document.querySelector(\\"[data-testid=results-list]\\")?.outerHTML"})\n{"ok":true}',
      'Called clawbrowser.extract({"container":"[data-testid=results-list] > div","fields":{"name":{"selector":"h3 a"}},"limit":5})\n{"count":5}',
      'Called clawbrowser.save_artifact({"source":"last_result","format":"json","name":"github.json"})\n{"ok":true}',
    ].join("\n");
    expect(workflowRecipe("Search GitHub", noisySearch).actions).toEqual([
      { tool: "open", arguments: { url: "https://github.com/search?q=browser+automation&type=repositories" } },
      { tool: "wait", arguments: { selector: "[data-testid=results-list] > div", timeout: 30 } },
      { tool: "extract", arguments: { container: "[data-testid=results-list] > div", fields: { name: { selector: "h3 a" } }, limit: 5 } },
      { tool: "save_artifact", arguments: { source: "last_result", format: "json", name: "github.json" } },
    ]);
  });

  it("normalizes nextctl field shorthand for deterministic replay", () => {
    const shorthand = [
      'Called clawbrowser.open({"url":"https://github.com/search?q=browser"})\n{"ok":true}',
      'Called clawbrowser.extract({"container":"article","fields":{"url":"","title":"h3"},"limit":5})\n{"count":5}',
    ].join("\n");
    expect(workflowRecipe("Search GitHub", shorthand).actions.at(-1)?.arguments.fields).toEqual({
      url: { selector: "" },
      title: { selector: "h3" },
    });
  });

  it("prefers a singular container selector when deriving the readiness wait", () => {
    const article = [
      'Called clawbrowser.open({"url":"https://en.wikipedia.org/wiki/Web_browser"})\n{"ok":true}',
      'Called clawbrowser.evaluate({"expression":"(() => { const article = document.querySelector(\\"#bodyContent\\"); return Array.from(article.querySelectorAll(\\"p\\")); })()"})\n{"ok":true}',
    ].join("\n");
    expect(workflowRecipe("Read Wikipedia", article).actions[1]).toEqual({
      tool: "wait",
      arguments: { selector: "#bodyContent", timeout: 30 },
    });
  });

  it("rejects empty and failed runs but accepts successful extraction", () => {
    expect(workflowQuality("открой makler.md", "No browser calls").reusable).toBe(false);
    expect(workflowQuality("открой makler.md", 'Called clawbrowser.navigate({"url":"https://makler.md"})\nError: failed').reusable).toBe(false);
    expect(workflowQuality(terminalBrowserTask(transcript), transcript).reusable).toBe(true);
  });

  it("does not treat words inside extracted content as a tool failure", () => {
    const content = `Called clawbrowser.navigate({"url":"https://quotes.toscrape.com"})\n{"ok":true}\nCalled clawbrowser.extract({"container":"div.quote"})\n{"ok":true}\n${"A normal quote. ".repeat(40)}I have not failed; I found another way.`;
    expect(workflowQuality("Collect quotes from quotes.toscrape.com", content).reusable).toBe(true);
  });

  it("rejects a JSON body parser when the trace only captured an ordinary HTML page", () => {
    const jsonFromMissingPage = [
      'Called clawbrowser.open({"url":"https://coinmarketcap.com/trending-cryptocurrencies/"})',
      '{"ok":true}',
      'Called clawbrowser.evaluate({"expression":"JSON.parse(document.body.innerText)"})',
      '{"ok":true,"count":5}',
      'Called clawbrowser.save_artifact({"source":"last_result","format":"json","name":"coins.json"})',
      '{"ok":true}',
    ].join("\n");
    const quality = workflowQuality("Collect coins from coinmarketcap.com", jsonFromMissingPage);
    expect(quality.reusable).toBe(false);
    expect(quality.reason).toMatch(/JSON page.*not captured/i);
  });

  it("accepts a JSON body parser when the API navigation is present", () => {
    const jsonApi = [
      'Called clawbrowser.open({"url":"https://api.example.com/data/list.json"})',
      '{"ok":true}',
      'Called clawbrowser.evaluate({"expression":"JSON.parse(document.body.innerText)"})',
      '{"ok":true,"count":5}',
    ].join("\n");
    expect(workflowQuality("Collect data from example.com", jsonApi).reusable).toBe(true);
  });
});
