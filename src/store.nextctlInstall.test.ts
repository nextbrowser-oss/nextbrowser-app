import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

const FIFTEEN_MINUTES = 15 * 60_000;

function nextctlRuns(first: string) {
  return bridge.invoke.mock.calls.filter(([command, payload]) => command === "nextctl_run" && payload?.args?.[0] === first);
}

let useStore: (typeof import("./store"))["useStore"];
let initialState: ReturnType<(typeof import("./store"))["useStore"]["getState"]>;
let appData: Record<string, string>;
let updateResult: { code: number; stdout: string; stderr: string };

beforeAll(async () => {
  vi.stubGlobal("localStorage", memoryStorage());
  ({ useStore } = await import("./store"));
  initialState = useStore.getState();
});

beforeEach(() => {
  localStorage.clear();
  appData = {};
  updateResult = { code: 0, stdout: "nbc already up to date: v1.2.37\n", stderr: "" };
  bridge.invoke.mockReset();
  bridge.listen.mockReset();
  bridge.invoke.mockImplementation(async (command: string, payload?: { args?: string[]; name?: string; content?: string }) => {
    switch (command) {
      case "app_data_read": return appData[payload?.name ?? ""] ?? null;
      case "app_data_write": appData[payload?.name ?? ""] = payload?.content ?? ""; return undefined;
      case "agent_authorize": return "1.0.0";
      case "agent_check_login": return true;
      case "nextctl_version": return "nbc 1.2.37";
      case "nextctl_supports_skill": return true;
      case "nextctl_run": return payload?.args?.[0] === "update" ? updateResult : { code: 0, stdout: "", stderr: "" };
      default: return null;
    }
  });
  useStore.setState({ ...initialState, nextctlAvailable: true, startConsumer: vi.fn() }, true);
});

describe("Nextbrowser CLI install and update", () => {
  it("gives the agent integration install as long as a browser download needs", async () => {
    useStore.setState((state) => ({ runtime: { ...state.runtime, codex: { ...state.runtime.codex, ready: false, authorizing: false } } }));
    await useStore.getState().authorizeAgent({ agentId: "codex" });
    await vi.waitFor(() => expect(nextctlRuns("install")).toHaveLength(1));
    expect(nextctlRuns("install")[0][1]).toMatchObject({
      args: ["install", "--agent", "codex", "--no-api-key-prompt"],
      timeoutMs: FIFTEEN_MINUTES,
    });
  });

  it("gives nbc update as long as a browser download needs", async () => {
    await expect(useStore.getState().checkNextctlUpdate()).resolves.toBe(true);
    expect(nextctlRuns("update")[0][1]).toMatchObject({ args: ["update"], timeoutMs: FIFTEEN_MINUTES });
  });
});
