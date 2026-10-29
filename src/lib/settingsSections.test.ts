import { describe, expect, it } from "vitest";
import {
  SETTINGS_SECTIONS,
  settingsAttention,
  settingsSectionAfterKey,
  settingsSectionForUpdates,
  settingsSectionInfo,
  type SettingsAttentionInput,
} from "./settingsSections";

const calm: SettingsAttentionInput = {
  appUpdate: false,
  toolsetUpdate: false,
  agentReady: true,
  agentNeedsLogin: false,
  builtinAgent: false,
  proxyTone: "ok",
};

describe("Settings sections", () => {
  it("lists General, Privacy, Agent, Browser and Proxy in rail order", () => {
    expect(SETTINGS_SECTIONS.map((section) => section.label)).toEqual(["General", "Privacy", "Agent", "Browser", "Proxy"]);
    expect(new Set(SETTINGS_SECTIONS.map((section) => section.id)).size).toBe(SETTINGS_SECTIONS.length);
    expect(SETTINGS_SECTIONS.every((section) => section.summary.endsWith("."))).toBe(true);
    expect(settingsSectionInfo("agent").label).toBe("Agent");
  });

  it("moves through the rail with the arrow keys and wraps at both ends", () => {
    expect(settingsSectionAfterKey("general", "ArrowDown")).toBe("privacy");
    expect(settingsSectionAfterKey("browser", "ArrowDown")).toBe("proxy");
    expect(settingsSectionAfterKey("proxy", "ArrowDown")).toBe("general");
    expect(settingsSectionAfterKey("privacy", "ArrowUp")).toBe("general");
    expect(settingsSectionAfterKey("general", "ArrowUp")).toBe("proxy");
  });

  it("jumps to the first and last sections with Home and End", () => {
    expect(settingsSectionAfterKey("browser", "Home")).toBe("general");
    expect(settingsSectionAfterKey("privacy", "End")).toBe("proxy");
  });

  it("leaves every other key alone", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "Tab", "Enter", " ", "Escape", "a"]) {
      expect(settingsSectionAfterKey("agent", key)).toBeUndefined();
    }
  });

  it("flags nothing while everything is fine", () => {
    expect(settingsAttention(calm)).toEqual({});
    expect(settingsAttention({ ...calm, proxyTone: "neutral" })).toEqual({});
  });

  it("flags an app update in General and a toolset update in Browser", () => {
    expect(settingsAttention({ ...calm, appUpdate: true })).toEqual({ general: "update available" });
    expect(settingsAttention({ ...calm, toolsetUpdate: true })).toEqual({ browser: "update available" });
  });

  it("flags an agent that is not ready, saying whether it only needs to sign in", () => {
    expect(settingsAttention({ ...calm, agentReady: false })).toEqual({ agent: "not connected" });
    expect(settingsAttention({ ...calm, agentReady: false, agentNeedsLogin: true })).toEqual({ agent: "sign-in required" });
  });

  it("flags the built-in Nextbrowser agent as not set up until it has a provider, a key and a model", () => {
    expect(settingsAttention({ ...calm, agentReady: false, builtinAgent: true })).toEqual({ agent: "not set up" });
    expect(settingsAttention({ ...calm, builtinAgent: true })).toEqual({});
  });

  it("flags proxy traffic that is paused or near its limit", () => {
    expect(settingsAttention({ ...calm, proxyTone: "paused" })).toEqual({ proxy: "traffic paused" });
    expect(settingsAttention({ ...calm, proxyTone: "warn" })).toEqual({ proxy: "traffic near its limit" });
  });

  it("opens the Settings button on the section with the update its dot announces", () => {
    expect(settingsSectionForUpdates(false, false)).toBe("general");
    expect(settingsSectionForUpdates(true, false)).toBe("general");
    expect(settingsSectionForUpdates(true, true)).toBe("general");
    expect(settingsSectionForUpdates(false, true)).toBe("browser");
  });
});
