import { describe, expect, it } from "vitest";
import type { Workspace } from "../types";
import { moveProfileToWorkspace } from "./workspaceProfiles";

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
