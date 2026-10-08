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

const mebibyte = 1024 * 1024;
const gibibyte = 1024 * mebibyte;
const repoUrl = "https://github.com/nextbrowser-oss/nextbrowser-app";

let traffic: Record<string, unknown> = {};
let starStatus: unknown = null;
let verifyResult: unknown = null;
let verifyError: Error | undefined;

function mockDesktop() {
  bridge.listen.mockResolvedValue(() => {});
  bridge.invoke.mockImplementation(async (command: string, payload?: { args?: string[] }) => {
    switch (command) {
      case "app_data_read": return null;
      case "app_data_write": return undefined;
      case "github_star_status": return starStatus;
      case "github_star_verify":
        if (verifyError) throw verifyError;
        return verifyResult;
      case "nextctl_run": {
        const args = payload?.args ?? [];
        if (args[0] === "proxy-traffic") {
          return { stdout: JSON.stringify({ ok: true, data: { proxy_traffic: traffic } }), stderr: "", code: 0 };
        }
        return { stdout: "", stderr: "", code: 0 };
      }
      default: return undefined;
    }
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", memoryStorage());
  bridge.invoke.mockReset();
  bridge.listen.mockReset();
  traffic = { limited: true, used_bytes: 0, limit_bytes: mebibyte, remaining_bytes: mebibyte, state: "ok" };
  starStatus = { required: true, claimed: false, revoked: false, repoUrl, rewardBytes: gibibyte };
  verifyResult = { required: false, claimed: true, revoked: false, repoUrl, rewardBytes: gibibyte };
  verifyError = undefined;
  mockDesktop();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHub star reward", () => {
  it("loads the status the main process reads", async () => {
    const { useStore } = await import("./store");
    await useStore.getState().loadGitHubStar();
    expect(useStore.getState().githubStar).toEqual(starStatus);

    starStatus = null;
    await useStore.getState().loadGitHubStar();
    expect(useStore.getState().githubStar).toBeNull();
  });

  it("claims the reward, closes the prompts and reloads the traffic", async () => {
    const { useStore } = await import("./store");
    await useStore.getState().loadGitHubStar();
    useStore.getState().setGitHubStarPromptOpen(true);
    traffic = { limited: true, used_bytes: 0, limit_bytes: gibibyte, remaining_bytes: gibibyte, state: "ok" };
    const page = new EventTarget();
    const starCountRefreshes = vi.fn();
    page.addEventListener("nextbrowser:github-stars-refresh", starCountRefreshes);
    vi.stubGlobal("window", page);

    await useStore.getState().verifyGitHubStar();

    const state = useStore.getState();
    expect(state.githubStar).toEqual(verifyResult);
    expect(state.githubStarPromptOpen).toBe(false);
    expect(state.proxy?.limit_bytes).toBe(gibibyte);
    // The header count picks up the verified star without a restart.
    expect(starCountRefreshes).toHaveBeenCalledTimes(1);
  });

  it("keeps the ask when the star is not there yet", async () => {
    const { useStore } = await import("./store");
    await useStore.getState().loadGitHubStar();
    verifyError = new Error("GitHub does not list your account among the stargazers yet");

    await expect(useStore.getState().verifyGitHubStar()).rejects.toThrow("stargazers");
    expect(useStore.getState().githubStar).toEqual(starStatus);
  });

  it("asks for the star instead of Discord when a GitHub sign-up runs out", async () => {
    const { useStore } = await import("./store");
    await useStore.getState().loadGitHubStar();
    await useStore.getState().loadProxy();

    traffic = { limited: true, used_bytes: mebibyte, limit_bytes: mebibyte, remaining_bytes: 0, state: "exhausted" };
    await useStore.getState().loadProxy();

    expect(useStore.getState().githubStarPromptOpen).toBe(true);
    expect(useStore.getState().trafficGatePromptOpen).toBe(false);
  });

  it("re-reads the star when a removed star pauses the traffic mid-session, and again when it comes back", async () => {
    const statusReads = () => bridge.invoke.mock.calls.filter(([command]) => command === "github_star_status").length;
    const claimed = { required: false, claimed: true, revoked: false, repoUrl, rewardBytes: gibibyte };
    const revoked = { required: true, claimed: false, revoked: true, repoUrl, rewardBytes: gibibyte };
    starStatus = claimed;
    traffic = { limited: true, used_bytes: 200 * mebibyte, limit_bytes: gibibyte, remaining_bytes: gibibyte - 200 * mebibyte, state: "ok" };
    const { useStore } = await import("./store");
    await useStore.getState().loadGitHubStar();
    await useStore.getState().loadProxy();
    await useStore.getState().loadProxy();
    expect(statusReads()).toBe(1);

    // The backend froze the limit at the traffic already spent.
    starStatus = revoked;
    traffic = { limited: true, used_bytes: 200 * mebibyte, limit_bytes: 200 * mebibyte, remaining_bytes: 0, state: "exhausted" };
    await useStore.getState().loadProxy();

    expect(useStore.getState().githubStar).toEqual(revoked);
    expect(useStore.getState().githubStarPromptOpen).toBe(true);
    expect(useStore.getState().trafficGatePromptOpen).toBe(false);
    expect(statusReads()).toBe(2);

    // Starred again; the backend's own recheck restored the limit.
    starStatus = claimed;
    traffic = { limited: true, used_bytes: 200 * mebibyte, limit_bytes: gibibyte, remaining_bytes: gibibyte - 200 * mebibyte, state: "ok" };
    await useStore.getState().loadProxy();

    expect(useStore.getState().githubStar).toEqual(claimed);
    expect(statusReads()).toBe(3);
  });

  it("tells a restored star apart from a first claim", async () => {
    starStatus = { required: true, claimed: false, revoked: true, repoUrl, rewardBytes: gibibyte };
    const { useStore } = await import("./store");
    const { trackEvent } = await import("./lib/analytics");
    await useStore.getState().loadGitHubStar();
    useStore.getState().setGitHubStarPromptOpen(true);
    expect(trackEvent).toHaveBeenCalledWith("github_star_prompt_shown", { revoked: true });

    await useStore.getState().verifyGitHubStar();

    expect(useStore.getState().githubStar).toEqual(verifyResult);
    expect(useStore.getState().githubStarPromptOpen).toBe(false);
    expect(trackEvent).toHaveBeenCalledWith("github_star_reward_claimed", { reward_bytes: gibibyte, restored: true });
  });
});
