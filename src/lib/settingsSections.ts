import type { TrafficGateTone } from "./trafficGate";

// The Settings dialog shows one section at a time, picked from a rail on the
// left. Every setting lives in exactly one section.
export type SettingsSection = "general" | "privacy" | "agent" | "browser" | "proxy";

export interface SettingsSectionInfo {
  id: SettingsSection;
  label: string;
  icon: string;
  summary: string;
}

export const SETTINGS_SECTIONS: readonly SettingsSectionInfo[] = [
  { id: "general", label: "General", icon: "gearshape", summary: "App version, updates, and interface size." },
  { id: "privacy", label: "Privacy", icon: "checkmark.shield", summary: "Error reports and the device data sent with your account." },
  { id: "agent", label: "Agent", icon: "cpu.fill", summary: "The local agent used for chats, skills, and scheduled runs." },
  { id: "browser", label: "Browser", icon: "globe", summary: "Browser control, profiles, and installed toolsets." },
  { id: "proxy", label: "Proxy", icon: "network", summary: "Managed proxy state and traffic." },
];

export function settingsSectionInfo(section: SettingsSection): SettingsSectionInfo {
  return SETTINGS_SECTIONS.find((item) => item.id === section) ?? SETTINGS_SECTIONS[0];
}

/**
 * The section the rail moves to for a key: Up and Down step through the
 * sections and wrap around, Home and End jump to the first and the last.
 * Any other key is not the rail's, so the answer is undefined.
 */
export function settingsSectionAfterKey(current: SettingsSection, key: string): SettingsSection | undefined {
  const last = SETTINGS_SECTIONS.length - 1;
  const index = Math.max(0, SETTINGS_SECTIONS.findIndex((item) => item.id === current));
  const next = key === "Home" ? 0
    : key === "End" ? last
      : key === "ArrowDown" ? (index === last ? 0 : index + 1)
        : key === "ArrowUp" ? (index === 0 ? last : index - 1)
          : undefined;
  return next === undefined ? undefined : SETTINGS_SECTIONS[next].id;
}

export interface SettingsAttentionInput {
  /** An app update is available, downloading or downloaded. */
  appUpdate: boolean;
  /** A browser toolset has a newer release. */
  toolsetUpdate: boolean;
  agentReady: boolean;
  agentNeedsLogin: boolean;
  /** How the proxy state is drawn (trafficGateStateTone). */
  proxyTone: TrafficGateTone;
}

/**
 * Why a section's rail item carries a dot. Only states Settings already
 * flags are used: an update, an agent that is not ready, and proxy traffic
 * that is paused or near its limit.
 */
export function settingsAttention(input: SettingsAttentionInput): Partial<Record<SettingsSection, string>> {
  const attention: Partial<Record<SettingsSection, string>> = {};
  if (input.appUpdate) attention.general = "update available";
  if (!input.agentReady) attention.agent = input.agentNeedsLogin ? "sign-in required" : "not connected";
  if (input.toolsetUpdate) attention.browser = "update available";
  if (input.proxyTone === "paused") attention.proxy = "traffic paused";
  else if (input.proxyTone === "warn") attention.proxy = "traffic near its limit";
  return attention;
}

/**
 * The section the Settings button opens on. Its dot announces an app or a
 * toolset update, so it opens where that update is: General for the app,
 * Browser when only a toolset has one.
 */
export function settingsSectionForUpdates(appUpdate: boolean, toolsetUpdate: boolean): SettingsSection {
  return !appUpdate && toolsetUpdate ? "browser" : "general";
}
