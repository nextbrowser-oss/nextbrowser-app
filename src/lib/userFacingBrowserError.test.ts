import { describe, expect, it } from "vitest";
import {
  BROWSER_PROXY_UNVERIFIED,
  BROWSER_UNVERIFIED,
  BROWSER_START_FAILED,
  BROWSER_START_TIMED_OUT,
  CAMOUFOX_INSTALL_FAILED,
  CAMOUFOX_PYTHON_MISSING,
  CAMOUFOX_PYTHON_VENV_MISSING,
  PROXY_ACCOUNT_SETUP_DEFERRED,
  PROXY_ACCOUNT_SETUP_FAILED,
  isBrowserStartFailure,
  isBrowserVerificationFailure,
  isProxyAccountSetupFailure,
  isProxyPathFailure,
  userFacingBrowserError,
} from "./userFacingBrowserError";

// nbc 1.2.38 in production, 28.10.2026: the backend refused to migrate the
// account's proxy account before the first managed-proxy start. The app
// blamed the browser's safety check in the sidebar and the proxy in the
// dialog, and users blamed their VPNs.
const MIGRATION_FAILED = "VERIFY_FAILED: migrate NodeMaven account before profile startup: migrate proxy traffic: unexpected status 502 Bad Gateway: {\"code\":\"migration_failed\",\"message\":\"Could not safely migrate the proxy account; browser startup was stopped\"}";
// The same, as the app sees it: prefixed by the preflight step, with nbc's
// code and hint appended by nextctlErrorMessage.
const MIGRATION_FAILED_IN_APP = `Could not start Nextbrowser: ${MIGRATION_FAILED} [VERIFY_FAILED] — The proxy account was not ready; the profile was not started. Retry to resume migration.`;

