import { describe, expect, it } from "vitest";
import { pendingBrowserRuntimeUpdate } from "./browserRuntimeUpdate";

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
});
