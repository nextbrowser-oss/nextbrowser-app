import { describe, expect, it } from "vitest";
import {
  internalError,
  internalErrorMessage,
  needsSupportLink,
} from "./userFacingError";

describe("user-facing internal errors", () => {
  it("never exposes technical error details", () => {
    expect(internalError()).toBe(
      "Something went wrong on our side. The NextBrowser team is working on it.",
    );
    expect(internalError("We couldn't start Live View.")).toBe(
      "We couldn't start Live View. Something went wrong on our side. The NextBrowser team is working on it.",
    );
  });

  it("adds support only to internal errors", () => {
    expect(needsSupportLink(internalErrorMessage)).toBe(true);
    expect(needsSupportLink("Enter a valid proxy URL.")).toBe(false);
  });
});
