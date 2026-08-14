import type { Workspace } from "../types";

function clean(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 160);
}

export function browserProfileContext(
  workspaces: Workspace[],
  activeWorkspaceId?: string,
  selectedProfile?: string,
): string {
  const seen = new Set<string>();
  const profiles = workspaces.flatMap((workspace) => workspace.profileNames.map((name) => ({ name, workspace })))
    .filter(({ name }) => {
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .slice(0, 100)
    .map(({ name, workspace }) => {
      const runtime = workspace.profileToolsets[name] ?? "clawbrowser";
      const label = runtime === "dasbrowser" ? "DasBrowser" : "ClawBrowser";
      const selected = name === selectedProfile ? ", selected" : "";
      const activeWorkspace = workspace.id === activeWorkspaceId ? ", active workspace" : "";
      return `- ${clean(name)}: ${label} (workspace: ${clean(workspace.name)}${selected}${activeWorkspace})`;
    });
  if (!profiles.length) return "";

  return `\n\nNextBrowser profile runtime context (authoritative; do not infer runtime from MCP or nextctl profile metadata):\n${profiles.join("\n")}\nUse Clawbrowser MCP only for ClawBrowser profiles. A DasBrowser profile is not a Clawbrowser profile. For DasBrowser, start it through nextctl as Chromium with the executable from DASBROWSER_BIN; do not call clawbrowser.start for it.`;
}
