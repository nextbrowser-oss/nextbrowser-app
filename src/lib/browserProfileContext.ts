import type { Workspace } from "../types";

function clean(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 160);
}

export function browserProfileContext(
  workspaces: Workspace[],
  activeWorkspaceId?: string,
  selectedProfile?: string,
): string {
  const workspace = workspaces.find((item) => item.id === activeWorkspaceId);
  if (!workspace?.profileNames.length) return "";

  const profiles = workspace.profileNames.slice(0, 100).map((name) => {
    const runtime = workspace.profileToolsets[name] ?? "clawbrowser";
    const label = runtime === "dasbrowser" ? "DasBrowser" : "ClawBrowser";
    const active = name === selectedProfile ? " (selected)" : "";
    return `- ${clean(name)}: ${label}${active}`;
  });

  return `\n\nNextBrowser profile runtime context (authoritative; do not infer runtime from MCP or nextctl profile metadata):\n${profiles.join("\n")}\nUse Clawbrowser MCP only for ClawBrowser profiles. A DasBrowser profile is not a Clawbrowser profile. For DasBrowser, start it through nextctl as Chromium with the executable from DASBROWSER_BIN; do not call clawbrowser.start for it.`;
}
