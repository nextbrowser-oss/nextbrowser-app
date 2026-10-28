import { isMultiloginLauncherDown, MULTILOGIN_APP_NOT_RUNNING } from "./userFacingMultiloginError";

const REMOTE_BACKEND_CODE = /\[REMOTE_BACKEND_ERROR\]/i;
const REMOTE_CONTROL_FAILURE = /(?:detached\s+)?Remote Control(?: child)? failed|create Remote Session/i;

export const BROWSER_PROXY_UNVERIFIED =
  "This profile couldn’t connect through its proxy, so the browser was stopped. This is a problem on our side, not with your setup.";
export const BROWSER_UNVERIFIED =
  "The browser didn’t pass its safety check, so the profile was stopped. This is a problem on our side, not with your setup.";

export const BROWSER_START_TIMED_OUT =
  "The browser took too long to start, so the profile was stopped. Try again: the first start installs the browser and can take a few minutes.";
export const CAMOUFOX_INSTALL_FAILED =
  "Camoufox couldn’t be installed, so the profile was stopped. Check your internet connection, then try again.";
// nbc and the app's own Camoufox install: no Python 3.11–3.13 they can use
// (a Microsoft Store Python does not count), and uv could not download one.
export const CAMOUFOX_PYTHON_MISSING =
  "Camoufox needs Python 3.11–3.13, and Nextbrowser couldn’t download it, so the profile was stopped. Install Python 3.13 from python.org (on Windows, not the Microsoft Store version), then start the profile again.";
// Debian and Ubuntu ship Python without venv (ensurepip), so nbc 1.2.37 and
// older cannot build Camoufox's Python environment there; newer nbc falls back
// to its own Python and does not get here.
export const CAMOUFOX_PYTHON_VENV_MISSING =
  "Camoufox couldn’t set up its Python environment, so the profile was stopped. Install the python3-venv package (on Debian or Ubuntu: sudo apt install python3-venv), then start the profile again.";
export const BROWSER_START_FAILED =
  "The browser couldn’t start, so the profile was stopped. This is a problem on our side, not with your setup.";

// Before the first managed-proxy start, nbc has the backend migrate the
// account's proxy (NodeMaven) account. When the backend refuses, nothing ran,
// but nbc wraps the refusal in VERIFY_FAILED, which read as a failed browser
// check for a week. The backend's code says what happened: migration_failed,
// migration_status_failed, migration_unavailable, or migration_deferred, after
// which the next start goes ahead. The same rule is in
// electron/profile-start-failure.cjs for starts an agent asked for.
export const PROXY_ACCOUNT_SETUP_FAILED =
  "We couldn’t set up your proxy account, so the profile was stopped. This is on our side: try again in a minute, and if it keeps happening, message us in Discord.";
export const PROXY_ACCOUNT_SETUP_DEFERRED =
  "We couldn’t set up your proxy account, so the profile was stopped. This is on our side. Start the profile again.";
const MIGRATION_FAILURE = /migrate NodeMaven account|migrate proxy traffic|\bmigration_(?:failed|status_failed|unavailable|deferred)\b|proxy account was not ready|resume migration/i;
const MIGRATION_DEFERRED = /\bmigration_deferred\b/i;

/** True when a start failed because the backend could not set up the
 *  account's proxy account: nothing about the proxy or this computer. */
export function isProxyAccountSetupFailure(error: unknown): boolean {
  return MIGRATION_FAILURE.test(rawErrorMessage(error));
}

// Browser profiles connect to their proxy (the NodeMaven gateway) directly:
// nbc starts the browser with an explicit proxy, and Chromium cannot put a
// VPN's proxy in front of it. A VPN in system-proxy mode (a proxy on this
// computer) therefore does not carry the profile's connection, and where the
// direct path is blocked the start fails with one of these. The same rule and
// text are in electron/profile-start-failure.cjs.
export const VPN_SYSTEM_PROXY_HINT =
  "Your VPN works as a system proxy, and browser profiles connect to their proxy directly. Turn on TUN (VPN) mode in your VPN app, or let gate.nodemaven.com bypass the VPN.";
