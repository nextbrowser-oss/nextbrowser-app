import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunResult } from "./nextctl";
import { prepareSession } from "./preflight";

const nextctl = vi.hoisted(() => ({
  json: vi.fn(),
  run: vi.fn(),
}));

vi.mock("./nextctl", () => ({
  nextctlJson: nextctl.json,
  nextctlRun: nextctl.run,
  nextctlErrorMessage: (result: RunResult) =>
    result.stderr.trim() || result.stdout.trim() || "nextctl command failed",
}));

const success = { stdout: "", stderr: "", code: 0 };
const greenVerification = {
  verify: {
    finalized: true,
    status: "pass",
    checks: [{ surface: "Proxy", pass: true }],
  },
};

beforeEach(() => {
  nextctl.json.mockReset();
  nextctl.run.mockReset();
  nextctl.json.mockImplementation(async (args: string[]) =>
    args.includes("verify") ? greenVerification : { tabs: [] });
  nextctl.run.mockResolvedValue(success);
});

describe("prepareSession command reporting", () => {
  it("does not report a started session when start fails", async () => {
    const onStep = vi.fn();
    nextctl.run.mockResolvedValueOnce({
      stdout: "",
      stderr: "browser runtime unavailable",
      code: 1,
    });

    await expect(prepareSession({
      statuses: {},
      onStep,
    })).rejects.toThrow("Could not start NextBrowser: browser runtime unavailable");

    expect(onStep).not.toHaveBeenCalledWith("Started NextBrowser");
  });

  it("treats a JSON error envelope as failure even with a zero exit code", async () => {
    const onStep = vi.fn();
    nextctl.run.mockResolvedValueOnce({
      stdout: JSON.stringify({ ok: false, error: { message: "runtime rejected start" } }),
      stderr: "",
      code: 0,
    });

    await expect(prepareSession({
      statuses: {},
      onStep,
    })).rejects.toThrow("Could not start NextBrowser");

    expect(onStep).not.toHaveBeenCalledWith("Started NextBrowser");
  });

  it("does not report an opened or ready page when open fails", async () => {
    const onStep = vi.fn();
    nextctl.run.mockResolvedValueOnce({
      stdout: "",
      stderr: "navigation failed",
      code: 1,
    });

    await expect(prepareSession({
      host: "example.com",
      statuses: {},
      defaultSession: { status: "running" },
      onStep,
    })).rejects.toThrow("Could not open example.com: navigation failed");

    expect(onStep).toHaveBeenCalledWith("Session running");
    expect(onStep).not.toHaveBeenCalledWith("Opened example.com");
    expect(onStep).not.toHaveBeenCalledWith("Page ready");
  });

  it("reports an opened page but not a ready page when wait fails", async () => {
    const onStep = vi.fn();
    nextctl.run
      .mockResolvedValueOnce(success)
      .mockResolvedValueOnce({ stdout: "", stderr: "load timed out", code: 1 });

    await expect(prepareSession({
      host: "example.com",
      statuses: {},
      defaultSession: { status: "running" },
      onStep,
    })).rejects.toThrow("Could not finish loading example.com: load timed out");

    expect(onStep).toHaveBeenCalledWith("Opened example.com");
    expect(onStep).not.toHaveBeenCalledWith("Page ready");
  });

  it("does not report a blank page when nextctl returns no tab", async () => {
    const onStep = vi.fn();
    nextctl.json
      .mockResolvedValueOnce(greenVerification)
      .mockResolvedValueOnce({ tabs: [] })
      .mockResolvedValueOnce({});

    await expect(prepareSession({
      statuses: {},
      defaultSession: { status: "running" },
      onStep,
    })).rejects.toThrow("Could not open a blank page: nextctl returned no tab");

    expect(onStep).not.toHaveBeenCalledWith("Opened a blank page");
  });

  it("stops before navigation when browser verification is not green", async () => {
    const onStep = vi.fn();
    nextctl.json.mockResolvedValueOnce({
      verify: {
        finalized: true,
        status: "fail",
        checks: [{ surface: "Proxy", pass: false }],
      },
    });

    await expect(prepareSession({
      host: "example.com",
      statuses: {},
      defaultSession: { status: "running" },
      onStep,
    })).rejects.toThrow("Browser verification is not green: Proxy");

    expect(onStep).toHaveBeenCalledWith("Session running");
    expect(onStep).not.toHaveBeenCalledWith("Browser verified");
    expect(nextctl.run).not.toHaveBeenCalled();
  });

  it("retries verification when the user chooses retry", async () => {
    const onStep = vi.fn();
    const onVerificationFailure = vi.fn().mockResolvedValue("retry");
    nextctl.json
      .mockResolvedValueOnce({
        verify: { finalized: true, status: "fail", checks: [{ surface: "Proxy", pass: false }] },
      })
      .mockResolvedValueOnce(greenVerification)
      .mockResolvedValueOnce({ tabs: [{ id: "page", url: "about:blank" }] });

    const result = await prepareSession({
      statuses: {},
      defaultSession: { status: "running" },
      onStep,
      onVerificationFailure,
    });

    expect(onVerificationFailure).toHaveBeenCalledTimes(1);
    expect(onStep).toHaveBeenCalledWith("Browser verified");
    expect(result.directFallback).toBe(false);
  });

  it("switches the current task to the direct session when the user bypasses the proxy", async () => {
    const onStep = vi.fn();
    nextctl.json
      .mockResolvedValueOnce({
        verify: { finalized: true, status: "fail", checks: [{ surface: "Proxy", pass: false }] },
      })
      .mockResolvedValueOnce({ tabs: [{ id: "direct", url: "about:blank" }] });

    const result = await prepareSession({
      selectedProfile: "proxy-profile",
      statuses: { "proxy-profile": "running" },
      defaultSession: { status: "running" },
      onStep,
      onVerificationFailure: async () => "direct",
    });

    expect(result.profileArgs).toEqual([]);
    expect(result.directFallback).toBe(true);
    expect(onStep).toHaveBeenCalledWith("Continuing without proxy");
    expect(nextctl.run).not.toHaveBeenCalled();
  });
});
