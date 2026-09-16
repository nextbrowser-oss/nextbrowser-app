import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareSession, tidyEngineTabs } from "./preflight";

const nextctl = vi.hoisted(() => ({
  json: vi.fn(),
  run: vi.fn(),
}));

vi.mock("./nextctl", () => ({
  nextctlJson: nextctl.json, nextctlRun: nextctl.run,
  nextctlErrorMessage: (r: { stderr: string; stdout: string }) => r.stderr || r.stdout,
}));
const green = { verify: { finalized: true, status: "pass", checks: [{ pass: true }] } };
const failed = { verify: { finalized: true, status: "fail", checks: [{ pass: false, surface: "Proxy" }] } };
const options = { selectedProfile: "work", runtime: "clawbrowser" as const, statuses: { work: "running" }, host: "example.com" };
const commands = () => nextctl.run.mock.calls.map(([args]) => args);
beforeEach(() => {
  nextctl.json.mockReset(); nextctl.run.mockReset();
  nextctl.run.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
  nextctl.json.mockImplementation(async (args: string[]) => args.includes("verify") ? green : { tabs: [] });
});
describe("mandatory proxy startup", () => {
  it.each([
    ["failed", failed], ["missing", {}],
    ["pending", { verify: { finalized: false, status: "pending", checks: [{ pass: true }] } }],
    ["empty", { verify: { finalized: true, status: "pass", checks: [] } }],
    ["contradictory", { verify: { finalized: true, status: "pass", checks: [{ pass: false }] } }],
  ])("stops, restarts the same proxy, stops again before asking on %s verify", async (_label, result) => {
    nextctl.json.mockResolvedValue(result);
    const choose = vi.fn(async () => {
      expect(commands()).toEqual([
        ["--profile", "work", "--runtime", "clawbrowser", "stop", "--format", "json"],
        ["--profile", "work", "--runtime", "clawbrowser", "start", "--format", "json"],
        ["--profile", "work", "--runtime", "clawbrowser", "stop", "--format", "json"],
        ["--profile", "work", "--runtime", "clawbrowser", "start", "--format", "json"],
        ["--profile", "work", "--runtime", "clawbrowser", "stop", "--format", "json"],
      ]);
      return "cancel" as const;
    });
    await expect(prepareSession({ ...options, onVerificationFailure: choose })).rejects.toThrow();
    expect(choose).toHaveBeenCalledOnce();
    expect(nextctl.json.mock.calls.every(([args]) => args.includes("verify"))).toBe(true);
  });
  it("treats timeout as failure, stops all three attempts and never opens a site", async () => {
    nextctl.json.mockRejectedValue(new Error("deadline exceeded"));
    await expect(prepareSession(options)).rejects.toThrow("deadline exceeded");
    expect(commands().map((args) => args[4])).toEqual(["stop", "start", "stop", "start", "stop"]);
  });
  it("continues after successful same-proxy restart without asking for direct access", async () => {
    nextctl.json.mockResolvedValueOnce(failed).mockResolvedValueOnce(green);
    const choose = vi.fn();
    const result = await prepareSession({ ...options, onVerificationFailure: choose });
    expect(choose).not.toHaveBeenCalled();
    expect(commands().map((args) => args[4])).toEqual(["stop", "start", "open", "wait"]);
    expect(result.directFallback).toBe(false);
    expect(result.profileArgs).toEqual(["--profile", "work", "--runtime", "clawbrowser"]);
  });
  it("does not restart, prompt or open a site if stopping the failed profile fails", async () => {
    nextctl.json.mockResolvedValue(failed);
    nextctl.run.mockResolvedValue({ code: 1, stdout: "", stderr: "stop failed" });
    const choose = vi.fn();
    await expect(prepareSession({ ...options, onVerificationFailure: choose })).rejects.toThrow("Could not stop");
    expect(nextctl.run).toHaveBeenCalledOnce();
    expect(choose).not.toHaveBeenCalled();
  });
  it("offers direct access only after the third stopped failure and waits for consent", async () => {
    nextctl.json.mockResolvedValue(failed);
    let approve: (choice: "direct") => void = () => {};
    const choose = vi.fn(() => new Promise<"direct">((resolve) => { approve = resolve; }));
    const pending = prepareSession({ ...options, onVerificationFailure: choose });
    await vi.waitFor(() => expect(choose).toHaveBeenCalledOnce());
    expect(choose).toHaveBeenCalledWith(expect.objectContaining({ attempts: 3, proxyExpected: true }));
    expect(commands().map((args) => args[4])).toEqual(["stop", "start", "stop", "start", "stop"]);
    nextctl.json.mockImplementation(async (args: string[]) => args.includes("verify") ? green : { tabs: [] });
    approve("direct");
    const result = await pending;
    expect(result.directFallback).toBe(true);
    expect(result.profileArgs[1]).toMatch(/^direct-consented-/);
    expect(commands().find((args) => args[0] === "profiles")).toEqual(["profiles", "create", result.profileArgs[1], "--no-proxy", "--format", "json"]);
    expect(commands().find((args) => args.includes("open"))?.[1]).toBe(result.profileArgs[1]);
  });
  it("stops a consented direct session too if its verification fails", async () => {
    nextctl.json.mockResolvedValue(failed);
    await expect(prepareSession({ ...options, onVerificationFailure: async () => "direct" })).rejects.toThrow();
    expect(commands().at(-1)).toEqual(["--profile", expect.stringMatching(/^direct-consented-/), "--runtime", "clawbrowser", "stop", "--format", "json"]);
    expect(commands().some((args) => args.includes("open"))).toBe(false);
  });
  it("succeeds on the third proxy attempt without offering a direct session", async () => {
    nextctl.json.mockResolvedValueOnce(failed).mockResolvedValueOnce(failed).mockResolvedValueOnce(green);
    const choose = vi.fn();
    const result = await prepareSession({ ...options, onVerificationFailure: choose });
    expect(choose).not.toHaveBeenCalled();
    expect(result.directFallback).toBe(false);
    expect(commands().map((args) => args[4])).toEqual(["stop", "start", "stop", "start", "open", "wait"]);
  });
  it("allows a profile explicitly created as direct to run after successful verification", async () => {
    const result = await prepareSession({ ...options, selectedProfile: "created-direct", statuses: { "created-direct": "running" }, proxyExpected: false });
    expect(result.profileArgs[1]).toBe("created-direct");
    expect(result.directFallback).toBe(false);
    expect(commands().map((args) => args[4])).toEqual(["open", "wait"]);
  });
  it("cleans up a failed diagnostic start and retries before opening a site", async () => {
    nextctl.run.mockResolvedValueOnce({ code: 0, stdout: JSON.stringify({ ok: false, error: { message: "proxy start failed" } }), stderr: "proxy start failed" });
    const result = await prepareSession({ ...options, statuses: {} });
    expect(commands().map((args) => args[4])).toEqual(["start", "stop", "start", "open", "wait"]);
    expect(result.directFallback).toBe(false);
  });

  it("checks a newly started profile before reporting it ready", async () => {
    const onStep = vi.fn();
    await prepareSession({ ...options, statuses: {}, verifyOnly: true, onStep });
    expect(commands().map((args) => args[4])).toEqual(["start"]);
    expect(onStep).toHaveBeenLastCalledWith("Browser verified");
  });
  it("cancels without restarting when the user stops the pending startup", async () => {
    let active = true;
    nextctl.json.mockImplementation(async () => { active = false; return failed; });
    await expect(prepareSession({ ...options, shouldContinue: () => active })).rejects.toThrow("cancelled");
    expect(commands().map((args) => args[4])).toEqual(["stop"]);
  });
  it("does not report ready if navigation fails after a successful verify", async () => {
    nextctl.run.mockResolvedValue({ code: 1, stdout: "", stderr: "navigation failed" });
    const onStep = vi.fn();
    await expect(prepareSession({ ...options, onStep })).rejects.toThrow("Could not open");
    expect(onStep).not.toHaveBeenCalledWith("Page ready");
  });
});

