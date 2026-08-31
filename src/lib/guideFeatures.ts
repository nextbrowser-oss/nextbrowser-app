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
    title: "Browser",
    features: [
      {
        id: "profiles",
        icon: "person.2.fill",
        title: "Profiles",
        caption: "Create, select, start, or stop profiles.",
        tint: "#5856d6",
        action: "profiles",
        actionLabel: "Show profiles",
      },
      {
        id: "identity",
        icon: "globe",
        title: "Identity",
        caption: "Change country or proxy for a profile.",
        tint: "#34c759",
        action: "identity",
        actionLabel: "Open profile actions",
      },
      {
        id: "traffic",
        icon: "chart.bar.fill",
        title: "Traffic",
        caption: "See usage, requests, and top domains.",
        tint: "#5ac8fa",
        action: "usage",
        actionLabel: "View usage",
      },
      {
        id: "live",
        icon: "video.fill",
        title: "Live Streaming",
        caption: "Watch and control the active browser.",
        tint: "#ff3b30",
        action: "live",
        actionLabel: "Open Live Streaming",
      },
    ],
  },
  {
    id: "agents",
    title: "Agent",
    features: [
      {
        id: "agents",
        icon: "cpu.fill",
        title: "Agent",
        caption: "Connect Claude Code or Codex.",
        tint: "#af52de",
        action: "agent",
        actionLabel: "Choose agent",
      },
      {
        id: "conversations",
        icon: "bubble.left.and.bubble.right.fill",
        title: "Chat",
        caption: "Start or continue a task.",
        tint: "#ff2d55",
        action: "chat",
        actionLabel: "Open Chat",
      },
    ],
  },
  {
    id: "automation",
    title: "Tools",
    features: [
      {
        id: "skills",
        icon: "square.grid.2x2.fill",
        title: "Skills",
        caption: "Use or create reusable browser workflows.",
        tint: "#63e6e2",
        action: "skills",
        actionLabel: "Open Skills",
      },
      {
        id: "scheduled",
        icon: "clock.arrow.circlepath",
        title: "Schedules",
        caption: "Run recurring tasks while NextBrowser is open.",
        tint: "#8e8cff",
        action: "scheduled",
        actionLabel: "Open schedules",
      },
    ],
  },
];
