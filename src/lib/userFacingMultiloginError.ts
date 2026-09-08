/**
 * Turns Multilogin CLI and IPC diagnostics into something a user can act on.
 * The caller is still responsible for logging the raw error.
 */
const IPC_PREFIX = /^Error invoking remote method ['"][^'"]+['"]:\s*(?:Error:\s*)?/i;

export function userFacingMultiloginError(error: unknown, kind: "browser" | "mobile" = "browser"): string {
  const raw = (error instanceof Error ? error.message : String(error ?? "")).replace(IPC_PREFIX, "").trim();
  if (!raw) return "Multilogin did not respond. Try again.";

  const profiles = kind === "browser" ? "browser profiles" : "cloud phones";

  if (/workspace has no "Default folder"/i.test(raw)) {
    return `The connected Multilogin workspace has no "Default folder" for ${profiles}, so NextBrowser has nowhere to read or create them. Create that folder in Multilogin, or connect a token for a workspace that has one.`;
  }
  if (/workspace has multiple "Default folder"/i.test(raw)) {
    return `The connected Multilogin workspace has more than one "Default folder" for ${profiles}. Rename all but one in Multilogin, then refresh.`;
  }
  if (/folder .* was not found in the token workspace/i.test(raw)) {
    return "That Multilogin folder is not in the workspace this token belongs to. Connect a token for the right workspace, then refresh.";
  }
  if (/token is invalid or expired|automation token is invalid/i.test(raw)) {
    return "The Multilogin token expired. Reconnect Multilogin with a fresh token.";
  }
  if (/cannot access this workspace|forbidden/i.test(raw)) {
    return "This Multilogin token cannot access that workspace or folder. Connect a token with access, then refresh.";
  }
  if (/timed out|timeout/i.test(raw)) {
    return "Multilogin took too long to respond. Check your connection, then try again.";
  }

  return raw.replace(/(?:\/Users|\/home)\/[^\s;]+/g, "the local diagnostic log").trim();
}
