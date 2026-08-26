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
  statuses: Record<string, string> = {},
): string {
  const workspace = workspaces.find((item) => item.id === workspaceId);
  const workspaceProfileNames = workspace?.profileNames ?? [];
  const effectiveProfile = workspaceProfileNames.includes(selectedProfile ?? "")
    ? selectedProfile
    : workspaceProfileNames.length === 1
      ? workspaceProfileNames[0]
      : undefined;
  const profiles = workspaceProfileNames.slice(0, 100).map((name) => {
    const runtime = workspace?.profileToolsets[name] ?? "clawbrowser";
    const label = runtime === "dasbrowser" ? "DasBrowser" : runtime === "camoufox" ? "Camoufox" : "ClawBrowser";
    const selected = name === effectiveProfile
      ? name === selectedProfile ? ", selected" : ", sole profile; use by default"
      : "";
    const running = statuses[name] === "running" ? ", running; reuse without starting" : "";
    return `- ${clean(name)}: ${label} (workspace: ${clean(workspace?.name ?? "")}${selected}${running})`;
  });
  const multiloginContext = multiloginSelection
    ? multiloginSelection.kind === "browser"
      ? `\nSelected Multilogin Mimic browser profile for this workspace: ${clean(multiloginSelection.name)} (profile_id: ${clean(multiloginSelection.id)}${multiloginSelection.folderId ? `, folder_id: ${clean(multiloginSelection.folderId)}` : ""}). For browser tasks, use the Clawbrowser MCP start tool with runtime multilogin, this exact profile_id and folder_id, and a stable local profile name. Reuse that profile for subsequent page tools.`
      : `\nSelected Multilogin Android cloud phone for this workspace: ${clean(multiloginSelection.name)} (id: ${clean(multiloginSelection.id)}${multiloginSelection.folderId ? `, folder_id: ${clean(multiloginSelection.folderId)}` : ""}). For a start request, call mcp__nextbrowser__mobile_start exactly once with runtime multilogin, this exact id, and folder_id when present. Use id, never profile_id or name. This selected-profile context is sufficient for start, status, and stop: do not search for tools or read additional references. Do not retry an authentication error; ask the user to reconnect the Multilogin connector. Do not treat it as a CDP browser profile.`
    : "";
  const artifactContext = workspace
    ? `\n\nWhen the user explicitly asks to save a result in Artifact Center, POST JSON to "$NEXTBROWSER_CONTROL_URL/artifact/save" with the same Authorization header and a body shaped as {"name":"result-name","format":"json|csv|txt","content":RESULT}. Artifact Center is local to this computer. Do not claim that a file was saved unless this endpoint returns {"ok":true}; report its returned artifact name. If this local endpoint returns unauthorized, report a local Artifact Center authorization failure; never ask the user to reconnect their account, because local artifacts do not use account authentication.`
    : "";
  if (!profiles.length && !multiloginContext) return artifactContext;

  return `\n\nNextBrowser profile runtime context for this chat's workspace (authoritative; do not infer runtime from MCP or nextctl profile metadata):\n${profiles.join("\n")}${multiloginContext}\nOnly use profiles listed above or the selected Multilogin profile. Profiles from other workspaces are outside this chat's scope. Existing profiles always take priority: match an explicit name exactly, otherwise use the selected profile, otherwise use the sole listed profile. If several profiles are plausible, ask which existing profile to use. Never invent, clone, or create a profile from a site name or task; profile creation belongs in the NextBrowser UI. Never use a separate Chrome/browser-control skill when a listed NextBrowser profile is available. Never substitute ClawBrowser for a listed Camoufox or DasBrowser profile. Use the NextBrowser MCP interface for ClawBrowser, Camoufox, and Multilogin profiles, always passing the listed runtime. For Camoufox, call start once and reuse the returned session; it is Firefox/Playwright rather than CDP, so never probe /json/list or start a replacement session. When the target page structure is known, pass wait_for.selector to start and prefer navigate_extract for result pages; this waits only for useful content and combines navigation plus extraction. Prefer multi_action for forms, extract for an already-open result list, and wait(selector/text) after SPA transitions. Call state only when selectors are unknown or an action needs element IDs. When the user gives an exact source URL and selectors are not already known, use open once and then state; do not guess a ready_selector or lose time on a speculative navigate_extract call. For browser research, open and inspect at least one actual source page in the selected profile, then leave the most useful source open; search-result snippets or a separate built-in web search do not complete the browser task. If a search engine blocks automation, navigate directly to a relevant source domain. A DasBrowser profile is not a ClawBrowser profile. To start or stop a DasBrowser profile, do not spawn it through nextctl or nextbrowser.start because terminal sandboxing breaks its helper processes. The NextBrowser app injects a short-lived host-control URL and token into every chat run. Use them directly and never ask the user to start or reconnect a stopped DasBrowser profile manually: curl -sS -X POST "$NEXTBROWSER_CONTROL_URL/profile/ACTION" -H "Authorization: Bearer $NEXTBROWSER_CONTROL_TOKEN" -H "Content-Type: application/json" --data '{"profile":"PROFILE_NAME"}', replacing ACTION with start or stop. On Windows use curl.exe. After a successful host start, control the already-running DasBrowser session with NextBrowser MCP page-action tools using the exact same profile name, but never call nextbrowser.start for it. The host rejects profiles outside this chat's workspace and profiles occupied by another chat.${artifactContext}`;
}
