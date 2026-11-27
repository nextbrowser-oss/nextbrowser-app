import { translate } from "../shared/lib/i18n";
import type { TrafficGateTone } from "./trafficGate";

// The Settings dialog shows one section at a time, picked from a rail on the
// left. Every setting lives in exactly one section.
export type SettingsSection = "general" | "themes" | "updates" | "privacy" | "devices" | "agent" | "browser" | "proxy";

export interface SettingsSectionInfo {
  id: SettingsSection;
  label: string;
  icon: string;
  summary: string;
}

export const SETTINGS_SECTIONS: readonly SettingsSectionInfo[] = [
  { id: "general", get label() { return translate("General"); }, icon: "gearshape", get summary() { return translate("Interface size and app version."); } },
  { id: "themes", get label() { return translate("Themes"); }, icon: "palette", get summary() { return translate("Customize light and dark appearance separately."); } },
  { id: "updates", get label() { return translate("Updates"); }, icon: "arrow.down.circle", get summary() { return translate("Installed versions, available updates, and download progress."); } },
  { id: "privacy", get label() { return translate("Privacy"); }, icon: "checkmark.shield", get summary() { return translate("Error reports and the device data sent with your account."); } },
  { id: "devices", get label() { return translate("Device sessions"); }, icon: "desktopcomputer", get summary() { return translate("Devices connected to your Nextbrowser account."); } },
  { id: "agent", get label() { return translate("Agent"); }, icon: "cpu.fill", get summary() { return translate("The local agent used for chats, skills, and scheduled runs."); } },
  { id: "browser", get label() { return translate("Browser"); }, icon: "globe", get summary() { return translate("Browser control, profiles, and installed toolsets."); } },
  { id: "proxy", get label() { return translate("Proxy"); }, icon: "network", get summary() { return translate("Managed proxy state and traffic."); } },
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
  /** The active agent is the built-in Nextbrowser agent, which is set up in Agent rather than connected. */
  builtinAgent: boolean;
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
  if (input.appUpdate || input.toolsetUpdate) attention.updates = "update available";
  if (!input.agentReady) attention.agent = input.agentNeedsLogin ? "sign-in required" : input.builtinAgent ? "not set up" : "not connected";
  if (input.proxyTone === "paused") attention.proxy = "traffic paused";
  else if (input.proxyTone === "warn") attention.proxy = "traffic near its limit";
  return attention;
}

/**
 * The section the Settings button opens on. Its dot announces an app or a
 * toolset update, so either opens the shared Updates section.
 */
export function settingsSectionForUpdates(appUpdate: boolean, toolsetUpdate: boolean): SettingsSection {
  return appUpdate || toolsetUpdate ? "updates" : "general";
}
