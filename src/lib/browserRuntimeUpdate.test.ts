import { describe, expect, it } from "vitest";
import { confirmedBrowserRuntimeUpdates, pendingBrowserRuntimeUpdate } from "./browserRuntimeUpdate";

describe("pendingBrowserRuntimeUpdate", () => {
  it("shows immediate visible progress for the confirmed toolset", () => {
    expect(pendingBrowserRuntimeUpdate(["camoufox"], [
      { runtime: "camoufox", name: "Camoufox", latestVersion: "0.5.7" },
    ])).toMatchObject({
      status: "installing",
      runtimes: ["camoufox"],
      currentRuntime: "camoufox",
      currentName: "Camoufox",
      currentVersion: "0.5.7",
      progress: 0,
    });
  });

  it("uses the confirmed dialog runtimes when React supplies a click event", () => {
    expect(confirmedBrowserRuntimeUpdates({ type: "click" }, ["dasbrowser"])).toEqual(["dasbrowser"]);
    expect(confirmedBrowserRuntimeUpdates(["camoufox"], ["dasbrowser"])).toEqual(["camoufox"]);
  });
});
