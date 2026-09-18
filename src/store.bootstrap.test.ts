import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function jsonResult(data: unknown) {
  return {
    stdout: JSON.stringify({ ok: true, data }),
    stderr: "",
    code: 0,
  };
}

function mockDesktop(identityValid: boolean, options?: { ownerId?: string; appData?: Record<string, string> }) {
  const ownerId = options?.ownerId ?? "owner-1";
  bridge.listen.mockResolvedValue(() => {});
  bridge.invoke.mockImplementation(async (command: string, payload?: { args?: string[]; name?: string }) => {
    switch (command) {
      case "app_data_read":
        return options?.appData?.[payload?.name ?? ""] ?? null;
      case "app_data_write":
        return undefined;
      case "working_directory":
        return "";
      case "nextctl_resolve":
        return "/tmp/nextctl";
      case "nextctl_version":
        return "nextctl 1.0.0";
      case "nextctl_supports_skill":
        return true;
      case "agent_authorize":
        throw new Error("agent unavailable in test");
      case "nextctl_run": {
        const args = payload?.args ?? [];
        if (args[0] === "identity") {
          return jsonResult({
            identity: {
              valid: identityValid,
              key_id: identityValid ? "key-1" : undefined,
              owner_id: identityValid ? ownerId : undefined,
              email: identityValid ? "person@example.com" : undefined,
            },
          });
        }
        if (args[0] === "proxy-traffic") {
          return jsonResult({
            proxy_traffic: {
              limited: false,
              used_bytes: 0,
              state: "ok",
            },
          });
        }
        if (args[0] === "profiles") return jsonResult({ profiles: [] });
        if (args[0] === "status") return jsonResult({ status: "stopped" });
        if (args[0] === "skill") return jsonResult({ categories: [] });
        return { stdout: "", stderr: "", code: 0 };
      }
      default:
        throw new Error(`Unexpected bridge command: ${command}`);
    }
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", memoryStorage());
  bridge.invoke.mockReset();
  bridge.listen.mockReset();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("desktop account bootstrap", () => {
  it("restores a connected account only from a valid identity", async () => {
    mockDesktop(true);
    const { useStore } = await import("./store");

    await useStore.getState().bootstrap();

    expect(useStore.getState()).toMatchObject({
      authed: true,
      accountEmail: "person@example.com",
      nextctlAvailable: true,
    });
  });

  it("keeps the account disconnected when the stored identity is invalid", async () => {
    mockDesktop(false);
    const { useStore } = await import("./store");

    await useStore.getState().bootstrap();

    expect(useStore.getState()).toMatchObject({
      authed: false,
      accountEmail: undefined,
      nextctlAvailable: true,
    });
    const nextctlCalls = bridge.invoke.mock.calls
      .filter(([command]) => command === "nextctl_run")
      .map(([, payload]) => payload.args as string[]);
    expect(nextctlCalls.some((args) => args[0] === "proxy-traffic")).toBe(false);
  });

  it("clears the saved credential before disconnecting the account", async () => {
    bridge.invoke.mockResolvedValue(null);
    const { useStore } = await import("./store");
    useStore.setState({
      authed: true,
      accountEmail: "person@example.com",
      profiles: [{ name: "work" }],
      selectedProfile: "work",
    });

    await useStore.getState().logout();

    expect(bridge.invoke).toHaveBeenCalledWith("account_logout");
    expect(useStore.getState()).toMatchObject({
      authed: false,
      accountEmail: undefined,
      profiles: [],
      selectedProfile: undefined,
    });
  });

  it("stays connected when the saved credential cannot be cleared", async () => {
    bridge.invoke.mockRejectedValue(new Error("permission denied"));
    const { useStore } = await import("./store");
    useStore.setState({ authed: true, accountEmail: "person@example.com" });

    await expect(useStore.getState().logout()).rejects.toThrow("permission denied");

    expect(useStore.getState()).toMatchObject({
      authed: true,
      accountEmail: "person@example.com",
    });
  });
});

describe("account cache ownership at boot", () => {
  it("drops a workspace cache stamped for a different account before it can reach cloud sync", async () => {
    const staleWorkspace = {
      id: "ws-from-account-0",
      name: "stale",
      profileNames: [],
      profileToolsets: {},
      profileProxyIds: {},
      createdAt: 1,
      updatedAt: 1,
    };
    mockDesktop(true, {
      ownerId: "owner-1",
      appData: { "workspaces.json": JSON.stringify([staleWorkspace]) },
    });
    const { useStore } = await import("./store");
    localStorage.setItem("cachedAccountOwnerId", "owner-0");
    const syncProjects = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ syncProjects });

    await useStore.getState().bootstrap();

    expect(useStore.getState().workspaces).toEqual([]);
    expect(syncProjects).toHaveBeenCalledOnce();
    expect(localStorage.getItem("cachedAccountOwnerId")).toBe("owner-1");
    const writes = bridge.invoke.mock.calls.filter(([command]) => command === "app_data_write");
    const workspaceWrite = writes.find(([, payload]) => (payload as { name?: string })?.name === "workspaces.json");
    expect(workspaceWrite?.[1]).toMatchObject({ content: "[]" });
  });

  it("keeps the workspace cache when it is stamped for the same account", async () => {
    const ownWorkspace = {
      id: "ws-from-account-1",
      name: "mine",
      profileNames: [],
      profileToolsets: {},
      profileProxyIds: {},
      createdAt: 1,
      updatedAt: 1,
    };
    mockDesktop(true, {
      ownerId: "owner-1",
      appData: { "workspaces.json": JSON.stringify([ownWorkspace]) },
    });
    const { useStore } = await import("./store");
    localStorage.setItem("cachedAccountOwnerId", "owner-1");
    const syncProjects = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ syncProjects });

    await useStore.getState().bootstrap();

    expect(useStore.getState().workspaces.map((w) => w.id)).toEqual(["ws-from-account-1"]);
    expect(localStorage.getItem("cachedAccountOwnerId")).toBe("owner-1");
  });

  it("stamps the cache on first login instead of treating an empty stamp as foreign", async () => {
    const ownWorkspace = {
      id: "ws-first-login",
      name: "first",
      profileNames: [],
      profileToolsets: {},
      profileProxyIds: {},
      createdAt: 1,
      updatedAt: 1,
    };
    mockDesktop(true, {
      ownerId: "owner-1",
      appData: { "workspaces.json": JSON.stringify([ownWorkspace]) },
    });
    const { useStore } = await import("./store");
    const syncProjects = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ syncProjects });

    await useStore.getState().bootstrap();

    expect(useStore.getState().workspaces.map((w) => w.id)).toEqual(["ws-first-login"]);
    expect(localStorage.getItem("cachedAccountOwnerId")).toBe("owner-1");
  });
});

