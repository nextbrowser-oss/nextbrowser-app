import { describe, expect, it } from "vitest";
import { terminalBrowserSession } from "./terminalBrowserSession";

describe("terminalBrowserSession", () => {
  it("detects a successful Camoufox MCP start payload", () => {
    const output = `Called nextbrowser.start({"profile":"Reddit scraping","runtime":"camoufox"})
{"session":{"backend":"external-camoufox","endpoint":"http://127.0.0.1:55081","name":"Reddit scraping","runtime":"camoufox","source":"state_file"}}`;
    expect(terminalBrowserSession(output, ["Reddit scraping"])).toEqual({
      name: "Reddit scraping",
      signal: "Reddit scraping:camoufox",
    });
  });

  it("ignores profiles outside the terminal workspace", () => {
    const output = `{"session":{"name":"Other","runtime":"camoufox"}}`;
    expect(terminalBrowserSession(output, ["Workspace profile"])).toBeUndefined();
  });
});
