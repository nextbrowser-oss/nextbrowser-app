import { translate } from "../shared/lib/i18n";
import type { AppTab } from "../types";

export type GuideAction =
  | "account"
  | "agent"
  | "profiles"
  | "start_session"
  | "identity"
  | Extract<AppTab, "chat" | "skills" | "live" | "usage" | "scheduled">;

export interface GuideFeature {
  id: string;
  icon: string;
  title: string;
  caption: string;
  tint: string;
  action: GuideAction;
  actionLabel: string;
}

interface GuideFeatureGroup {
  id: string;
  title: string;
  features: GuideFeature[];
}

export const GUIDE_FEATURE_GROUPS: GuideFeatureGroup[] = [
  {
    id: "browser",
    get title() { return translate("Browser"); },
    features: [
      {
        id: "profiles",
        icon: "person.2.fill",
        get title() { return translate("Profiles"); },
        get caption() { return translate("Create, select, start, or stop profiles."); },
        tint: "var(--accent)",
        action: "profiles",
        get actionLabel() { return translate("Show profiles"); },
      },
      {
        id: "identity",
        icon: "globe",
        get title() { return translate("Identity"); },
        get caption() { return translate("Change country or proxy for a profile."); },
        tint: "var(--success)",
        action: "identity",
        get actionLabel() { return translate("Open profile actions"); },
      },
      {
        id: "traffic",
        icon: "chart.bar.fill",
        get title() { return translate("Traffic"); },
        get caption() { return translate("See usage, requests, and top domains."); },
        tint: "var(--info)",
        action: "usage",
        get actionLabel() { return translate("View usage"); },
      },
      {
        id: "live",
        icon: "waveform",
        get title() { return translate("Processes"); },
        get caption() { return translate("Watch and control the active browser."); },
        tint: "var(--red)",
        action: "live",
        get actionLabel() { return translate("Open Processes"); },
      },
    ],
  },
  {
    id: "agents",
    get title() { return translate("Agent"); },
    features: [
      {
        id: "agents",
        icon: "cpu.fill",
        get title() { return translate("Agent"); },
        get caption() { return translate("Connect Claude Code or Codex."); },
        tint: "var(--purple)",
        action: "agent",
        get actionLabel() { return translate("Choose agent"); },
      },
      {
        id: "conversations",
        icon: "bubble.left.and.bubble.right.fill",
        get title() { return translate("Chat"); },
        get caption() { return translate("Start or continue a task."); },
        tint: "var(--pink)",
        action: "chat",
        get actionLabel() { return translate("Open Chat"); },
      },
    ],
  },
  {
    id: "automation",
    get title() { return translate("Tools"); },
    features: [
      {
        id: "skills",
        icon: "square.grid.2x2.fill",
        get title() { return translate("Skills"); },
        get caption() { return translate("Use or create reusable browser workflows."); },
        tint: "var(--cyan)",
        action: "skills",
        get actionLabel() { return translate("Open Skills"); },
      },
      {
        id: "scheduled",
        icon: "clock.arrow.circlepath",
        get title() { return translate("Schedules"); },
        get caption() { return translate("Run recurring tasks while this device is awake."); },
        tint: "var(--accent)",
        action: "scheduled",
        get actionLabel() { return translate("Open schedules"); },
      },
    ],
  },
];
