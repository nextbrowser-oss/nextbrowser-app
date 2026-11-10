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
        tint: "var(--accent)",
        action: "profiles",
        actionLabel: "Show profiles",
      },
      {
        id: "identity",
        icon: "globe",
        title: "Identity",
        caption: "Change country or proxy for a profile.",
        tint: "var(--success)",
        action: "identity",
        actionLabel: "Open profile actions",
      },
      {
        id: "traffic",
        icon: "chart.bar.fill",
        title: "Traffic",
        caption: "See usage, requests, and top domains.",
        tint: "var(--info)",
        action: "usage",
        actionLabel: "View usage",
      },
      {
        id: "live",
        icon: "video.fill",
        title: "Live Streaming",
        caption: "Watch and control the active browser.",
        tint: "var(--red)",
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
        tint: "var(--purple)",
        action: "agent",
        actionLabel: "Choose agent",
      },
      {
        id: "conversations",
        icon: "bubble.left.and.bubble.right.fill",
        title: "Chat",
        caption: "Start or continue a task.",
        tint: "var(--pink)",
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
        tint: "var(--cyan)",
        action: "skills",
        actionLabel: "Open Skills",
      },
      {
        id: "scheduled",
        icon: "clock.arrow.circlepath",
        title: "Schedules",
        caption: "Run recurring tasks while Nextbrowser is open.",
        tint: "var(--accent)",
        action: "scheduled",
        actionLabel: "Open schedules",
      },
    ],
  },
];