const PROXY_PATH_FAILURE =
  /ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED|ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT|proxy[^.\n]*(?:refused|unreachable|timed? ?out|timeout)|proxy profile cannot continue without its proxy|proxy[_ ]required|failed browser checks:[^;]*\bproxy\b|Command timed out|did not complete before timeout|context deadline exceeded|did not become ready in time/i;

/** True when a profile start failed the way a blocked path to its proxy fails: a proxy or tunnel error, or a timeout. */
export function isProxyPathFailure(error: unknown): boolean {
  const raw = rawErrorMessage(error);
  // A proxy account the backend could not set up is not a path problem.
  return !isProxyAccountSetupFailure(raw) && PROXY_PATH_FAILURE.test(raw);
}

// nextctl wraps every failed start of a verified profile in VERIFY_FAILED, so
// a browser that never got as far as its checks looks like a failed proxy
// check. The code after "browser stopped:" tells them apart: VERIFY_REQUIRED
// is the check itself, any other code means the start failed before it.
const STARTUP_FAILURE_CODE = /browser stopped:\s*([A-Z][A-Z0-9_]{2,}):/;

/** True when a verified start failed before the browser could be checked,
 *  for example while installing the runtime or launching the browser. */
export function isBrowserStartFailure(error: unknown): boolean {
  const code = rawErrorMessage(error).match(STARTUP_FAILURE_CODE)?.[1];
  return !!code && code !== "VERIFY_REQUIRED";
}

