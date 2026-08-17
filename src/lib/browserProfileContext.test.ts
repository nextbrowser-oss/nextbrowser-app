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
    expect(result).toContain("HEY!: DasBrowser (workspace: Work, selected)");
    expect(result).toContain("baka: ClawBrowser (workspace: Work");
    expect(result).toContain("do not spawn it through nextctl or clawbrowser.start");
    expect(result).toContain("NEXTBROWSER_CONTROL_URL");
    expect(result).toContain("rejects profiles outside");
  });

  it("keeps profiles from other workspaces outside the chat scope", () => {
    const workspaces = [
      { id: "one", name: "One", createdAt: 1, updatedAt: 1, profileNames: ["visible"], profileToolsets: {} },
      { id: "two", name: "Two", createdAt: 1, updatedAt: 1, profileNames: ["hidden"], profileToolsets: {} },
    ] as Workspace[];
    const result = browserProfileContext(workspaces, "one");
    expect(result).toContain("visible: ClawBrowser (workspace: One)");
    expect(result).not.toContain("hidden");
  });

  it("adds the selected Multilogin browser profile to agent context", () => {
    const result = browserProfileContext([], "one", undefined, {
      kind: "browser",
      id: "browser-1",
      name: "Amazon US",
      folderId: "folder-1",
    });
    expect(result).toContain("Selected Multilogin Mimic browser profile");
    expect(result).toContain("profile_id: browser-1");
    expect(result).toContain("folder_id: folder-1");
    expect(result).toContain("runtime multilogin");
  });

  it("keeps cloud phones on the mobile tool path", () => {
    const result = browserProfileContext([], "one", undefined, {
      kind: "mobile",
      id: "17",
      name: "Android US",
    });
    expect(result).toContain("Android cloud phone");
    expect(result).toContain("mcp__clawbrowser__mobile_start exactly once");
    expect(result).toContain("Use id, never profile_id or name");
    expect(result).toContain("do not search for tools or read additional references");
    expect(result).toContain("Do not retry an authentication error");
    expect(result).toContain("Do not treat it as a CDP browser profile");
  });
});
