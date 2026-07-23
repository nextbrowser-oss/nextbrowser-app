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

beforeEach(() => {
  nextctl.json.mockReset();
  nextctl.run.mockReset();
  nextctl.json.mockResolvedValue({ tabs: [] });
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
      .mockResolvedValueOnce({ tabs: [] })
      .mockResolvedValueOnce({});

    await expect(prepareSession({
      statuses: {},
      defaultSession: { status: "running" },
      onStep,
    })).rejects.toThrow("Could not open a blank page: nextctl returned no tab");

    expect(onStep).not.toHaveBeenCalledWith("Opened a blank page");
  });
});
