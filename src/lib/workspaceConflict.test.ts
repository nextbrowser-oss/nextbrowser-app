import { describe, expect, it } from "vitest";
import { isWorkspaceRevisionConflict, mergeWorkspaceAfterRevisionConflict } from "./workspaceConflict";
import type { Workspace } from "../types";

const local: Workspace = {
  id: "workspace", name: "Local", createdAt: 1, updatedAt: 2,
  profileNames: ["local", "shared"],
  profileToolsets: { local: "clawbrowser", shared: "camoufox" },
  profileProxyIds: { local: "proxy-local", shared: "proxy-new" },
};

describe("workspace conflict recovery", () => {
  it("recognizes only the retryable optimistic-concurrency failure", () => {
    expect(isWorkspaceRevisionConflict(new Error("workspace revision conflict"))).toBe(true);
    expect(isWorkspaceRevisionConflict(new Error("workspace not found"))).toBe(false);
  });

  it("preserves remote profiles while retaining the local edit for collisions", () => {
    const merged = mergeWorkspaceAfterRevisionConflict(local, {
      ...local,
      name: "Remote",
      profileNames: ["remote", "shared"],
      profileToolsets: { remote: "dasbrowser", shared: "clawbrowser" },
      profileProxyIds: { remote: "proxy-remote", shared: "proxy-old" },
    });

    expect(merged.profileNames).toEqual(["remote", "shared", "local"]);
    expect(merged.profileToolsets).toEqual({ remote: "dasbrowser", shared: "camoufox", local: "clawbrowser" });
    expect(merged.profileProxyIds).toEqual({ remote: "proxy-remote", shared: "proxy-new", local: "proxy-local" });
    expect(merged.name).toBe("Local");
  });
});
