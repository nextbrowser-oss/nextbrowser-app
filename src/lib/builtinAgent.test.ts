import { describe, expect, it } from "vitest";
import { BUILTIN_PROVIDERS, builtinAgentRuntime, builtinAgentSettings, builtinProvider } from "./builtinAgent";

describe("built-in agent setup", () => {
  it("offers NVIDIA first, with a free key link, and a custom provider without a required key", () => {
    expect(BUILTIN_PROVIDERS.map((provider) => provider.id)).toEqual(["nvidia", "openrouter", "gemini", "custom"]);
    expect(builtinProvider("nvidia").keyURL).toBe("https://build.nvidia.com");
    expect(builtinProvider("custom").keyRequired).toBe(false);
    expect(builtinProvider("unknown").id).toBe("nvidia");
    for (const provider of BUILTIN_PROVIDERS) {
      expect(provider.limits.length).toBeGreaterThan(10);
      expect(provider.dataUse.length).toBeGreaterThan(10);
    }
  });

  it("reads the saved settings from a status, defaulting to NVIDIA", () => {
    expect(builtinAgentSettings(undefined)).toEqual({ provider: "nvidia", baseURL: "", model: "" });
    expect(builtinAgentSettings({ settings: { provider: "custom", baseURL: "http://localhost:11434/v1", model: "llama3.1" } }))
      .toEqual({ provider: "custom", baseURL: "http://localhost:11434/v1", model: "llama3.1" });
  });

  it("is ready once set up, labelled with provider and model", () => {
    expect(builtinAgentRuntime({ settings: {}, keys: { nvidia: true }, secureStorage: true, configured: true, problem: "", providerName: "NVIDIA", model: "m" }))
      .toEqual({ ready: true, version: "NVIDIA · m", loggedIn: true, error: undefined });
    expect(builtinAgentRuntime({ settings: {}, keys: {}, secureStorage: true, configured: false, problem: "Choose a model provider and add its key." }))
      .toEqual({ ready: false, version: undefined, loggedIn: null, error: "Set up the Nextbrowser agent in Settings → Agent. Choose a model provider and add its key." });
  });
});
