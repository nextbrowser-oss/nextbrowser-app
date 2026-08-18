import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("./electronBridge", () => ({
  invoke: bridge.invoke,
  listen: bridge.listen,
  filePathForFile: () => "",
}));

vi.mock("./lib/analytics", () => ({
  setAnalyticsUserId: vi.fn(),
  trackEvent: vi.fn(),
  trackScreenView: vi.fn(),
  trackTiming: vi.fn(),
}));

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

function success(data: unknown = {}): { code: number; stdout: string; stderr: string } {
  return { code: 0, stdout: JSON.stringify({ ok: true, data }), stderr: "" };
}

function activeSessionFailure(): { code: number; stdout: string; stderr: string } {
  return {
    code: 1,
    stdout: JSON.stringify({
      ok: false,
      error: { code: "SESSION_ACTIVE", message: "profile has an active browser session" },
    }),
    stderr: "",
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", memoryStorage());
  bridge.invoke.mockReset();
  bridge.listen.mockReset();
  bridge.listen.mockResolvedValue(() => {});
});

describe("profile deletion", () => {
  it("stops a running external profile with its saved runtime before removing it", async () => {
    bridge.invoke.mockImplementation(async (command: string, payload?: { args?: string[] }) => {
      if (command === "nextctl_cancel") return true;
      if (command === "app_data_write") return undefined;
      if (command !== "nextctl_run") return null;
      const args = payload?.args ?? [];
      if (args[0] === "profiles" && args[1] === "ls") return success({ profiles: [] });
      return success();
    });

    const { useStore } = await import("./store");
    useStore.setState({
      profiles: [{ name: "Berlin demo" }],
      statuses: { "Berlin demo": "running" },
      selectedProfile: "Berlin demo",
      workspaces: [{
        id: "workspace",
        name: "Workspace",
        profileNames: ["Berlin demo"],
        profileToolsets: { "Berlin demo": "camoufox" },
        createdAt: 1,
        updatedAt: 1,
      }],
    });

    await useStore.getState().deleteProfile("Berlin demo");

    const runs = bridge.invoke.mock.calls
      .filter(([command]) => command === "nextctl_run")
      .map(([, payload]) => payload.args as string[]);
    expect(runs).toContainEqual([
      "stop", "--profile", "Berlin demo", "--runtime", "camoufox", "--format", "json",
    ]);
    expect(runs).toContainEqual(["profiles", "rm", "Berlin demo", "--format", "json"]);
    expect(useStore.getState().selectedProfile).toBeUndefined();
    expect(useStore.getState().workspaces[0].profileNames).toEqual([]);
  });

  it("recovers from a stale stopped status when nextctl reports an active session", async () => {
    let removeAttempts = 0;
    bridge.invoke.mockImplementation(async (command: string, payload?: { args?: string[] }) => {
      if (command === "nextctl_cancel") return true;
      if (command === "app_data_write") return undefined;
      if (command !== "nextctl_run") return null;
      const args = payload?.args ?? [];
      if (args[0] === "profiles" && args[1] === "rm") {
        removeAttempts += 1;
        return removeAttempts === 1 ? activeSessionFailure() : success();
      }
      if (args[0] === "profiles" && args[1] === "ls") return success({ profiles: [] });
      return success();
    });

    const { useStore } = await import("./store");
    useStore.setState({
      profiles: [{ name: "Python demo" }],
      statuses: { "Python demo": "stopped" },
      workspaces: [{
        id: "workspace",
        name: "Workspace",
        profileNames: ["Python demo"],
        profileToolsets: { "Python demo": "dasbrowser" },
        createdAt: 1,
        updatedAt: 1,
      }],
    });

    await useStore.getState().deleteProfile("Python demo");

    expect(removeAttempts).toBe(2);
    const stop = bridge.invoke.mock.calls.find(([, payload]) =>
      payload?.args?.[0] === "stop" && payload.args.includes("Python demo"));
    expect(stop?.[1].args).toContain("dasbrowser");
  });
});

describe("profile lifecycle", () => {
  it("rotates a DasBrowser country without requesting ClawBrowser verification", async () => {
    bridge.invoke.mockImplementation(async (command: string, payload?: { args?: string[] }) => {
      if (command === "app_data_write") return undefined;
      if (command !== "nextctl_run") return null;
      const args = payload?.args ?? [];
      if (args[0] === "profiles" && args[1] === "ls") return success({ profiles: [] });
      if (args[0] === "proxy-traffic") {
        return success({ proxy_traffic: { state: "ok", used_bytes: 0, limited: false } });
      }
      return success();
    });

    const { useStore } = await import("./store");
    useStore.setState({
      profiles: [{ name: "Das profile", country: "US" }],
      statuses: { "Das profile": "running" },
      workspaces: [{
        id: "workspace",
        name: "Workspace",
        profileNames: ["Das profile"],
        profileToolsets: { "Das profile": "dasbrowser" },
        createdAt: 1,
        updatedAt: 1,
      }],
    });

    await useStore.getState().rotateProfileCountry("Das profile", "DE");

    const rotate = bridge.invoke.mock.calls.find(([, payload]) => payload?.args?.[0] === "rotate");
    expect(rotate?.[1].args).toEqual([
      "rotate", "--profile", "Das profile", "--runtime", "dasbrowser", "--country", "DE", "--format", "json",
    ]);
    expect(useStore.getState().profileIdentities["Das profile"]).toEqual({ country: "DE" });
  });

  it("refreshes running profiles without opening a verification page", async () => {
    bridge.invoke.mockImplementation(async (command: string, payload?: { args?: string[] }) => {
      if (command !== "nextctl_run") return null;
      const args = payload?.args ?? [];
      if (args[0] === "profiles" && args[1] === "ls") {
        return success({ profiles: [{ name: "Research", country: "US" }] });
      }
      if (args[0] === "status") return success({ status: "running" });
      return success();
    });

    const { useStore } = await import("./store");
    useStore.setState({
      workspaces: [{
        id: "workspace",
        name: "Workspace",
        profileNames: ["Research"],
        profileToolsets: { Research: "clawbrowser" },
        createdAt: 1,
        updatedAt: 1,
      }],
    });

    await useStore.getState().loadProfiles();

    const commands = bridge.invoke.mock.calls
      .filter(([command]) => command === "nextctl_run")
      .map(([, payload]) => payload.args as string[]);
    expect(commands.some((args) => args[0] === "verify")).toBe(false);
    expect(useStore.getState().profileIdentities.Research).toEqual({ country: "US" });
  });
});
