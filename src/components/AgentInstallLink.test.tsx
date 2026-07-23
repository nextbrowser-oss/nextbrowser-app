import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { agentById } from "../agents";
import { AgentInstallLink } from "./AgentInstallLink";

describe("AgentInstallLink", () => {
  it.each([
    ["claude", "Claude Code CLI", "https://code.claude.com/docs/en/installation"],
    ["codex", "ChatGPT desktop app with Codex", "https://chatgpt.com/download/"],
  ])("links a missing %s dependency to its official installation page", (id, installName, url) => {
    const html = renderToStaticMarkup(
      <AgentInstallLink
        agent={agentById(id)}
        error={`${installName} not found.`}
        surface="test"
      />,
    );

    expect(html).toContain(`href="${url}"`);
    expect(html).toContain(`Install ${installName}`);
  });

  it("does not offer an install link for unrelated errors", () => {
    const html = renderToStaticMarkup(
      <AgentInstallLink
        agent={agentById("claude")}
        error="Something went wrong."
        surface="test"
      />,
    );

    expect(html).toBe("");
  });
});