// nextctl ends every failed startup check with "A proxy profile cannot
// continue without its proxy.", profiles without a proxy included, so that
// hint says nothing about the cause. Only a failed proxy check or a proxy the
// profile requires does.
const PROXY_CHECK_FAILURE = /proxy required|proxy_required|failed browser checks:[^;]*\bproxy\b/i;
const FAILED_CHECKS = /failed browser checks:\s*([^;\n\[]+)/i;

/** " Failed checks: a, b." from nextctl's list, so a screenshot sent to
 *  support names the check that stopped the profile. */
function failedChecksNote(raw: string): string {
  const names = (raw.match(FAILED_CHECKS)?.[1] ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => /^[A-Za-z0-9_ -]{1,40}$/.test(name))
    .slice(0, 6);
  return names.length ? ` Failed checks: ${names.join(", ")}.` : "";
}

function browserStartFailureMessage(raw: string): string {
  if (/did not complete before timeout|context deadline exceeded|did not become ready in time/i.test(raw)) return BROWSER_START_TIMED_OUT;
  if (/ensurepip is not\s+available|python3(?:\.\d+)?-venv/i.test(raw)) return CAMOUFOX_PYTHON_VENV_MISSING;
  if (/prepare Camoufox runtime|install Camoufox|download Camoufox/i.test(raw)) return CAMOUFOX_INSTALL_FAILED;
  return BROWSER_START_FAILED;
}

/** True when the error is a browser verification failure: the profile was
 *  stopped by our own check, so the user needs support rather than a retry. */
export function isBrowserVerificationFailure(error: unknown): boolean {
  const raw = rawErrorMessage(error);
  return /VERIFY_FAILED|VERIFY_REQUIRED/i.test(raw) && !/managed-proxy privacy capability/i.test(raw);
}

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

  if (/workspace not found|workspace revision conflict/i.test(raw)) {
    return "The selected workspace is no longer available. Select or create a workspace, then try again.";
  }

  if (/Cannot reach the Nextbrowser backend|Nextbrowser could not connect to the service|NEXTBROWSER_BACKEND_UNAVAILABLE/i.test(raw)) {
    return "Nextbrowser couldn’t connect to the service. Check your internet connection and try again.";
  }

  if (/Proxy traffic limit reached|PROXY_TRAFFIC_EXHAUSTED/i.test(raw)) {
    return "Proxy traffic limit reached. Open Proxy usage to add more traffic, then retry Live View.";
  }

  if (REMOTE_BACKEND_CODE.test(raw) || REMOTE_CONTROL_FAILURE.test(raw)) {
    if (/\b404\b|not found/i.test(raw)) {
      return "Remote Control is not available on the connected Nextbrowser service. Update Nextbrowser and try again. If it continues, contact support.";
    }
    if (/\b40[13]\b|unauthorized|forbidden/i.test(raw)) {
      return "Remote Control could not authenticate. Sign in to Nextbrowser again, then retry.";
    }
    if (/\b5\d\d\b|bad gateway|service unavailable/i.test(raw)) {
      return "Remote Control is temporarily unavailable. Try again in a moment.";
    }
    if (/timeout|timed out|connection|network|fetch failed/i.test(raw)) {
      return "Remote Control could not connect. Check your internet connection and try again.";
    }
    return "Remote Control could not start. Restart the browser profile and try again.";
  }

  if (isMultiloginLauncherDown(raw)) return MULTILOGIN_APP_NOT_RUNNING;

  if (/\[CDP_UNREACHABLE\]|CDP endpoint is not reachable/i.test(raw)) {
    return "The browser profile stopped responding. Restart the profile and try again.";
  }

  if (/\[LOCAL_PROXY_UNSUPPORTED\]/i.test(raw)) {
    return "This proxy runs on your computer. Use Camoufox or DasBrowser for a localhost proxy; Clawbrowser support for local proxy ports is coming soon.";
  }

  // The installed Clawbrowser build cannot enforce managed-proxy privacy, so
  // nextctl refuses to launch a proxied profile. Surface one short action
  // instead of the whole VERIFY_FAILED/LAUNCH_FAILED chain.
  if (/managed-proxy privacy capability/i.test(raw)) {
    return "This Clawbrowser build can’t run a proxied profile. Update Clawbrowser, then retry.";
  }

  // Checked before the generic start failure: its detail also names
  // "prepare Camoufox runtime", but a connection check would not help.
  if (/\bCAMOUFOX_PYTHON_MISSING\b/.test(raw)) return CAMOUFOX_PYTHON_MISSING;

  // The backend refused to set up the proxy account before the start, so no
  // browser ran and nothing was checked, whatever VERIFY_FAILED suggests.
  if (isProxyAccountSetupFailure(raw)) return MIGRATION_DEFERRED.test(raw) ? PROXY_ACCOUNT_SETUP_DEFERRED : PROXY_ACCOUNT_SETUP_FAILED;

  // Verification failures often contain a nested CDP transport error from the
  // browser we just stopped. Report the failed proxy check, not a transient
  // browser connection that sounds safe to retry without inspecting the proxy.
  // The user cannot fix either one, so the message points at us, not at them.
  if (isBrowserStartFailure(raw)) return browserStartFailureMessage(raw);

  if (/VERIFY_FAILED|VERIFY_REQUIRED/i.test(raw)) {
    const message = PROXY_CHECK_FAILURE.test(raw) ? BROWSER_PROXY_UNVERIFIED : BROWSER_UNVERIFIED;
    return `${message}${failedChecksNote(raw)}`;
  }

  if (/(?:\bcdp\b.*(?:read response|connection|aborted|closed|reset)|Runtime\.evaluate.*(?:read|connection|aborted|closed|reset)|wsarecv.*(?:aborted|reset)|read tcp.*(?:aborted|reset))/i.test(raw)) {
    return "The browser connection was interrupted. Nextbrowser retried once; if it keeps happening, restart the profile and try again.";
  }

  if (/ERR_TUNNEL_CONNECTION_FAILED/i.test(raw)) {
    return "The selected profile’s proxy could not connect. Check or change its proxy, then run the automation again.";
  }

  // Never expose private filesystem locations from host-process diagnostics.
  return raw
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*(?:Error:\s*)?/i, "")
    .replace(/;?\s*see log\s+[^\r\n]+/gi, "")
    .replace(/(?:\/Users|\/home)\/[^\s;]+/g, "the local diagnostic log")
    .trim();
}
