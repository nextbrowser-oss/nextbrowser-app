import { describe, expect, it } from "vitest";
import {
  appTabLabel,
  isAppBackShortcut,
  isPrimaryAppTab,
  popPreviousAppTab,
  previousAppTab,
  recordPreviousAppTab,
} from "./appNavigation";

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

  it("returns through visited tabs instead of always falling back to Chat", () => {
    let history = recordPreviousAppTab([], "chat");
    history = recordPreviousAppTab(history, "skills");

    expect(previousAppTab(history)).toBe("skills");

    const fromGuide = popPreviousAppTab(history);
    expect(fromGuide.target).toBe("skills");
    expect(previousAppTab(fromGuide.history)).toBe("chat");

    const fromSkills = popPreviousAppTab(fromGuide.history);
    expect(fromSkills.target).toBe("chat");
    expect(previousAppTab(fromSkills.history)).toBeUndefined();
  });

  it("provides labels for every back destination", () => {
    expect(appTabLabel("chat")).toBe("Chat");
    expect(appTabLabel("skills")).toBe("Skills");
    expect(appTabLabel("live")).toBe("Live");
    expect(appTabLabel("usage")).toBe("Usage");
    expect(appTabLabel("guide")).toBe("Guide");
    expect(appTabLabel("scheduled")).toBe("Scheduled");
  });
});
