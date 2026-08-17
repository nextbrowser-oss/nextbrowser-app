import type { Workspace } from "../types";
import type { MultiloginProfileSelection } from "./multiloginSelection";

function clean(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 160);
}

export function browserProfileContext(
  workspaces: Workspace[],
  workspaceId?: string,
  selectedProfile?: string,
  multiloginSelection?: MultiloginProfileSelection,
): string {
  const workspace = workspaces.find((item) => item.id === workspaceId);
  const profiles = (workspace?.profileNames ?? []).slice(0, 100).map((name) => {
    const runtime = workspace?.profileToolsets[name] ?? "clawbrowser";
    const label = runtime === "dasbrowser" ? "DasBrowser" : runtime === "camoufox" ? "Camoufox" : "ClawBrowser";
    const selected = name === selectedProfile ? ", selected" : "";
    return `- ${clean(name)}: ${label} (workspace: ${clean(workspace?.name ?? "")}${selected})`;
  });
  const multiloginContext = multiloginSelection
    ? multiloginSelection.kind === "browser"
      ? `\nSelected Multilogin Mimic browser profile for this workspace: ${clean(multiloginSelection.name)} (profile_id: ${clean(multiloginSelection.id)}${multiloginSelection.folderId ? `, folder_id: ${clean(multiloginSelection.folderId)}` : ""}). For browser tasks, use the Clawbrowser MCP start tool with runtime multilogin, this exact profile_id and folder_id, and a stable local profile name. Reuse that profile for subsequent page tools.`
      : `\nSelected Multilogin Android cloud phone for this workspace: ${clean(multiloginSelection.name)} (id: ${clean(multiloginSelection.id)}${multiloginSelection.folderId ? `, folder_id: ${clean(multiloginSelection.folderId)}` : ""}). For a start request, call mcp__clawbrowser__mobile_start exactly once with runtime multilogin, this exact id, and folder_id when present. Use id, never profile_id or name. This selected-profile context is sufficient for start, status, and stop: do not search for tools or read additional references. Do not retry an authentication error; ask the user to reconnect the Multilogin connector. Do not treat it as a CDP browser profile.`
    : "";
  if (!profiles.length && !multiloginContext) return "";

  return `\n\nNextBrowser profile runtime context for this chat's workspace (authoritative; do not infer runtime from MCP or nextctl profile metadata):\n${profiles.join("\n")}${multiloginContext}\nOnly use profiles listed above or the selected Multilogin profile. Profiles from other workspaces are outside this chat's scope. Use the Clawbrowser MCP interface for ClawBrowser, Camoufox, and Multilogin profiles, always passing the listed runtime. For Camoufox, call start once and reuse the returned session; it is Firefox/Playwright rather than CDP, so never probe /json/list or start a replacement session. When the target page structure is known, pass wait_for.selector to start and prefer navigate_extract for result pages; this waits only for useful content and combines navigation plus extraction. Prefer multi_action for forms, extract for an already-open result list, and wait(selector/text) after SPA transitions. Call state only when selectors are unknown or an action needs element IDs. A DasBrowser profile is not a Clawbrowser profile. To start or stop a DasBrowser profile, do not spawn it through nextctl or clawbrowser.start because terminal sandboxing breaks its helper processes. Ask the NextBrowser host with: curl -sS -X POST "$NEXTBROWSER_CONTROL_URL/profile/ACTION" -H "Authorization: Bearer $NEXTBROWSER_CONTROL_TOKEN" -H "Content-Type: application/json" --data '{"profile":"PROFILE_NAME"}', replacing ACTION with start or stop. On Windows use curl.exe. The host rejects profiles outside this chat's workspace and profiles occupied by another chat.`;
}
