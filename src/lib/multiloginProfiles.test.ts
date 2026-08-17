import { describe, expect, it } from "vitest";
import { multiloginProfileSelected, previewMultiloginConnectionStatus } from "./multiloginProfiles";

describe("multilogin profiles", () => {
  it("matches profiles by kind, id, and folder", () => {
    const selection = { kind: "browser" as const, id: "one", name: "Work", folderId: "folder-a" };

    expect(multiloginProfileSelected(selection, "browser", { id: "one", name: "Work", folderId: "folder-a" })).toBe(true);
    expect(multiloginProfileSelected(selection, "browser", { id: "one", name: "Work", folderId: "folder-b" })).toBe(false);
    expect(multiloginProfileSelected(selection, "mobile", { id: "one", name: "Work", folderId: "folder-a" })).toBe(false);
  });

  it("provides browser and mobile profiles for the connected preview", () => {
    const status = previewMultiloginConnectionStatus("?connector=connected");

    expect(status.valid).toBe(true);
    expect(status.browserProfiles?.map((profile) => profile.name)).toContain("7_GitHub_acc");
    expect(status.cloudPhones?.map((profile) => profile.name)).toContain("Android US");
  });
});
