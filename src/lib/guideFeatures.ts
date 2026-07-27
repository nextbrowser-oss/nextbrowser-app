import type { AppTab } from "../types";

export type GuideAction =
  | "account"
  | "agent"
  | "profiles"
  | "start_session"
  | "identity"
  | "captcha"
  | "vps"
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

export const CAPTCHA_GUIDE_PROMPT =
  "On the current page in the selected browser profile, detect the captcha. Check for a matching nbc captcha skill, then try `nbc captcha auto`. If it cannot be solved automatically, stop and ask me to take over in Live.";

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
        id: "account",
        icon: "key.fill",
        title: "Account",
        caption: "Connect for profiles, traffic, and skills.",
        tint: "#007aff",
        action: "account",
        actionLabel: "Connect",
      },
      {
        id: "profiles",
        icon: "person.2.fill",
        title: "Profiles",
        caption: "Create, select, start, or stop profiles.",
        tint: "#5856d6",
        action: "profiles",
        actionLabel: "Open profiles",
      },
      {
        id: "identity",
        icon: "globe",
        title: "Identity",
        caption: "Change a profile's country or proxy identity.",
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
        title: "Live View",
        caption: "Watch and control the active browser.",
        tint: "#ff3b30",
        action: "live",
        actionLabel: "Open Live View",
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
        title: "Agents",
        caption: "Connect Claude Code or Codex.",
        tint: "#af52de",
        action: "agent",
        actionLabel: "Choose agent",
      },
      {
        id: "agent-auth",
        icon: "person.badge.key.fill",
        title: "Agent sign-in",
        caption: "Sign in or check the connection.",
        tint: "#ff9500",
        action: "agent",
        actionLabel: "Open agent settings",
      },
      {
        id: "conversations",
        icon: "clock.arrow.circlepath",
        title: "Conversations",
        caption: "Open, rename, or fork saved chats.",
        tint: "#32ade6",
        action: "chat",
        actionLabel: "Open Chat",
      },
      {
        id: "queue",
        icon: "tray.full.fill",
        title: "Queue",
        caption: "Manage active and queued tasks.",
        tint: "#ff2d55",
        action: "chat",
        actionLabel: "Open Chat",
      },
      {
        id: "activity",
        icon: "paperclip",
        title: "Files & activity",
        caption: "Attach files and review task activity.",
        tint: "#ffcc00",
        action: "chat",
        actionLabel: "Open Chat",
      },
    ],
  },
  {
    id: "automation",
    title: "Automation",
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
      {
        id: "vps",
        icon: "terminal",
        title: "VPS",
        caption: "Run a chat on a remote server.",
        tint: "#30b0c7",
        action: "vps",
        actionLabel: "Set up a VPS",
      },
      {
        id: "captcha",
        icon: "checkmark.shield.fill",
        title: "Captcha",
        caption: "Let nbc solve it or continue in Live.",
        tint: "#34c759",
        action: "captcha",
        actionLabel: "Try in Chat",
      },
    ],
  },
];
