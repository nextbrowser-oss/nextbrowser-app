import { describe, expect, it } from "vitest";
import { multiloginSessionName, nextctlRemoteArgs } from "./liveStreamTarget";

describe("Live stream targets", () => {
  it("keeps the existing Clawbrowser remote command", () => {
    expect(nextctlRemoteArgs({ runtime: "clawbrowser", profile: "work" })).toEqual([
      "remote", "--profile", "work", "--include-viewer-url", "--format", "json",
    ]);
  });

  it("starts a Multilogin browser profile with Remote Control enabled", () => {
    expect(nextctlRemoteArgs({
      runtime: "multilogin",
      selection: { kind: "browser", id: "profile/id", name: "Work", folderId: "folder-1" },
    })).toEqual([
      "--runtime", "multilogin",
      "--multilogin-folder-id", "folder-1",
      "--profile", "mlx-browser-profile-id",
      "--multilogin-profile-id", "profile/id",
      "start", "--remote", "--format", "json",
    ]);
  });

  it("uses the dedicated mobile remote command", () => {
    expect(nextctlRemoteArgs({
      runtime: "multilogin",
      selection: { kind: "mobile", id: "123", name: "Phone" },
    })).toEqual([
      "--runtime", "multilogin", "mobile", "remote", "123",
      "--include-viewer-url", "--format", "json",
    ]);
  });

  it("creates a stable bounded local session name", () => {
    const name = multiloginSessionName({ kind: "browser", id: " a/b ", name: "Ignored" });
    expect(name).toBe("mlx-browser-a-b");
    expect(name.length).toBeLessThanOrEqual(120);
  });
});
