import { describe, expect, it } from "vitest";
import {
  guideBrowserSession,
  guideProfileTarget,
  guideSessionState,
  guideSessionSetupEvent,
  guideWorkspaceProfileNames,
} from "./guideQuickStart";

describe("Guide session quick start", () => {
  it("keeps a running session authoritative while status polling catches up", () => {
    expect(guideSessionState("stopped", "running")).toBe("running");
    expect(guideSessionState("unknown", "starting")).toBe("starting");
    expect(guideSessionState("stopped", "unknown")).toBe("stopped");
  });
  it("opens profile creation only when there is nothing to start", () => {
    expect(guideSessionSetupEvent(null)).toBe("nextbrowser:open-profile-creator");
    expect(guideSessionSetupEvent("saved")).toBe("nextbrowser:start-selected-profile");
    expect(guideSessionSetupEvent("__default")).toBe("nextbrowser:start-selected-profile");
  });

  describe("browser session readiness", () => {
    const stopped = { state: "stopped" as const };

    it("counts any workspace profile, not just the selected one", () => {
      expect(guideBrowserSession(
        ["a", "b"],
        undefined,
        { a: "stopped", b: "running" },
        {},
      )).toEqual({ state: "running", profile: "b" });
    });

    it("keeps reporting the selected profile when it is the one running", () => {
      expect(guideBrowserSession(
        ["a", "b"],
        "b",
        { a: "running", b: "running" },
        {},
      )).toEqual({ state: "running", profile: "b" });
    });

    it("prefers a running profile over one that is still starting", () => {
      expect(guideBrowserSession(
        ["a", "b"],
        "a",
        { a: "starting", b: "running" },
        {},
      )).toEqual({ state: "running", profile: "b" });
    });

    it("counts the unnamed default session as a started browser", () => {
      expect(guideBrowserSession([], undefined, {}, {}, "running"))
        .toEqual({ state: "running", profile: "__default" });
    });

    it("trusts the session record while status polling catches up", () => {
      expect(guideBrowserSession(["a"], undefined, { a: "stopped" }, { a: { status: "running" } }))
        .toEqual({ state: "running", profile: "a" });
    });

    it("ignores a running profile from another workspace", () => {
      expect(guideBrowserSession(["a"], undefined, { a: "stopped", other: "running" }, {}))
        .toMatchObject(stopped);
    });

    it("names the profile the next start would target", () => {
      expect(guideBrowserSession(["a", "b"], undefined, {}, {}))
        .toEqual({ state: "stopped", profile: "a" });
      expect(guideBrowserSession(["a", "b"], "b", {}, {}))
        .toEqual({ state: "stopped", profile: "b" });
      expect(guideBrowserSession([], undefined, {}, {}, "stopped", true))
        .toEqual({ state: "stopped", profile: "__default" });
      expect(guideBrowserSession([], undefined, {}, {}))
        .toEqual({ state: "stopped", profile: null });
    });
  });

  it("starts the selected profile before falling back to the first saved profile", () => {
    expect(guideProfileTarget("selected", ["selected", "first"], true)).toBe("selected");
    expect(guideProfileTarget(undefined, ["first", "second"], true)).toBe("first");
    expect(guideProfileTarget(undefined, [], true)).toBe("__default");
    expect(guideProfileTarget(undefined, [], false)).toBeNull();
  });

  it("never targets a selected profile from another workspace", () => {
    expect(guideProfileTarget("hidden", ["visible"], false)).toBe("visible");
  });

  it("limits Guide status and actions to profiles in the active workspace", () => {
    expect(guideWorkspaceProfileNames(
      "current",
      [
        { id: "current", profileNames: ["visible", "missing"] },
        { id: "other", profileNames: ["hidden"] },
      ],
      [{ name: "visible" }, { name: "hidden" }],
    )).toEqual(["visible"]);
  });
});
