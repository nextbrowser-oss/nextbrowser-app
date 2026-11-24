// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { addForeground, localDay, observeAccountActivity, readActivity, recentActivity } from "./accountActivity";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear(); });

describe("local account activity", () => {
  it("splits at midnight and excludes sleep gaps", () => {
    const midnight = new Date(2026,10,25).getTime();
    const log = readActivity("midnight");
    addForeground(log,midnight - 5000,midnight + 12000);
    addForeground(log,midnight + 12000,midnight + 3600000);
    expect(log.days[localDay(midnight - 1)].ms).toBe(5000);
    expect(log.days[localDay(midnight)].ms).toBe(12000);
  });

  it("counts foreground time and return visits per account, including after restarting", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026,10,24,10,0));
    vi.spyOn(document,"hasFocus").mockReturnValue(true);
    vi.spyOn(document,"visibilityState","get").mockReturnValue("visible");
    const stop = observeAccountActivity("first");
    vi.advanceTimersByTime(19000);
    stop();
    vi.advanceTimersByTime(31 * 60000);
    observeAccountActivity("first")();
    expect(recentActivity("first")).toEqual([{label:"2026-11-24",ms:19000,sessions:2}]);
    expect(readActivity("second").days).toEqual({});
  });
});
