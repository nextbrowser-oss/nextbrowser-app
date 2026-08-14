import { describe, expect, it } from "vitest";
import {
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
});
