import { describe, expect, it } from "vitest";
import { vpnSystemProxyHint } from "./systemProxyHint";
import { isProxyPathFailure, VPN_SYSTEM_PROXY_HINT } from "./userFacingBrowserError";
import { actionFailureMessage } from "./userFacingError";

describe("the VPN system-proxy hint for a failed profile start", () => {
  it("recognizes failures of the path to the profile's proxy", () => {
    for (const detail of [
      "[LAUNCH_FAILED] page load failed: net::ERR_TUNNEL_CONNECTION_FAILED",
      "net::ERR_PROXY_CONNECTION_FAILED",
      "[VERIFY_FAILED] failed browser checks: proxy; proxy profile cannot continue without its proxy",
      "Command timed out after 240 seconds.",
      "VERIFY_FAILED: browser stopped: VENDOR_UNAVAILABLE: External browser runtime operation did not complete before timeout (context deadline exceeded)",
      "proxy connection refused",
    ]) {
      expect(isProxyPathFailure(detail), detail).toBe(true);
    }
    for (const detail of [
      "[PROFILE_NOT_FOUND] profile not found",
      "[API_KEY_INVALID] invalid key",
      "Proxy country is DE, expected US",
      // The backend could not set up the proxy account: not this computer's path to the proxy.
      "VERIFY_FAILED: migrate NodeMaven account before profile startup: migrate proxy traffic: Post \"https://api.nextbrowser.com/v1/proxy/traffic/migrate\": context deadline exceeded [VERIFY_FAILED] — A proxy profile cannot continue without its proxy.",
      "",
    ]) {
      expect(isProxyPathFailure(detail), detail).toBe(false);
    }
  });

  it("is given only when the main process sees a system proxy on this computer", async () => {
    const tunnel = "net::ERR_TUNNEL_CONNECTION_FAILED";
    expect(await vpnSystemProxyHint(tunnel, async () => ({ loopback: true }))).toBe(VPN_SYSTEM_PROXY_HINT);
    expect(await vpnSystemProxyHint(tunnel, async () => ({ loopback: false }))).toBe("");
    expect(await vpnSystemProxyHint(tunnel, async () => { throw new Error("no bridge"); })).toBe("");
    let asked = false;
    expect(await vpnSystemProxyHint("[PROFILE_NOT_FOUND] gone", async () => { asked = true; return { loopback: true }; })).toBe("");
    expect(asked).toBe(false);
  });

  it("goes after the reason and before the Ref", () => {
    const message = actionFailureMessage("We couldn't start “Work”.", "PROFILE_START_FAILED", "net::ERR_TUNNEL_CONNECTION_FAILED", VPN_SYSTEM_PROXY_HINT);
    expect(message).toMatch(new RegExp(`^We couldn't start “Work”\\. .+ ${VPN_SYSTEM_PROXY_HINT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} Ref: NB-[0-9A-F]{8}-[0-9A-F]{4}$`));
    expect(actionFailureMessage("We couldn't start “Work”.", "PROFILE_START_FAILED", "boom")).not.toContain("VPN");
  });
});
