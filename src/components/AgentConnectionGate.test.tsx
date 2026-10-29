import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = {
  agentId: "claude",
  startupAgentSuggestion: undefined as string | undefined,
  runtime: { claude: { version: undefined, loggedIn: undefined, error: undefined, authorizing: false } },
  switchAgent: vi.fn(),
  authorizeAgent: vi.fn(),
  loginAgent: vi.fn(),
  refreshBuiltinAgent: vi.fn(),
};

vi.mock("../store", () => ({ useStore: (selector?: (value: typeof state) => unknown) => (selector ? selector(state) : state) }));
vi.mock("../electronBridge", () => ({ invoke: vi.fn(() => new Promise(() => undefined)) }));

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

  it("offers a free model next to the agent CLIs", () => {
    const html = renderToStaticMarkup(<AgentConnectionGate onDismiss={() => undefined} />);
    expect(html).toContain("Use a free model");
    expect(html).toContain("Nothing else to install.");
    expect(html).not.toContain("No agent CLI on this computer?");
    expect(html).not.toContain("builtin-agent-setup");
  });

  it("points to the free model when no agent CLI is installed, and shows its setup once chosen", () => {
    Object.assign(state.runtime.claude, { error: "Claude Code CLI not found. Nextbrowser needs the Claude Code CLI, not the Claude desktop app, to connect. Install the CLI, then try again." });
    try {
      const missing = renderToStaticMarkup(<AgentConnectionGate onDismiss={() => undefined} />);
      expect(missing).toContain("No agent CLI on this computer? The built-in Nextbrowser agent");
      expect(missing).toContain("agent-gate-free is-suggested");
      state.startupAgentSuggestion = "nextbrowser";
      Object.assign(state.runtime, { nextbrowser: { version: undefined, loggedIn: null, error: "Set up the Nextbrowser agent in Settings → Agent.", authorizing: false } });
      const chosen = renderToStaticMarkup(<AgentConnectionGate onDismiss={() => undefined} />);
      expect(chosen).toContain("builtin-agent-setup");
      expect(chosen).toContain('href="https://build.nvidia.com"');
      expect(chosen).not.toContain("agent-gate-connect");
      expect(chosen).not.toContain("Set up the Nextbrowser agent in Settings");
    } finally {
      state.startupAgentSuggestion = undefined;
      Object.assign(state.runtime.claude, { error: undefined });
    }
  });
});

