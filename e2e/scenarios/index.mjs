// Scenarios in the order of the release checklist (tasks.md).
import workspace from "./workspace.mjs";
import profiles from "./profiles.mjs";
import proxy from "./proxy.mjs";
import agents from "./agents.mjs";
import terminal from "./terminal.mjs";
import sidebar from "./sidebar.mjs";
import scheduled from "./scheduled.mjs";
import guide from "./guide.mjs";
import live from "./live.mjs";
import automation from "./automation.mjs";
import feedback from "./feedback.mjs";
import settings from "./settings.mjs";
import theme from "./theme.mjs";
import account from "./account.mjs";
import restart from "./restart.mjs";

export const scenarios = [workspace, profiles, proxy, agents, terminal, sidebar, scheduled, guide, live, automation, feedback, settings, theme, account, restart];
