import { describe, expect, it } from "vitest";
import { browserProfileContext } from "./browserProfileContext";
import type { Workspace } from "../types";

describe("browserProfileContext", () => {
  it("marks the saved runtime as authoritative", () => {
    const workspace = {
      id: "one",
      name: "Work",
      createdAt: 1,
      updatedAt: 1,
      profileNames: ["HEY!", "baka"],
      profileToolsets: { "HEY!": "dasbrowser", baka: "clawbrowser" },
    } as Workspace;
    const result = browserProfileContext([workspace], "one", "HEY!");
    expect(result).toContain("HEY!: DasBrowser (selected)");
    expect(result).toContain("baka: ClawBrowser");
    expect(result).toContain("do not call clawbrowser.start");
  });

  it("does not leak profiles from another workspace", () => {
    const workspaces = [
      { id: "one", name: "One", createdAt: 1, updatedAt: 1, profileNames: ["visible"], profileToolsets: {} },
      { id: "two", name: "Two", createdAt: 1, updatedAt: 1, profileNames: ["hidden"], profileToolsets: {} },
    ] as Workspace[];
    expect(browserProfileContext(workspaces, "one")).not.toContain("hidden");
  });
});