describe("onboarding setup handoff", () => {
  it("returns to the same tutorial step after an external setup flow", async () => {
    const { useStore } = await import("./store");
    useStore.setState({
      showOnboarding: true,
      onboardingStepIndex: 2,
    });

    useStore.getState().suspendOnboardingForSetup();

    expect(useStore.getState()).toMatchObject({
      showOnboarding: false,
      onboardingStepIndex: 2,
      onboardingReturnPending: true,
    });

    useStore.getState().resumeOnboardingAfterSetup();

    expect(useStore.getState()).toMatchObject({
      showOnboarding: true,
      onboardingStepIndex: 2,
      onboardingReturnPending: false,
    });
  });

  it("does not reopen onboarding for setup flows started elsewhere", async () => {
    const { useStore } = await import("./store");
    useStore.setState({
      showOnboarding: false,
      onboardingReturnPending: false,
    });

    useStore.getState().resumeOnboardingAfterSetup();

    expect(useStore.getState().showOnboarding).toBe(false);
  });
});

describe("foreground startup deadline", () => {
  it.each(["app_data_read", "nextctl_resolve", "nextctl_version", "identity"])(
    "stops the main spinner when %s stalls, without declaring credentials invalid",
    async (blockedCommand) => {
      mockDesktop(true);
      const normalInvoke = bridge.invoke.getMockImplementation()!;
      bridge.invoke.mockImplementation((command, payload) => {
        if (command === blockedCommand || (blockedCommand === "identity" && command === "nextctl_run" && payload?.args?.[0] === "identity")) {
          return new Promise(() => {});
        }
        return normalInvoke(command, payload);
      });
      const { useStore } = await import("./store");
      const startup = useStore.getState().bootstrap();
      await vi.advanceTimersByTimeAsync(11_999);
      expect(useStore.getState().checking).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      await startup;
      expect(useStore.getState().checking).toBe(false);
      expect(useStore.getState().startupError).toContain("taking longer than expected");
      expect(useStore.getState().startupPhase).toBe(blockedCommand === "app_data_read" ? "local" : "account");
      expect(useStore.getState().accountEmail).toBeUndefined();
    },
  );

  it("opens the interface while agent setup and workspace sync are still pending", async () => {
    mockDesktop(true);
    const { useStore } = await import("./store");
    const syncProjects = vi.fn(() => new Promise<void>(() => {}));
    const authorizeAgent = vi.fn(() => new Promise<void>(() => {}));
    useStore.setState({ syncProjects, authorizeAgent });
    await useStore.getState().bootstrap();
    expect(syncProjects).toHaveBeenCalledOnce();
    expect(authorizeAgent).toHaveBeenCalledOnce();
    expect(useStore.getState()).toMatchObject({ checking: false, authed: true, startupError: undefined });
    await vi.advanceTimersByTimeAsync(12_000);
    expect(useStore.getState().startupError).toBeUndefined();
  });

  it("does not wait for an update that continues in the background", async () => {
    mockDesktop(true);
    const { useStore } = await import("./store");
    const tickNextctlDailyUpdate = vi.fn(() => new Promise<void>(() => {}));
    useStore.setState({ syncProjects: vi.fn().mockResolvedValue(undefined), refreshAll: vi.fn().mockResolvedValue(undefined), tickNextctlDailyUpdate });
    await useStore.getState().bootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(tickNextctlDailyUpdate).toHaveBeenCalledOnce();
    expect(useStore.getState().checking).toBe(false);
  });

  it("recovers automatically if the account check succeeds after the deadline", async () => {
    mockDesktop(true);
    const normalInvoke = bridge.invoke.getMockImplementation()!;
    let release!: (value: string) => void;
    bridge.invoke.mockImplementation((command, payload) => command === "nextctl_resolve"
      ? new Promise<string>((resolve) => { release = resolve; })
      : normalInvoke(command, payload));
    const { useStore } = await import("./store");
    const startup = useStore.getState().bootstrap();
    await vi.advanceTimersByTimeAsync(12_000);
    await startup;
    expect(useStore.getState().startupError).toBeDefined();
    release("/tmp/nextctl");
    await vi.advanceTimersByTimeAsync(0);
    expect(useStore.getState()).toMatchObject({ checking: false, authed: true, startupError: undefined });
  });

  it("offers recovery when initialization fails before credential verification", async () => {
    mockDesktop(true);
    bridge.listen.mockRejectedValue(new Error("bridge unavailable"));
    const { useStore } = await import("./store");
    await useStore.getState().bootstrap();
    expect(useStore.getState().checking).toBe(false);
    expect(useStore.getState().startupError).toContain("couldn't finish startup");
  });
});
