import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunResult } from "./nextctl";
import { prepareSession, tidyEngineTabs } from "./preflight";

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
  it("keeps the selected runtime on every profile command", async () => {
    nextctl.json
      .mockResolvedValueOnce(greenVerification)
      .mockResolvedValueOnce({ tabs: [{ id: "page", url: "https://example.com" }] });

    const result = await prepareSession({
      selectedProfile: "work-profile",
      runtime: "camoufox",
      statuses: { "work-profile": "running" },
    });

    expect(result.profileArgs).toEqual(["--profile", "work-profile", "--runtime", "camoufox"]);
    expect(nextctl.json).toHaveBeenNthCalledWith(1, [
      "--profile", "work-profile", "--runtime", "camoufox", "verify", "--timeout", "30s",
    ]);
    expect(nextctl.json).toHaveBeenNthCalledWith(2, [
      "--profile", "work-profile", "--runtime", "camoufox", "tabs", "list",
    ]);
  });

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

describe("verification cadence", () => {
  const listing = { tabs: [{ id: "page", url: "https://x.com/notifications" }] };

  it("trusts a recent green verification of a running session", async () => {
    nextctl.json.mockImplementation(async (args: string[]) => (args.includes("verify") ? greenVerification : listing));
    const opts = { selectedProfile: "cadence-running", statuses: { "cadence-running": "running" }, verifyEvery: 60_000 };
    await prepareSession(opts);
    const second = await prepareSession(opts);
    const verifies = nextctl.json.mock.calls.filter(([args]) => (args as string[]).includes("verify"));
    expect(verifies).toHaveLength(1);
    expect(second.steps).toContain("Browser verified recently");
  });

  it("verifies again once the session had to be started", async () => {
    nextctl.json.mockImplementation(async (args: string[]) => (args.includes("verify") ? greenVerification : listing));
    await prepareSession({ selectedProfile: "cadence-restart", statuses: { "cadence-restart": "running" }, verifyEvery: 60_000 });
    await prepareSession({ selectedProfile: "cadence-restart", statuses: {}, verifyEvery: 60_000 });
    const verifies = nextctl.json.mock.calls.filter(([args]) => (args as string[]).includes("verify"));
    expect(verifies).toHaveLength(2);
  });

  it("verifies every time when no cadence is asked for", async () => {
    nextctl.json.mockImplementation(async (args: string[]) => (args.includes("verify") ? greenVerification : listing));
    const opts = { selectedProfile: "cadence-none", statuses: { "cadence-none": "running" } };
    await prepareSession(opts);
    await prepareSession(opts);
    const verifies = nextctl.json.mock.calls.filter(([args]) => (args as string[]).includes("verify"));
    expect(verifies).toHaveLength(2);
  });
});

describe("tidyEngineTabs", () => {
  it("closes verification pages and duplicate x.com tabs, keeping one", async () => {
    nextctl.json.mockImplementation(async (args: string[]) => (args.includes("list")
      ? {
        tabs: [
          { id: "a", url: "chrome://newtab/" },
          { id: "b", url: "clawbrowser://verify/" },
          { id: "c", url: "https://x.com/notifications" },
          { id: "d", url: "https://x.com/notifications" },
          { id: "e", url: "https://x.com/author" },
          { id: "f", url: "https://example.com/" },
        ],
      }
      : {}));
    const closed = await tidyEngineTabs(["--profile", "p"]);
    expect(closed).toBe(3);
    const closedIds = nextctl.json.mock.calls
      .filter(([args]) => (args as string[]).includes("close"))
      .map(([args]) => (args as string[]).at(-1));
    expect(closedIds.sort()).toEqual(["b", "d", "e"]);
  });

  it("prefers the active x.com tab and never closes the last page", async () => {
    nextctl.json.mockImplementation(async (args: string[]) => (args.includes("list")
      ? { tabs: [{ id: "old", url: "https://x.com/notifications" }, { id: "live", url: "https://x.com/notifications", active: true }] }
      : {}));
    expect(await tidyEngineTabs([])).toBe(1);
    expect(nextctl.json).toHaveBeenCalledWith(["tabs", "close", "old"]);

    nextctl.json.mockReset();
    nextctl.json.mockImplementation(async (args: string[]) => (args.includes("list")
      ? { tabs: [{ id: "only", url: "clawbrowser://verify/" }] }
      : {}));
    expect(await tidyEngineTabs([])).toBe(0);
  });
});
