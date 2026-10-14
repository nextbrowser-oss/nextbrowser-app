import { describe, expect, it } from "vitest";
import {
  SCHEDULE_START_GRACE_MS,
  scheduledAgentCheck,
  scheduledInventoryCheck,
  settleScheduledWait,
} from "./scheduleStart";

describe("scheduled agent check", () => {
  it("lets a connected, signed-in agent take the prompt", () => {
    expect(scheduledAgentCheck({ ready: true, loggedIn: true }, "Codex")).toEqual({ status: "ready" });
    // An inconclusive login check is not a sign-out.
    expect(scheduledAgentCheck({ ready: true, loggedIn: null }, "Codex")).toEqual({ status: "ready" });
  });
  it("fails visibly for an offline or signed-out agent, whose prompt the queue would drop", () => {
    expect(scheduledAgentCheck(undefined, "Codex")).toEqual({ status: "failed", error: "Codex is not connected. Connect Codex in Nextbrowser." });
    expect(scheduledAgentCheck({ ready: false, error: "Codex app not found." }, "Codex")).toEqual({ status: "failed", error: "Codex app not found." });
    expect(scheduledAgentCheck({ ready: true, loggedIn: false }, "Codex")).toMatchObject({ status: "failed", error: expect.stringMatching(/signed out/) });
  });
  it("waits for a connection that is already in progress", () => {
    expect(scheduledAgentCheck({ ready: false, authorizing: true }, "Codex")).toMatchObject({ status: "wait" });
  });
});

describe("scheduled profile inventory check", () => {
  it("waits for a local run until the inventory has loaded", () => {
    expect(scheduledInventoryCheck("local", false)).toMatchObject({ status: "wait" });
    expect(scheduledInventoryCheck("local", true)).toEqual({ status: "ready" });
  });
  it("never waits for a VPS run, whose profiles are not in this computer's inventory", () => {
    expect(scheduledInventoryCheck("vps", false)).toEqual({ status: "ready" });
  });
});

describe("settling a scheduled wait", () => {
  const wait = { status: "wait" as const, reason: "Codex is still connecting." };
  it("keeps waiting within the grace period", () => {
    expect(settleScheduledWait(wait, 1_000, 1_000 + SCHEDULE_START_GRACE_MS - 1)).toBe(wait);
  });
  it("turns a wait that outlasted the grace period into a visible failure", () => {
    expect(settleScheduledWait(wait, 1_000, 1_000 + SCHEDULE_START_GRACE_MS)).toEqual({ status: "failed", error: "Codex is still connecting." });
  });
  it("passes ready and failed checks through unchanged", () => {
    expect(settleScheduledWait({ status: "ready" }, 0, Number.MAX_SAFE_INTEGER)).toEqual({ status: "ready" });
    expect(settleScheduledWait({ status: "failed", error: "x" }, 0, 0)).toEqual({ status: "failed", error: "x" });
  });
});
