import { describe, expect, it } from "vitest";
import { shouldDismissModalWithEscape } from "./modalKeyboard";

describe("modal keyboard behavior", () => {
  it("dismisses profile and creator dialogs only on Escape", () => {
    expect(shouldDismissModalWithEscape({ key: "Escape" })).toBe(true);
    expect(shouldDismissModalWithEscape({ key: "Enter" })).toBe(false);
  });
});