describe("userFacingBrowserError", () => {
  it("turns a Remote Control 404 into an actionable message without internals", () => {
    const raw = "detached Remote Control child failed: create Remote Session: unexpected status 404 Not Found: {\"message\":\"Not Found\"}; see log /Users/person/.nextbrowser/runtime/child.log [REMOTE_BACKEND_ERROR]";
    const message = userFacingBrowserError(new Error(raw));

    expect(message).toBe("Remote Control is not available on the connected Nextbrowser service. Update Nextbrowser and try again. If it continues, contact support.");
    expect(message).not.toMatch(/child|\/Users|REMOTE_BACKEND_ERROR|404/);
  });

  it("explains authentication and connectivity failures", () => {
    expect(userFacingBrowserError("create Remote Session: 401 Unauthorized [REMOTE_BACKEND_ERROR]"))
      .toContain("Sign in to Nextbrowser again");
    expect(userFacingBrowserError("detached Remote Control child failed: network timeout [REMOTE_BACKEND_ERROR]"))
      .toContain("Check your internet connection");
  });

  it("explains exhausted proxy traffic before generic Remote Control errors", () => {
    const raw = "detached Remote Control child failed: Proxy traffic limit reached; see log /Users/person/private/child.log";
    const message = userFacingBrowserError(raw);
    expect(message).toBe("Proxy traffic limit reached. Open Proxy usage to add more traffic, then retry Live View.");
    expect(message).not.toMatch(/\/Users|child\.log/);
  });

  it("explains an unreachable browser profile", () => {
    expect(userFacingBrowserError("CDP endpoint is not reachable [CDP_UNREACHABLE]"))
      .toBe("The browser profile stopped responding. Restart the profile and try again.");
  });

  it("explains a proxy tunnel failure without Chromium error jargon", () => {
    expect(userFacingBrowserError("navigation failed: net::ERR_TUNNEL_CONNECTION_FAILED"))
      .toBe("The selected profile’s proxy could not connect. Check or change its proxy, then run the automation again.");
  });

  it("explains that a local proxy needs a locally configured runtime", () => {
    expect(userFacingBrowserError("[LOCAL_PROXY_UNSUPPORTED] This proxy runs on this computer."))
      .toBe("This proxy runs on your computer. Use Camoufox or DasBrowser for a localhost proxy; Clawbrowser support for local proxy ports is coming soon.");
  });

  it("reduces a managed-proxy capability refusal to one short action", () => {
    const raw = "Could not start Nextbrowser: VERIFY_FAILED: browser stopped: LAUNCH_FAILED: launch failed (Clawbrowser managed-proxy privacy capability is 1; 2 or newer is required) [VERIFY_FAILED] — Retry the same proxy. A proxy profile cannot continue without its proxy.";
    const message = userFacingBrowserError(new Error(raw));
    expect(message).toBe("This Clawbrowser build can’t run a proxied profile. Update Clawbrowser, then retry.");
    expect(message).not.toMatch(/VERIFY_FAILED|LAUNCH_FAILED|capability is 1/i);
  });

  it("hides a transient CDP transport error behind a recovery action", () => {
    const message = userFacingBrowserError("cdp Runtime.evaluate: read response: read tcp 127.0.0.1:1->127.0.0.1:2: wsarecv: An established connection was aborted by the software in your host machine");
    expect(message).toContain("Nextbrowser retried once");
    expect(message).not.toMatch(/127\.0\.0\.1|wsarecv/i);
  });

  it("shows a stopped verification before a nested CDP transport error", () => {
    const raw = "Could not start Nextbrowser: VERIFY_FAILED: browser stopped: cdp Runtime.evaluate: read response: read tcp 127.0.0.1:1: connection reset [VERIFY_FAILED] — Retry the same proxy. A proxy profile cannot continue without its proxy.";
    expect(userFacingBrowserError(raw)).toBe(BROWSER_UNVERIFIED);
  });

  it("does not blame the proxy of a profile that has none", () => {
    // nextctl's hint names the proxy on every failed check; a profile without
    // a proxy that fails another check must not read as a proxy failure.
    const raw = "VERIFY_FAILED: browser stopped: VERIFY_REQUIRED: failed browser checks: timezone, webrtc; the profile cannot be used [VERIFY_FAILED] — Resolve the verification failure and retry this profile. A proxy profile cannot continue without its proxy.";
    const message = userFacingBrowserError(raw);
    expect(message).toBe(`${BROWSER_UNVERIFIED} Failed checks: timezone, webrtc.`);
    expect(message).not.toMatch(/proxy/i);
    const camoufox = "VERIFY_FAILED: browser stopped: VERIFY_REQUIRED: Camoufox verification did not pass [VERIFY_FAILED] — Resolve the verification failure and retry this profile. A proxy profile cannot continue without its proxy.";
    expect(userFacingBrowserError(camoufox)).toBe(BROWSER_UNVERIFIED);
  });

  it("reports a failed proxy check as our problem, without the CLI chain", () => {
    const raw = "Could not start Nextbrowser: VERIFY_FAILED: browser stopped: VERIFY_REQUIRED: failed browser checks: proxy; the profile cannot be used [VERIFY_FAILED] — Resolve the verification failure and retry this profile. A proxy profile cannot continue without its proxy.";
    const message = userFacingBrowserError(raw);
    expect(message).toBe(`${BROWSER_PROXY_UNVERIFIED} Failed checks: proxy.`);
    expect(message).toContain("problem on our side");
    expect(message).not.toMatch(/VERIFY_|Resolve the verification/);
    expect(isBrowserVerificationFailure(raw)).toBe(true);
  });

  it("reports a start that timed out while installing Camoufox as a slow start, not a proxy failure", () => {
    const raw = "Could not start Nextbrowser: VERIFY_FAILED: browser stopped: VENDOR_UNAVAILABLE: External browser runtime operation did not complete before timeout (prepare Camoufox managed proxy: get proxy traffic: Get \"https://api.nextbrowser.com/v1/proxy/traffic\": context deadline exceeded) [VERIFY_FAILED] — Resolve the verification failure and retry this profile. A proxy profile cannot continue without its proxy.";
    expect(isBrowserStartFailure(raw)).toBe(true);
    expect(userFacingBrowserError(raw)).toBe(BROWSER_START_TIMED_OUT);
    expect(userFacingBrowserError(raw)).not.toMatch(/proxy|VERIFY_|api\.nextbrowser/i);
  });

  it("names a failed Camoufox install and a failed launch without blaming the proxy", () => {
    const install = "VERIFY_FAILED: browser stopped: LAUNCH_FAILED: launch failed (prepare Camoufox runtime: install Camoufox: exit status 1: pip error) — A proxy profile cannot continue without its proxy.";
    expect(userFacingBrowserError(install)).toBe(CAMOUFOX_INSTALL_FAILED);
    const launch = "VERIFY_FAILED: browser stopped: LAUNCH_FAILED: launch failed (Camoufox exited before becoming ready: RuntimeError) — A proxy profile cannot continue without its proxy.";
    expect(userFacingBrowserError(launch)).toBe(BROWSER_START_FAILED);
  });

  it("names python3-venv when Debian's Python cannot build Camoufox's environment", () => {
    // nbc 1.2.37 on Ubuntu 24.04 without python3-venv, reproduced 27.10.2026.
    const raw = "VERIFY_FAILED: browser stopped: LAUNCH_FAILED: launch failed (prepare Camoufox runtime: create Camoufox runtime: exit status 1: The virtual environment was not created successfully because ensurepip is not\navailable.  On Debian/Ubuntu systems, you need to install the python3-venv\npackage using the following command.\n\n    apt install python3.12-venv\n) [VERIFY_FAILED] — Resolve the verification failure and retry this profile. A proxy profile cannot continue without its proxy.";
    expect(userFacingBrowserError(raw)).toBe(CAMOUFOX_PYTHON_VENV_MISSING);
  });

  it("tells the user to install Python when Camoufox has none it can use", () => {
    const wrapped = "VERIFY_FAILED: browser stopped: CAMOUFOX_PYTHON_MISSING: Camoufox needs Python 3.11–3.13, and it could not be downloaded automatically (install Python 3.13 from https://www.python.org/downloads/ (not the Microsoft Store version), or check that this computer can reach github.com, then start the profile again (prepare Camoufox runtime: only a Microsoft Store Python 3.11–3.13 is installed; download uv: fetch failed))";
    expect(userFacingBrowserError(wrapped)).toBe(CAMOUFOX_PYTHON_MISSING);
    const unwrapped = "Camoufox needs Python 3.11–3.13, and it could not be downloaded automatically [CAMOUFOX_PYTHON_MISSING] — install Python 3.13 from https://www.python.org/downloads/ (prepare Camoufox runtime: Python 3.11–3.13 is not installed)";
    expect(userFacingBrowserError(unwrapped)).toBe(CAMOUFOX_PYTHON_MISSING);
    expect(CAMOUFOX_PYTHON_MISSING).toContain("not the Microsoft Store version");
  });

  it("says that the proxy account could not be set up when the migration fails before the start", () => {
    for (const raw of [MIGRATION_FAILED, MIGRATION_FAILED_IN_APP]) {
      expect(userFacingBrowserError(raw)).toBe(PROXY_ACCOUNT_SETUP_FAILED);
      expect(isProxyAccountSetupFailure(raw)).toBe(true);
      // The message gets a Ref and the Discord link, like other failures on our side.
      expect(isBrowserVerificationFailure(raw)).toBe(true);
      // It is not a blocked path to the proxy, so no VPN hint.
      expect(isProxyPathFailure(raw)).toBe(false);
      expect(isBrowserStartFailure(raw)).toBe(false);
    }
    expect(PROXY_ACCOUNT_SETUP_FAILED).not.toMatch(/safety check|through its proxy|VERIFY|migrat/i);
    for (const code of ["migration_status_failed", "migration_unavailable"]) {
      expect(userFacingBrowserError(MIGRATION_FAILED_IN_APP.replace("migration_failed", code))).toBe(PROXY_ACCOUNT_SETUP_FAILED);
    }
    // migration_deferred: the backend lets the next start go ahead.
    const deferred = userFacingBrowserError(MIGRATION_FAILED_IN_APP.replace(/migration_failed/g, "migration_deferred"));
    expect(deferred).toBe(PROXY_ACCOUNT_SETUP_DEFERRED);
    expect(deferred).toMatch(/Start the profile again\.$/);
    // Other failures of the same account are untouched.
    expect(isProxyAccountSetupFailure("VERIFY_FAILED: browser stopped: VERIFY_REQUIRED: failed browser checks: proxy; the profile cannot be used")).toBe(false);
  });

  it("keeps a failed proxy check and a dropped CDP connection as proxy failures", () => {
    expect(isBrowserStartFailure("VERIFY_FAILED: browser stopped: VERIFY_REQUIRED: failed browser checks: proxy; the profile cannot be used")).toBe(false);
    expect(isBrowserStartFailure("VERIFY_FAILED: browser stopped: cdp Runtime.evaluate: read response: connection reset")).toBe(false);
  });

  it("leaves the outdated-Clawbrowser refusal as an update action, not a support case", () => {
    const raw = "VERIFY_FAILED: browser stopped: LAUNCH_FAILED: launch failed (Clawbrowser managed-proxy privacy capability is 1; 2 or newer is required)";
    expect(isBrowserVerificationFailure(raw)).toBe(false);
  });

  it("preserves useful ordinary errors while removing local log paths", () => {
    expect(userFacingBrowserError("Could not open page; see log /Users/person/private/child.log"))
      .toBe("Could not open page");
  });

  it("turns an unavailable workspace into a clear recovery action", () => {
    expect(userFacingBrowserError("Error invoking remote method 'nextbrowser:invoke': Error: workspace not found"))
      .toBe("The selected workspace is no longer available. Select or create a workspace, then try again.");
  });

  it("turns a backend fetch failure into a user action without IPC or service internals", () => {
    const message = userFacingBrowserError("Error invoking remote method 'nextbrowser:invoke': Error: Cannot reach the Nextbrowser backend at https://core.nextbrowser.com. Check that the backend is running and try again.");
    expect(message).toBe("Nextbrowser couldn’t connect to the service. Check your internet connection and try again.");
    expect(message).not.toMatch(/nextbrowser:invoke|core\.nextbrowser\.com|backend is running/i);
  });

  it("removes the Electron IPC prefix from ordinary errors", () => {
    expect(userFacingBrowserError("Error invoking remote method 'nextbrowser:invoke': Error: The shared workflow is invalid"))
      .toBe("The shared workflow is invalid");
  });
});
