import { afterEach, beforeEach, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("./electronBridge", () => ({ ...bridge, filePathForFile: () => "" }));
vi.mock("./lib/analytics", () => ({ setAnalyticsUserId: vi.fn(), trackEvent: vi.fn(), trackScreenView: vi.fn(), trackTiming: vi.fn() }));

const storage = new Map<string, string>();
beforeEach(() => {
  vi.resetModules();
  storage.clear();
  vi.stubGlobal("localStorage", {
    get length() { return storage.size; },
    key: (index: number) => [...storage.keys()][index] ?? null,
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  bridge.invoke.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const selection = { kind: "browser" as const, id: "mlx-1", name: "Shop" };

it("keeps the workspace Multilogin profile when another profile is selected", async () => {
  const { setMultiloginSelection, multiloginSelectionForWorkspace } = await import("./lib/multiloginSelection");
  const { useStore } = await import("./store");
  useStore.setState({ activeWorkspaceId: "w" });
  setMultiloginSelection("w", selection);
  useStore.getState().selectProfile("US profile");
  expect(multiloginSelectionForWorkspace("w")).toMatchObject({ id: "mlx-1", active: false });
});

it("starts the Multilogin profile and reports it running", async () => {
  const commands: string[][] = [];
  bridge.invoke.mockImplementation(async (command: string, args: { args: string[] }) => {
    if (command !== "nextctl_run") return undefined;
    commands.push(args.args);
    const op = args.args.find((arg) => ["start", "stop", "status"].includes(arg));
    return { code: 0, stderr: "", stdout: JSON.stringify({ ok: true, data: { status: op === "start" || op === "status" ? "running" : "stopped" } }) };
  });
  const { useStore } = await import("./store");
  await useStore.getState().setMultiloginRunning(selection, true);
  expect(commands[0]).toContain("start");
  expect(useStore.getState().multiloginStatuses["mlx-1"]).toBe("running");
});
