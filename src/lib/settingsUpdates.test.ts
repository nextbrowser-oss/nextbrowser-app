import { describe, expect, it } from "vitest";
import { addPendingRuntimeInstall, availableRuntimeUpdates, browserRuntimeUpdateLabel, canStartUpdates, downloadableBrowsers, latestRuntimeOperation, runtimeUpdateAction } from "./settingsUpdates";
import type { BrowserRuntimeUpdateEntry } from "../components/BrowserRuntimeUpdatePrompt";

const runtime: BrowserRuntimeUpdateEntry = { runtime: "camoufox", name: "Camoufox", status: "available", currentVersion: "0.5.8", latestVersion: "0.5.9", releasePage: "https://pypi.org/project/camoufox/" };

describe("settings update actions", () => {
  it("Download all selects only missing supported browsers that are not already installing", () => {
    const missing = [runtime, { ...runtime, runtime: "clawbrowser" as const }, { ...runtime, runtime: "dasbrowser" as const }].map((item) => ({ ...item, status: "not-installed" as const }));
    expect(downloadableBrowsers(missing, { status: "idle" }).map((item) => item.runtime)).toEqual(["camoufox", "clawbrowser"]);
    expect(downloadableBrowsers(missing, { status: "installing", items: [{ runtime: "camoufox", name: "Camoufox", status: "installing" }] }).map((item) => item.runtime)).toEqual(["clawbrowser"]);
    expect(downloadableBrowsers([runtime], { status: "idle" })).toEqual([]);
  });
  it("adding a browser preserves the other browser's progress and exposes failed jobs for retry", () => {
    const result = addPendingRuntimeInstall({ status: "installing", items: [{ runtime: "clawbrowser", name: "Clawbrowser", status: "installing", percent: 47 }] }, ["camoufox"], [runtime]);
    expect(result.items?.[0].percent).toBe(47);
    expect(result.items?.[1].phase).toBe("checking");
    expect(runtimeUpdateAction(runtime, result)).toBe("Installing…");
    expect(runtimeUpdateAction(runtime, { ...result, items: [{ runtime: "camoufox", name: "Camoufox", status: "failed" }] })).toBe("Retry");
    expect(runtimeUpdateAction(runtime, { status: "ready", items: [{ runtime: "camoufox", name: "Camoufox", status: "ready" }] })).toBe("Update");
  });
  it("ignores stale initial snapshots and out-of-order operation events", () => {
    const current = { status: "installing" as const, updatedAt: 20 };
    expect(latestRuntimeOperation(current, { status: "idle" })).toBe(current);
    expect(latestRuntimeOperation(current, { status: "ready", updatedAt: 10 })).toBe(current);
    expect(latestRuntimeOperation(current, { status: "ready", updatedAt: 30 }).status).toBe("ready");
  });
  it("updates installed outdated components without installing missing optional browsers", () => {
    expect(availableRuntimeUpdates([runtime, { ...runtime, runtime: "dasbrowser", status: "not-installed" }, { ...runtime, runtime: "clawbrowser", status: "unavailable" }])).toEqual(["camoufox"]);
  });
  it("shows the current operation even when update metadata has not refreshed", () => {
    expect(runtimeUpdateAction(runtime, { status: "installing", runtimes: ["camoufox"], currentRuntime: "camoufox" })).toBe("Updating…");
    expect(runtimeUpdateAction(runtime, { status: "installing", runtimes: ["camoufox"], currentRuntime: "dasbrowser" })).toBe("Queued");
    expect(runtimeUpdateAction(runtime, { status: "installing", runtimes: ["camoufox"], completed: ["camoufox"] })).toBe("Updated");
    expect(runtimeUpdateAction(runtime, { status: "cancelled" })).toBe("Update");
  });
  it("blocks competing installers and restart while another update is active", () => {
    expect(canStartUpdates({}, { status: "idle" }, false, false)).toBe(true);
    expect(canStartUpdates({}, { status: "installing" }, false, false)).toBe(false);
    expect(canStartUpdates({ status: "downloading" }, { status: "idle" }, false, false)).toBe(false);
    expect(canStartUpdates({}, { status: "idle" }, true, false)).toBe(false);
    expect(canStartUpdates({}, { status: "idle" }, false, true)).toBe(false);
  });
  it("preserves installed versions when release checks fail", () => {
    expect(browserRuntimeUpdateLabel({ ...runtime, status: "error" })).toContain("Installed 0.5.8");
    expect(browserRuntimeUpdateLabel({ ...runtime, status: "unknown" })).not.toContain("Not installed");
  });
});
