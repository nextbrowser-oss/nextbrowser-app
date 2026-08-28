import type { Workspace } from "../types";
import type { MultiloginProfileSelection } from "./multiloginSelection";

function clean(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 160);
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function browserProfileContext(
  workspaces: Workspace[],
  workspaceId?: string,
  selectedProfile?: string,
  multiloginSelection?: MultiloginProfileSelection,
  statuses: Record<string, string> = {},
  identities: Record<string, { country?: string }> = {},
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
    const country = /^[A-Za-z]{2}$/.test(identities[name]?.country ?? "")
      ? `, verified proxy country: ${identities[name].country!.toUpperCase()}`
      : "";
    return `- ${clean(name)}: ${label} (workspace: ${clean(workspace?.name ?? "")}${selected}${running}${country})`;
  });
  const multiloginContext = multiloginSelection
    ? multiloginSelection.kind === "browser"
      ? `\nSelected Multilogin Mimic browser profile for this workspace: ${clean(multiloginSelection.name)} (profile_id: ${clean(multiloginSelection.id)}${multiloginSelection.folderId ? `, folder_id: ${clean(multiloginSelection.folderId)}` : ""}). For browser tasks, use the Clawbrowser MCP start tool with runtime multilogin, this exact profile_id and folder_id, and a stable local profile name. Reuse that profile for subsequent page tools.`
      : `\nSelected Multilogin Android cloud phone for this workspace: ${clean(multiloginSelection.name)} (id: ${clean(multiloginSelection.id)}${multiloginSelection.folderId ? `, folder_id: ${clean(multiloginSelection.folderId)}` : ""}). For a start request, call mcp__nextbrowser__mobile_start exactly once with runtime multilogin, this exact id, and folder_id when present. Use id, never profile_id or name. This selected-profile context is sufficient for start, status, and stop: do not search for tools or read additional references. Do not retry an authentication error; ask the user to reconnect the Multilogin connector. Do not treat it as a CDP browser profile.`
    : "";
  const artifactContext = workspace
    ? `\n\nWhen the user explicitly asks to save a result in Artifact Center, POST JSON to "$NEXTBROWSER_CONTROL_URL/artifact/save" with the same Authorization header and a body shaped as {"name":"result-name","format":"json|csv|txt","content":RESULT}. Artifact Center is local to this computer. Send one complete request. For non-trivial JSON, use curl --data-binary @- with an attached <<'NEXTBROWSER_ARTIFACT_JSON' heredoc containing that complete body; never invoke @- without stdin and never create a temporary workspace file. Do not claim that a file was saved unless this endpoint returns {"ok":true}; report its returned artifact name. If this local endpoint returns unauthorized, report a local Artifact Center authorization failure; never ask the user to reconnect their account, because local artifacts do not use account authentication.`
    : "";
  const hostStartCommands = workspaceProfileNames
    .map((name) => `Start ${clean(name)} exactly: curl -sS -X POST "$NEXTBROWSER_CONTROL_URL/profile/start" -H "Authorization: Bearer $NEXTBROWSER_CONTROL_TOKEN" -H "Content-Type: application/json" --data ${shellSingleQuote(JSON.stringify({ profile: name }))}`)
    .join("\n");
  const hostStartContext = hostStartCommands
    ? ` Authorized recovery commands (available even when status says running because the user may close the browser manually; copy only the matching command and never replace its profile value):\n${hostStartCommands}\n`
    : "";
  if (!profiles.length && !multiloginContext) return artifactContext;

  return `\n\nNextBrowser profile runtime context for this chat's workspace (authoritative; do not infer runtime from MCP or nextctl profile metadata):\n${profiles.join("\n")}${multiloginContext}\nOnly use profiles listed above or the selected Multilogin profile. Profiles from other workspaces are outside this chat's scope. Existing profiles always take priority: match an explicit name exactly, otherwise use the selected profile, otherwise use the sole listed profile. If several profiles are plausible, ask which existing profile to use. Never invent, clone, or create a profile from a site name or task; profile creation belongs in the NextBrowser UI. A runtime label such as ClawBrowser, Camoufox, or DasBrowser is not a profile name and must never be passed as one. Never use a separate Chrome/browser-control skill when a listed NextBrowser profile is available. Never substitute ClawBrowser for a listed Camoufox or DasBrowser profile. Use the NextBrowser MCP interface for ClawBrowser, Camoufox, and Multilogin profiles, always passing the listed runtime. A verified proxy country in this context is current and authoritative: if it matches the requested country, do not rotate, restart, verify, or inspect the profile again. If it differs, perform at most one country change before continuing. For Camoufox, reuse the returned session; it is Firefox/Playwright rather than CDP, so never probe /json/list or start a replacement session. When the target page structure is known, prefer navigate_extract for result pages; this waits only for useful content and combines navigation plus extraction. Prefer multi_action for forms, extract for an already-open result list, and wait(selector/text) after SPA transitions. For a short read-only top-N request on an already-open listing, make one extract or paginate_extract call, save the requested artifact once, and finish immediately. Do not run status, recipe discovery, repeated state, lifecycle, or verification calls first. Call state only when selectors are unknown or an action needs element IDs. When the user gives an exact source URL and selectors are not already known, use open once and then state; do not guess a ready_selector or lose time on a speculative navigate_extract call. For browser research, open and inspect at least one actual source page in the selected profile, then leave the most useful source open; search-result snippets or a separate built-in web search do not complete the browser task. If a search engine blocks automation, navigate directly to a relevant source domain. The NextBrowser app injects a short-lived host-control URL and token into every chat run.${hostStartContext} If the chosen listed profile is stopped, or a page tool reports that its session is missing, run its exact authorized host start command once and then retry the original page action once. On Windows use curl.exe. Do not spawn listed profiles through nextctl or nextbrowser.start; terminal sandboxing can break browser helper processes. Never ask the user to start or reconnect a listed profile manually. After a successful host start, use the canonical session name from the response with NextBrowser MCP page-action tools and the listed runtime. If the host start or retried page action fails, report that error without trying another profile name. The host rejects profiles outside this chat's workspace and profiles occupied by another chat.${artifactContext}`;
}
