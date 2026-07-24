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

function mockDesktop(identityValid: boolean) {
  bridge.listen.mockResolvedValue(() => {});
  bridge.invoke.mockImplementation(async (command: string, payload?: { args?: string[] }) => {
    switch (command) {
      case "app_data_read":
        return null;
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
              owner_id: identityValid ? "owner-1" : undefined,
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
