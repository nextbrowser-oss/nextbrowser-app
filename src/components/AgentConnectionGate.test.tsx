import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = {
  agentId: "claude",
  runtime: { claude: { version: undefined, loggedIn: undefined, error: undefined, authorizing: false } },
  switchAgent: vi.fn(),
  authorizeAgent: vi.fn(),
  loginAgent: vi.fn(),
};

vi.mock("../store", () => ({ useStore: () => state }));

import { AgentConnectionGate } from "./AgentConnectionGate";

describe("AgentConnectionGate", () => {
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
