import { describe, expect, it } from "vitest";
import {
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
  it("opens profile creation only when there are no profiles to start", () => {
    expect(guideSessionSetupEvent(0)).toBe("nextbrowser:open-profile-creator");
    expect(guideSessionSetupEvent(1)).toBe("nextbrowser:start-selected-profile");
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
