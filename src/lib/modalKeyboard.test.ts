import { describe, expect, it } from "vitest";
import { shouldDismissModalWithEscape, wrappedFocusTarget } from "./modalKeyboard";

describe("modal keyboard", () => {
  it("dismisses with Escape only", () => {
    expect(shouldDismissModalWithEscape({ key: "Escape" })).toBe(true);
    expect(shouldDismissModalWithEscape({ key: "Enter" })).toBe(false);
  });

  const controls = ["close", "tab", "toggle", "link"];

  it("wraps Tab from the last control to the first", () => {
    expect(wrappedFocusTarget(controls, "link", true, false)).toBe("close");
  });

  it("wraps Shift+Tab from the first control to the last", () => {
    expect(wrappedFocusTarget(controls, "close", true, true)).toBe("link");
  });

  it("lets the browser move focus between controls inside the dialog", () => {
    expect(wrappedFocusTarget(controls, "tab", true, false)).toBeUndefined();
    expect(wrappedFocusTarget(controls, "toggle", true, true)).toBeUndefined();
  });

  it("brings focus lost to the page back into the dialog", () => {
    expect(wrappedFocusTarget(controls, null, false, false)).toBe("close");
    expect(wrappedFocusTarget(controls, null, false, true)).toBe("link");
  });

  it("has nothing to wrap to in a dialog without controls", () => {
    expect(wrappedFocusTarget([], null, false, false)).toBeUndefined();
  });
});
