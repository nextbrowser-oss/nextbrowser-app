import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = {
  agentId: "claude",
  startupAgentSuggestion: undefined as string | undefined,
  runtime: { claude: { version: undefined, loggedIn: undefined, error: undefined, authorizing: false } },
  switchAgent: vi.fn(),
  authorizeAgent: vi.fn(),
  loginAgent: vi.fn(),
};

vi.mock("../store", () => ({ useStore: () => state }));

import { AgentConnectionGate } from "./AgentConnectionGate";

describe("AgentConnectionGate", () => {
  it.each([true, false])("preselects discovered Codex with a calm offer and the correct login action (%s)", (loggedIn) => {
    state.startupAgentSuggestion = "codex";
    Object.assign(state.runtime, { codex: { version: "1.2.3", loggedIn, error: undefined, authorizing: false } });
    try {
      const html = renderToStaticMarkup(<AgentConnectionGate onDismiss={() => undefined} />);
      expect(html).toContain("Codex is available on this computer");
      expect(html).toContain(loggedIn ? "Connect Codex" : "Sign in to Codex");
      expect(html).not.toContain("Claude Code CLI not found");
    } finally { state.startupAgentSuggestion = undefined; }
  });
  it("offers an explicit accessible close control", () => {
    const html = renderToStaticMarkup(<AgentConnectionGate onDismiss={() => undefined} />);

    expect(html).toContain('aria-label="Close agent setup"');
    expect(html).toContain('title="Close"');
  });

  it("does not advertise a selection as connected before Connect is pressed", () => {
    const html = renderToStaticMarkup(<AgentConnectionGate onDismiss={() => undefined} />);

    expect(html).toContain("Connect Claude Code");
    expect(html).toContain('aria-pressed="true"');
  });
});