describe("verification cadence", () => {
  const listing = { tabs: [{ id: "page", url: "https://x.com/notifications" }] };

  it("requires fresh verification even when a caller requests cached proof", async () => {
    nextctl.json.mockImplementation(async (args: string[]) => (args.includes("verify") ? green : listing));
    const opts = { selectedProfile: "cadence-running", statuses: { "cadence-running": "running" }, verifyEvery: 60_000 };
    await prepareSession(opts);
    const second = await prepareSession(opts);
    const verifies = nextctl.json.mock.calls.filter(([args]) => (args as string[]).includes("verify"));
    expect(verifies).toHaveLength(2);
    expect(second.steps).toContain("Browser verified");
  });

  it("verifies again once the session had to be started", async () => {
    nextctl.json.mockImplementation(async (args: string[]) => (args.includes("verify") ? green : listing));
    await prepareSession({ selectedProfile: "cadence-restart", statuses: { "cadence-restart": "running" }, verifyEvery: 60_000 });
    await prepareSession({ selectedProfile: "cadence-restart", statuses: {}, verifyEvery: 60_000 });
    const verifies = nextctl.json.mock.calls.filter(([args]) => (args as string[]).includes("verify"));
    expect(verifies).toHaveLength(2);
  });

  it("verifies every time when no cadence is asked for", async () => {
    nextctl.json.mockImplementation(async (args: string[]) => (args.includes("verify") ? green : listing));
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

it("uses CLI startup verification without repeating verify for a running profile", async () => {
  await prepareSession({ ...options, startupVerifies: true });
  expect(nextctl.json.mock.calls.some(([args]) => args.includes("verify"))).toBe(false);
  expect(commands().map(args => args[4])).toEqual(["open", "wait"]);
});

it("starts through the verified CLI without a second verification page", async () => {
  await prepareSession({ ...options, statuses: {}, startupVerifies: true, verifyOnly: true });
  expect(commands().map(args => args[4])).toEqual(["start"]);
  expect(nextctl.json.mock.calls.some(([args]) => args.includes("verify"))).toBe(false);
});

it("stops and reports a failed verified startup without retries or opening a site", async () => {
  nextctl.run.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "VERIFY_FAILED: proxy unavailable" });
  const onVerificationFailure = vi.fn().mockResolvedValue("cancel");
  await expect(prepareSession({ ...options, statuses: {}, startupVerifies: true, onVerificationFailure })).rejects.toThrow("VERIFY_FAILED");
  expect(commands().map(args => args[4])).toEqual(["start", "stop"]);
  expect(onVerificationFailure).toHaveBeenCalledWith(expect.objectContaining({ attempts: 1, proxyExpected: true }));
});
