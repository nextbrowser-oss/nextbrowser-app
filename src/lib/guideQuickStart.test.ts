import { describe, expect, it } from "vitest";
import {
  guideProfileTarget,
  guideSessionSetupEvent,
} from "./guideQuickStart";

describe("Guide session quick start", () => {
  it("opens profile creation only when there are no profiles to start", () => {
    expect(guideSessionSetupEvent(0)).toBe("nextbrowser:open-profile-creator");
    expect(guideSessionSetupEvent(1)).toBe("nextbrowser:start-selected-profile");
  });

  it("starts the selected profile before falling back to the first saved profile", () => {
    expect(guideProfileTarget("selected", ["first"], true)).toBe("selected");
    expect(guideProfileTarget(undefined, ["first", "second"], true)).toBe("first");
    expect(guideProfileTarget(undefined, [], true)).toBe("__default");
    expect(guideProfileTarget(undefined, [], false)).toBeNull();
  });
});
