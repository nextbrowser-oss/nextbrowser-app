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
  it("offers the providers with their limits, NVIDIA first, and a free key link", () => {
    const html = renderToStaticMarkup(<BuiltinAgentSetup />);
    for (const name of ["NVIDIA", "OpenRouter", "Google Gemini", "Custom"]) expect(html).toContain(`<strong>${name}</strong>`);
    expect(html).toMatch(/role="radio" aria-checked="true" class="builtin-agent-provider is-selected"><span class="builtin-agent-provider-head"><strong>NVIDIA<\/strong>/);
    expect(html).toContain("about 40 requests a minute");
    expect(html).toContain("About 50 requests a day");
    expect(html).toContain('href="https://build.nvidia.com"');
    expect(html).toContain("Get a free key");
    expect(html).toContain("Your tasks and the page text the agent reads are sent to NVIDIA.");
    expect(html).toContain("for development and testing");
  });

  it("takes the key in a password field and keeps Test and Save off until a key and a model are there", () => {
    const html = renderToStaticMarkup(<BuiltinAgentSetup />);
    expect(html).toMatch(/<input type="password" autoComplete="off"[^>]*aria-label="NVIDIA API key"/);
    expect(html).toContain("Save a key to load the models");
    expect(html).toMatch(/<button type="button" class="mini" disabled="">[^<]*<svg[\s\S]*?<\/svg> Test<\/button>/);
    expect(html).toMatch(/<button type="button" class="mini primary-mini" disabled=""> Use this model<\/button>/);
  });
});
