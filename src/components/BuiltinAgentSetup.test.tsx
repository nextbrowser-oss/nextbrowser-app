import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  agentId: "claude",
  switchAgent: () => undefined,
  refreshBuiltinAgent: async () => undefined,
}));

vi.mock("../store", () => ({ useStore: (selector: (value: typeof state) => unknown) => selector(state) }));
vi.mock("../electronBridge", () => ({ invoke: vi.fn(() => new Promise(() => undefined)) }));

import { BuiltinAgentSetup } from "./BuiltinAgentSetup";

describe("BuiltinAgentSetup", () => {
  it("offers the managed OpenRouter provider first and leaves personal credentials optional", () => {
    const html = renderToStaticMarkup(<BuiltinAgentSetup />);
    for (const name of ["NVIDIA", "OpenRouter", "DeepSeek", "Anthropic", "Google Gemini", "Custom"]) expect(html).toContain(`<strong>${name}</strong>`);
    expect(html).toMatch(/role="radio" aria-checked="true" class="builtin-agent-provider is-selected" disabled=""><span class="builtin-agent-provider-head"><strong>OpenRouter<\/strong>/);
    expect(html).toContain("Nemotron is included with your Nextbrowser account.");
    expect(html).toContain("Free models are available through your Nextbrowser account, subject to shared capacity.");
    expect(html).toContain("Free OpenRouter model");
    expect(html).toContain("Your tasks and the page text the agent reads are sent to OpenRouter.");
  });

  it("requires no personal key and waits for a model before enabling Test and Save", () => {
    const html = renderToStaticMarkup(<BuiltinAgentSetup />);
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("Save a key to load the models");
    expect(html).toMatch(/<button type="button" class="mini" disabled="">[^<]*<svg[\s\S]*?<\/svg> Test<\/button>/);
    expect(html).toMatch(/<button type="button" class="mini primary-mini" disabled=""> Use this model<\/button>/);
  });
});
