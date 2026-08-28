import { describe, expect, it } from "vitest";
import { userFacingBrowserError } from "./userFacingBrowserError";

describe("userFacingBrowserError", () => {
  it("turns a Remote Control 404 into an actionable message without internals", () => {
    const raw = "detached Remote Control child failed: create Remote Session: unexpected status 404 Not Found: {\"message\":\"Not Found\"}; see log /Users/person/.nextbrowser/runtime/child.log [REMOTE_BACKEND_ERROR]";
    const message = userFacingBrowserError(new Error(raw));

    expect(message).toBe("Remote Control is not available on the connected NextBrowser service. Update NextBrowser and try again. If it continues, contact support.");
    expect(message).not.toMatch(/child|\/Users|REMOTE_BACKEND_ERROR|404/);
  });

  it("explains authentication and connectivity failures", () => {
    expect(userFacingBrowserError("create Remote Session: 401 Unauthorized [REMOTE_BACKEND_ERROR]"))
      .toContain("Sign in to NextBrowser again");
    expect(userFacingBrowserError("detached Remote Control child failed: network timeout [REMOTE_BACKEND_ERROR]"))
      .toContain("Check your internet connection");
  });

  it("explains an unreachable browser profile", () => {
    expect(userFacingBrowserError("CDP endpoint is not reachable [CDP_UNREACHABLE]"))
      .toBe("The browser profile stopped responding. Restart the profile and try again.");
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
    const message = userFacingBrowserError("Error invoking remote method 'nextbrowser:invoke': Error: Cannot reach the NextBrowser backend at https://core.nextbrowser.com. Check that the backend is running and try again.");
    expect(message).toBe("NextBrowser couldn’t connect to the service. Check your internet connection and try again.");
    expect(message).not.toMatch(/nextbrowser:invoke|core\.nextbrowser\.com|backend is running/i);
  });

  it("removes the Electron IPC prefix from ordinary errors", () => {
    expect(userFacingBrowserError("Error invoking remote method 'nextbrowser:invoke': Error: The shared workflow is invalid"))
      .toBe("The shared workflow is invalid");
  });
});
