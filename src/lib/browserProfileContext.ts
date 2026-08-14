import type { Workspace } from "../types";

function clean(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 160);
}

export function browserProfileContext(
  workspaces: Workspace[],
  workspaceId?: string,
  selectedProfile?: string,
): string {
  const workspace = workspaces.find((item) => item.id === workspaceId);
  const profiles = (workspace?.profileNames ?? []).slice(0, 100).map((name) => {
    const runtime = workspace?.profileToolsets[name] ?? "clawbrowser";
    const label = runtime === "dasbrowser" ? "DasBrowser" : "ClawBrowser";
    const selected = name === selectedProfile ? ", selected" : "";
    return `- ${clean(name)}: ${label} (workspace: ${clean(workspace?.name ?? "")}${selected})`;
  });
  if (!profiles.length) return "";

  return `\n\nNextBrowser profile runtime context for this chat's workspace (authoritative; do not infer runtime from MCP or nextctl profile metadata):\n${profiles.join("\n")}\nOnly use profiles listed above. Profiles from other workspaces are outside this chat's scope. Use Clawbrowser MCP only for ClawBrowser profiles. A DasBrowser profile is not a Clawbrowser profile. For DasBrowser, start it through nextctl as Chromium with the executable from DASBROWSER_BIN; do not call clawbrowser.start for it.`;
}
