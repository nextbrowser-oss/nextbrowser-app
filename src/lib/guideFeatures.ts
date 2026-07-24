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

interface GuideFeatureGroup {
  id: string;
  title: string;
  description: string;
  features: GuideFeature[];
}

export const GUIDE_FEATURE_GROUPS: GuideFeatureGroup[] = [
  {
    id: "browser",
    title: "Browser & identity",
    description: "Prepare the right browser context, identity, and live session before work begins.",
    features: [
      {
        id: "account",
        icon: "key.fill",
        title: "Account & access",
        caption: "Connect your browser account to use managed profiles, proxy traffic, Remote Control, and published skills.",
        tint: "#007aff",
        action: "account",
        actionLabel: "Connect account",
      },
      {
        id: "profiles",
        icon: "person.2.fill",
        title: "Profiles & sessions",
        caption: "Create a managed or manual-proxy profile, then start, stop, select, or remove it in the sidebar.",
        tint: "#5856d6",
        action: "profiles",
        actionLabel: "Show profiles",
      },
      {
        id: "identity",
        icon: "globe",
        title: "Identity rotation",
        caption: "Use a profile's menu to rotate its identity, choose a country, or verify its current proxy.",
        tint: "#34c759",
        action: "identity",
        actionLabel: "Show profile actions",
      },
      {
        id: "traffic",
        icon: "chart.bar.fill",
        title: "Proxy traffic",
        caption: "Inspect your allocation, date-range history, request count, and reported top domains.",
        tint: "#5ac8fa",
        action: "usage",
        actionLabel: "View traffic",
      },
      {
        id: "live",
        icon: "video.fill",
        title: "Live View",
        caption: "Watch and interact with a running browser session, including its open tabs.",
        tint: "#ff3b30",
        action: "live",
        actionLabel: "Open Live View",
      },
    ],
  },
  {
    id: "agents",
    title: "Agent workspace",
    description: "Connect a local coding agent, supervise its work, and keep every conversation recoverable.",
    features: [
      {
        id: "agents",
        icon: "cpu.fill",
        title: "Claude Code & Codex",
        caption: "Connect through the Claude Code CLI or Codex bundled with the ChatGPT desktop app.",
        tint: "#af52de",
        action: "agent",
        actionLabel: "Choose an agent",
      },
      {
        id: "agent-auth",
        icon: "person.badge.key.fill",
        title: "Agent authentication",
        caption: "Open the selected agent's login flow in Terminal and recheck its sign-in state.",
        tint: "#ff9500",
        action: "agent",
        actionLabel: "Open agent settings",
      },
      {
        id: "conversations",
        icon: "clock.arrow.circlepath",
        title: "Conversations",
        caption: "Keep named chat histories per agent and fork a conversation when the task branches.",
        tint: "#32ade6",
        action: "chat",
        actionLabel: "Open conversations",
      },
      {
        id: "queue",
        icon: "tray.full.fill",
        title: "Queue controls",
        caption: "Queue prompts in order, edit or cancel waiting work, and stop the active run.",
        tint: "#ff2d55",
        action: "chat",
        actionLabel: "Open Chat",
      },
      {
        id: "activity",
        icon: "paperclip",
        title: "Files & activity",
        caption: "Attach local files and inspect streamed output, activity labels, tool events, and stalled runs.",
        tint: "#ffcc00",
        action: "chat",
        actionLabel: "Open Chat",
      },
    ],
  },
  {
    id: "automation",
    title: "Automation & remote work",
    description: "Turn repeatable browser work into supervised local or VPS workflows.",
    features: [
      {
        id: "skills",
        icon: "square.grid.2x2.fill",
        title: "Skills & scripts",
        caption: "Browse published skills when available, or create private browser scripts for repeatable work.",
        tint: "#63e6e2",
        action: "skills",
        actionLabel: "Browse workflows",
      },
      {
        id: "scheduled",
        icon: "clock.arrow.circlepath",
        title: "Scheduled runs",
        caption: "Run recurring prompts at chosen times and weekdays while NextBrowser is open.",
        tint: "#8e8cff",
        action: "scheduled",
        actionLabel: "Open schedules",
      },
      {
        id: "vps",
        icon: "terminal",
        title: "VPS sessions",
        caption: "Create a remote-only chat over SSH using a configured host or manual connection.",
        tint: "#30b0c7",
        action: "vps",
        actionLabel: "Set up a VPS",
      },
      {
        id: "captcha",
        icon: "checkmark.shield.fill",
        title: "Captcha handling",
        caption: "Available captcha skills can attempt supported challenges; some still need human action.",
        tint: "#34c759",
        action: "captcha",
        actionLabel: "Browse skills",
      },
    ],
  },
];
