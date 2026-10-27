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

import { AgentConnectionGate, agentGateVisible } from "./AgentConnectionGate";

describe("when the agent gate shows", () => {
  it("waits for the agent check after a start or reload instead of flashing", () => {
    expect(agentGateVisible(true, true, false)).toBe(false);
    expect(agentGateVisible(true, false, false)).toBe(true);
  });

  it("stays open while the user's own Connect is checked", () => {
    expect(agentGateVisible(true, true, true)).toBe(true);
  });

  it("never shows when it is not due", () => {
    expect(agentGateVisible(false, false, true)).toBe(false);
  });
});

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
