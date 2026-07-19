import { describe, expect, it } from "vitest";
import { isAppBackShortcut, isPrimaryAppTab } from "./appNavigation";

describe("app navigation", () => {
  it("treats chat and live as primary screens", () => {
    expect(isPrimaryAppTab("chat")).toBe(true);
    expect(isPrimaryAppTab("live")).toBe(true);
    expect(isPrimaryAppTab("usage")).toBe(false);
    expect(isPrimaryAppTab("guide")).toBe(false);
  });

  it("recognizes escape and platform back shortcuts", () => {
    expect(isAppBackShortcut({ key: "Escape", altKey: false, metaKey: false })).toBe(true);
    expect(isAppBackShortcut({ key: "ArrowLeft", altKey: true, metaKey: false })).toBe(true);
    expect(isAppBackShortcut({ key: "[", altKey: false, metaKey: true })).toBe(true);
    expect(isAppBackShortcut({ key: "ArrowLeft", altKey: false, metaKey: false })).toBe(false);
  });
});
