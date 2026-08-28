const REMOTE_BACKEND_CODE = /\[REMOTE_BACKEND_ERROR\]/i;
const REMOTE_CONTROL_FAILURE = /(?:detached\s+)?Remote Control(?: child)? failed|create Remote Session/i;

function rawErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error ?? "")).trim();
}

/**
 * Converts browser-runtime diagnostics into an actionable UI message. The raw
 * error must still be logged by the caller before using this function.
 */
export function userFacingBrowserError(error: unknown): string {
  const raw = rawErrorMessage(error);
  if (!raw) return "The browser could not be prepared. Try again.";

  if (/AUTOMATION_SHARE_WORKSPACE_UNAVAILABLE|workspace not found|workspace revision conflict/i.test(raw)) {
    return "This workspace is not available for the signed-in account. Select or create a workspace for this account, then add the shared copy again.";
  }

  if (REMOTE_BACKEND_CODE.test(raw) || REMOTE_CONTROL_FAILURE.test(raw)) {
    if (/\b404\b|not found/i.test(raw)) {
      return "Remote Control is not available on the connected NextBrowser service. Update NextBrowser and try again. If it continues, contact support.";
    }
    if (/\b40[13]\b|unauthorized|forbidden/i.test(raw)) {
      return "Remote Control could not authenticate. Sign in to NextBrowser again, then retry.";
    }
    if (/\b5\d\d\b|bad gateway|service unavailable/i.test(raw)) {
      return "Remote Control is temporarily unavailable. Try again in a moment.";
    }
    if (/timeout|timed out|connection|network|fetch failed/i.test(raw)) {
      return "Remote Control could not connect. Check your internet connection and try again.";
    }
    return "Remote Control could not start. Restart the browser profile and try again.";
  }

  if (/\[CDP_UNREACHABLE\]|CDP endpoint is not reachable/i.test(raw)) {
    return "The browser profile stopped responding. Restart the profile and try again.";
  }

  // Never expose private filesystem locations from host-process diagnostics.
  return raw
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*(?:Error:\s*)?/i, "")
    .replace(/;?\s*see log\s+[^\r\n]+/gi, "")
    .replace(/(?:\/Users|\/home)\/[^\s;]+/g, "the local diagnostic log")
    .trim();
}
