import { describe, expect, it } from "vitest";
import { multiloginLifecycleArgs, multiloginSessionStatus } from "./multiloginSession";

describe("Multilogin row lifecycle", () => {
  const browser = { kind: "browser" as const, id: "abc", name: "Shop", folderId: "folder-1" };

  it("starts, stops, and inspects the same browser session", () => {
    const base = ["--runtime", "multilogin", "--profile", "mlx-browser-abc", "--multilogin-profile-id", "abc"];
    expect(multiloginLifecycleArgs(browser, "start")).toEqual([...base, "start", "--multilogin-folder-id", "folder-1"]);
    expect(multiloginLifecycleArgs(browser, "stop")).toEqual([...base, "stop", "--multilogin-folder-id", "folder-1"]);
    expect(multiloginLifecycleArgs(browser, "status")).toEqual([...base, "status", "--multilogin-folder-id", "folder-1"]);
  });

  it("uses the cloud phone commands for phones", () => {
    const phone = { kind: "mobile" as const, id: "phone-1", name: "Pixel" };
    expect(multiloginLifecycleArgs(phone, "start")).toEqual(["--runtime", "multilogin", "mobile", "start", "phone-1", "--no-wait"]);
    expect(multiloginLifecycleArgs(phone, "stop")).toEqual(["--runtime", "multilogin", "mobile", "stop", "phone-1"]);
  });

  it("maps browser and phone statuses to row states", () => {
    expect(multiloginSessionStatus({ status: "running" })).toBe("running");
    expect(multiloginSessionStatus({ status: "starting" })).toBe("starting");
    expect(multiloginSessionStatus({ status: "stopped" })).toBe("stopped");
    expect(multiloginSessionStatus({ mobile: { status_name: "started" } })).toBe("running");
    expect(multiloginSessionStatus({ mobile: { status_name: "expired" } })).toBe("stopped");
    expect(multiloginSessionStatus(undefined)).toBe("unknown");
  });
});
