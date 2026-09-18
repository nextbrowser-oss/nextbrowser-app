import { describe, expect, it } from "vitest";
import {
  actionFailureMessage,
  errorReference,
  internalError,
  needsSupportLink,
} from "./userFacingError";

describe("user-facing internal errors", () => {
  it("never exposes technical error details", () => {
    expect(internalError("We couldn't start Live View.", "LIVE_VIEW_CONNECT_FAILED")).toBe(
      `We couldn't start Live View. Ref: ${errorReference("LIVE_VIEW_CONNECT_FAILED")}`,
    );
  });

  it("does not render untrusted error codes", () => {
    expect(internalError("Failed.", "bad code")).toBe(`Failed. Ref: ${errorReference("INTERNAL_ERROR")}`);
  });

  it("adds support only to internal errors", () => {
    expect(needsSupportLink(internalError("Failed.", "ACTION_FAILED"))).toBe(true);
    expect(needsSupportLink("Enter a valid proxy URL.")).toBe(false);
  });

  it("explains the sanitized reason beside the support reference", () => {
    const message = actionFailureMessage("We couldn't prepare this profile.", "PROFILE_ASSIGNMENT_FAILED", "workspace revision conflict");
    expect(message).toBe(
      "We couldn't prepare this profile. The selected workspace is no longer available. Select or create a workspace, then try again. "
      + `Ref: ${errorReference("PROFILE_ASSIGNMENT_FAILED")}`,
    );
    // The reference the user reported must keep decoding to this action.
    expect(errorReference("PROFILE_ASSIGNMENT_FAILED")).toBe("NB-25647DEA");
  });

  it("keeps private filesystem locations out of the visible reason", () => {
    const message = actionFailureMessage(
      "We couldn't prepare this profile.",
      "PROFILE_ASSIGNMENT_FAILED",
      "Error invoking remote method 'x': Error: open /Users/someone/secret/workspaces.json failed",
    );
    expect(message).not.toContain("/Users/");
    expect(message).toContain("Ref: NB-25647DEA");
  });

  it("falls back to the bare reference when no reason is available", () => {
    expect(actionFailureMessage("Failed.", "ACTION_FAILED")).toBe(`Failed. Ref: ${errorReference("ACTION_FAILED")}`);
    expect(actionFailureMessage("Failed.", "ACTION_FAILED", "   ")).toBe(`Failed. Ref: ${errorReference("ACTION_FAILED")}`);
  });
});
