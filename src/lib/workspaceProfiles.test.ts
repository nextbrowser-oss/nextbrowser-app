import { describe, expect, it } from "vitest";
import type { Workspace } from "../types";
import { countWorkspaceProfiles, moveProfileToWorkspace, workspaceHasNoLocalProfiles } from "./workspaceProfiles";

const workspaces: Workspace[] = [
  { id: "one", name: "One", profileNames: ["browser"], profileToolsets: { browser: "dasbrowser" }, profileProxyIds: { browser: "proxy-id" }, createdAt: 1, updatedAt: 1 },
  { id: "two", name: "Two", profileNames: ["other"], profileToolsets: { other: "clawbrowser" }, createdAt: 2, updatedAt: 2 },
];

describe("moveProfileToWorkspace", () => {
  it("moves a profile and preserves its browser toolset", () => {
    const moved = moveProfileToWorkspace(workspaces, "browser", "two", 10);
    expect(moved[0]).toMatchObject({ profileNames: [], profileToolsets: {}, updatedAt: 10 });
    expect(moved[0].profileProxyIds).toEqual({});
    expect(moved[1]).toMatchObject({ profileNames: ["other", "browser"], profileToolsets: { other: "clawbrowser", browser: "dasbrowser" }, profileProxyIds: { browser: "proxy-id" }, updatedAt: 10 });
    expect(workspaces[0].profileNames).toEqual(["browser"]);
  });

  it("does not modify an already selected workspace", () => {
    expect(moveProfileToWorkspace(workspaces, "browser", "one", 10)).toBe(workspaces);
  });
});

describe("countWorkspaceProfiles", () => {
  const inventory = [{ name: "browser" }, { name: "other" }, { name: "default" }];

  it("counts only the active workspace's profiles, not every local profile", () => {
    expect(countWorkspaceProfiles(workspaces[0], inventory, false)).toBe(1);
    expect(countWorkspaceProfiles(workspaces[1], inventory, false)).toBe(1);
  });

  it("skips assignments whose profile is gone and counts the picked Multilogin profile", () => {
    const workspace = { profileNames: ["browser", "deleted", "__default"] };
    expect(countWorkspaceProfiles(workspace, inventory, false)).toBe(1);
    expect(countWorkspaceProfiles(workspace, inventory, true)).toBe(2);
    expect(countWorkspaceProfiles(undefined, inventory, false)).toBe(0);
  });
});

describe("workspaceHasNoLocalProfiles", () => {
  const signedIn = {
    authed: true,
    profilesLoaded: true,
    workspaceSetupAuto: "done",
    activeWorkspaceId: "one",
    workspaces,
    profiles: [{ name: "another-account" }],
  };

  it("flags a workspace whose profiles were all created on another computer", () => {
    expect(workspaceHasNoLocalProfiles(signedIn)).toBe(true);
  });

  it("flags an empty workspace", () => {
    expect(workspaceHasNoLocalProfiles({ ...signedIn, workspaces: [{ id: "one", profileNames: [] }] })).toBe(true);
  });

  it("stays quiet once one of the workspace's profiles is on this computer", () => {
    expect(workspaceHasNoLocalProfiles({ ...signedIn, profiles: [{ name: "browser" }] })).toBe(false);
  });

  it("waits for the account, this computer's profile list, and first-run setup", () => {
    expect(workspaceHasNoLocalProfiles({ ...signedIn, authed: false })).toBe(false);
    expect(workspaceHasNoLocalProfiles({ ...signedIn, profilesLoaded: false })).toBe(false);
    expect(workspaceHasNoLocalProfiles({ ...signedIn, workspaceSetupAuto: "running" })).toBe(false);
    expect(workspaceHasNoLocalProfiles({ ...signedIn, activeWorkspaceId: undefined })).toBe(false);
    expect(workspaceHasNoLocalProfiles({ ...signedIn, activeWorkspaceId: "missing" })).toBe(false);
  });
});
