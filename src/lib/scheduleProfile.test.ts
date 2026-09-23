import { describe, expect, it } from "vitest";
import { resolveScheduledProfile } from "./scheduleProfile";
import type { ScheduledRun } from "../types";

const run = { id: "r", title: "Check", prompt: "Check", agent: "codex", enabled: true, hour: 12, minute: 0, weekdays: [1] } as ScheduledRun;

describe("scheduled browser profile", () => {
  it("keeps the saved profile even when another profile is selected elsewhere", () => {
    expect(resolveScheduledProfile({ ...run, profileName: "GE" }, ["US", "GE"])).toBe("GE");
  });
  it("does not silently substitute another profile when the saved one was deleted", () => {
    expect(() => resolveScheduledProfile({ ...run, profileName: "GE" }, ["US"])).toThrow(/no longer in this workspace/);
  });
  it("blocks old unbound schedules in multi-profile workspaces", () => {
    expect(() => resolveScheduledProfile(run, ["US", "GE"])).toThrow(/Choose a browser profile/);
    expect(resolveScheduledProfile(run, ["GE"])).toBe("GE");
  });
});
