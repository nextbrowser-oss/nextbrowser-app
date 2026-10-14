import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCHEDULE_START_GRACE_MS, SCHEDULE_START_RETRY_MS } from "./lib/scheduleStart";
import type { Conversation, ScheduledRun, Workspace } from "./types";

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("./electronBridge", () => ({ ...bridge, filePathForFile: () => "" }));
vi.mock("./lib/analytics", () => ({ setAnalyticsUserId: vi.fn(), trackEvent: vi.fn(), trackScreenView: vi.fn(), trackTiming: vi.fn() }));

type Handler = (payload?: { args?: string[] }) => unknown;
const storage = new Map<string, string>();
const setItem = vi.fn((key: string, value: string) => { storage.set(key, String(value)); });
const ok = (data: unknown) => ({ code: 0, stderr: "", stdout: JSON.stringify({ ok: true, data }) });

// A Saturday: a daily run must fire on weekends too.
const SATURDAY_0900 = new Date(2026, 9, 17, 9, 0).getTime();
const userWorkspace: Workspace = { id: "w-user", name: "Mine", profileNames: [], profileToolsets: {}, createdAt: 1, updatedAt: 1 };
const scheduledWorkspace: Workspace = {
  id: "w-sched", name: "QA", profileNames: ["GE", "US"], profileToolsets: { GE: "clawbrowser", US: "clawbrowser" }, createdAt: 1, updatedAt: 1,
};
const userChat: Conversation = {
  id: "user-chat", title: "My terminal", agent: "claude", messages: [], createdAt: 1, updatedAt: 1,
  executionTarget: "local", chatMode: "terminal", workspaceId: "w-user",
};
const daily: ScheduledRun = {
  id: "daily", title: "GitHub star", prompt: "Check GitHub star for nextbrowser project. Use Clawbrowser with GE proxy",
  agent: "codex", enabled: true, hour: 9, minute: 0, weekdays: [1, 2, 3, 4, 5, 6, 7],
  workspaceId: "w-sched", profileName: "GE", createdAt: SATURDAY_0900 - 5 * 60_000,
};

function invokeWith(overrides: Record<string, Handler> = {}) {
  return async (command: string, payload?: { args?: string[] }) => {
    if (overrides[command]) return overrides[command](payload);
    if (command === "nextctl_run") {
      if (payload?.args?.[0] === "profiles") return ok({ profiles: [{ name: "GE" }, { name: "US" }] });
      return ok({ status: "stopped" });
    }
    if (command === "agent_authorize") return "codex-cli 0.162.1";
    if (command === "agent_check_login") return true;
    // The agent process never finishes, so a started run stays visible.
    if (command === "agent_run") return new Promise(() => {});
    return null;
  };
}

async function loadStore(options: { codex?: Record<string, unknown>; run?: Partial<ScheduledRun>; conversations?: Conversation[] } = {}) {
  const { useStore } = await import("./store");
  const runtime = useStore.getState().runtime;
  useStore.setState({
    authed: true,
    agentId: "claude",
    workspaces: [userWorkspace, scheduledWorkspace],
    activeWorkspaceId: "w-user",
    conversations: options.conversations ?? [userChat],
    activeConvId: { claude: "user-chat" },
    terminalChat: true,
    scheduledRuns: [{ ...daily, ...options.run }],
    // A consumer that is already draining keeps the prompt in the queue, where
    // the test can see it, instead of spawning an agent process.
    runtime: { ...runtime, codex: { ...runtime.codex, ready: true, loggedIn: true, isConsuming: true, ...options.codex } },
  });
  return useStore;
}

const runState = (useStore: Awaited<ReturnType<typeof loadStore>>) => useStore.getState().scheduledRuns[0];
const scheduledChats = (useStore: Awaited<ReturnType<typeof loadStore>>) =>
  useStore.getState().conversations.filter((conversation) => conversation.agent === "codex");

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SATURDAY_0900 + 60_000);
  storage.clear();
  setItem.mockClear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem,
    removeItem: (key: string) => { storage.delete(key); },
  });
  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(invokeWith());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("scheduled run start", () => {
  it("fires a daily run on a Saturday with its saved profile and records the start", async () => {
    const useStore = await loadStore();
    await useStore.getState().loadProfiles();
    await useStore.getState().tickScheduledRuns();

    expect(runState(useStore)).toMatchObject({ lastFiredAt: Date.now(), lastError: undefined });
    const [chat] = scheduledChats(useStore);
    expect(chat).toMatchObject({ title: "GitHub star", workspaceId: "w-sched", chatMode: "chat" });
    expect(chat.messages.map((message) => [message.role, message.status])).toEqual([["user", "done"], ["assistant", "queued"]]);
    expect(chat.messages[0].text).toBe(daily.prompt);
    expect(useStore.getState().runtime.codex.queue).toEqual([expect.objectContaining({ conversationId: chat.id, selectedProfile: "GE" })]);
  });

  it("does not switch the user's project, agent, or chat mode, live or after a restart", async () => {
    const ownChat: Conversation = { ...userChat, id: "sched-chat", title: "GitHub star", agent: "codex", chatMode: "chat", workspaceId: "w-sched" };
    for (const conversations of [[userChat], [userChat, ownChat]]) {
      vi.resetModules();
      setItem.mockClear();
      const useStore = await loadStore({ conversations, run: conversations.length > 1 ? { conversationId: "sched-chat" } : {} });
      await useStore.getState().loadProfiles();
      setItem.mockClear();
      await useStore.getState().tickScheduledRuns();

      expect(runState(useStore).lastFiredAt).toBe(Date.now());
      expect(useStore.getState()).toMatchObject({
        agentId: "claude", activeWorkspaceId: "w-user", activeConvId: { claude: "user-chat" }, terminalChat: true,
      });
      const persistedKeys = setItem.mock.calls.map(([key]) => key);
      expect(persistedKeys.filter((key) => key === "terminalChat" || key === "activeWorkspaceId" || key === "lastAgent"
        || key.startsWith("activeConversationId:"))).toEqual([]);
    }
  });
});

describe("a scheduled run that cannot start", () => {
  it("stays due and shows why when its agent cannot connect, then starts once the agent is back", async () => {
    bridge.invoke.mockImplementation(invokeWith({ agent_authorize: () => Promise.reject(new Error("codex executable not found")) }));
    const useStore = await loadStore({ codex: { ready: false } });
    await useStore.getState().loadProfiles();
    await useStore.getState().tickScheduledRuns();

    expect(runState(useStore).lastFiredAt).toBeUndefined();
    expect(runState(useStore).lastError).toMatch(/Codex not found/);
    // No empty chat and no dropped prompt.
    expect(scheduledChats(useStore)).toEqual([]);
    expect(useStore.getState().runtime.codex.queue).toEqual([]);

    // The next tick inside the retry pause does not reconnect again.
    const attempts = () => bridge.invoke.mock.calls.filter(([command]) => command === "agent_authorize").length;
    const before = attempts();
    await useStore.getState().tickScheduledRuns();
    expect(attempts()).toBe(before);

    // The user connects Codex; the run starts on the first tick after the pause.
    const runtime = useStore.getState().runtime;
    useStore.setState({ runtime: { ...runtime, codex: { ...runtime.codex, ready: true, loggedIn: true, error: undefined } } });
    vi.setSystemTime(Date.now() + SCHEDULE_START_RETRY_MS);
    await useStore.getState().tickScheduledRuns();
    expect(runState(useStore)).toMatchObject({ lastFiredAt: Date.now(), lastError: undefined });
    expect(scheduledChats(useStore)).toHaveLength(1);
  });

  it("reports a signed-out agent instead of silently dropping the prompt", async () => {
    bridge.invoke.mockImplementation(invokeWith({ agent_check_login: () => false }));
    const useStore = await loadStore({ codex: { loggedIn: false } });
    await useStore.getState().loadProfiles();
    await useStore.getState().tickScheduledRuns();

    expect(runState(useStore).lastFiredAt).toBeUndefined();
    expect(runState(useStore).lastError).toMatch(/Codex is signed out/);
    expect(scheduledChats(useStore)).toEqual([]);
  });

  it("waits for an agent that is still connecting, and says so if it never finishes", async () => {
    const useStore = await loadStore({ codex: { ready: false, authorizing: true } });
    await useStore.getState().loadProfiles();
    await useStore.getState().tickScheduledRuns();
    expect(runState(useStore).lastFiredAt).toBeUndefined();
    expect(runState(useStore).lastError).toBeUndefined();

    vi.setSystemTime(Date.now() + SCHEDULE_START_GRACE_MS);
    await useStore.getState().tickScheduledRuns();
    expect(runState(useStore).lastFiredAt).toBeUndefined();
    expect(runState(useStore).lastError).toMatch(/still connecting/);
  });

  it("clears the old failure when the schedule is edited", async () => {
    const useStore = await loadStore({ run: { lastError: "Codex is signed out." } });
    useStore.getState().updateScheduledRun("daily", { title: "GitHub star check" });
    expect(runState(useStore)).toMatchObject({ title: "GitHub star check", lastError: undefined });
  });
});

describe("a scheduled run before the profile list has loaded", () => {
  it("waits for the inventory instead of calling its profile deleted", async () => {
    const useStore = await loadStore();
    await useStore.getState().tickScheduledRuns();
    expect(runState(useStore).lastFiredAt).toBeUndefined();
    expect(runState(useStore).lastError).toBeUndefined();
    expect(scheduledChats(useStore)).toEqual([]);

    await useStore.getState().loadProfiles();
    await useStore.getState().tickScheduledRuns();
    expect(runState(useStore)).toMatchObject({ lastFiredAt: Date.now(), lastError: undefined });
  });

  it("reports an inventory that never loads instead of waiting forever", async () => {
    const useStore = await loadStore();
    await useStore.getState().tickScheduledRuns();
    vi.setSystemTime(Date.now() + SCHEDULE_START_GRACE_MS);
    await useStore.getState().tickScheduledRuns();
    expect(runState(useStore).lastFiredAt).toBeUndefined();
    expect(runState(useStore).lastError).toMatch(/profile list has not loaded/);
  });

  it("still reports a profile that is really gone once the inventory has loaded", async () => {
    bridge.invoke.mockImplementation(invokeWith({ nextctl_run: (payload) => payload?.args?.[0] === "profiles" ? ok({ profiles: [{ name: "US" }] }) : ok({ status: "stopped" }) }));
    const useStore = await loadStore();
    await useStore.getState().loadProfiles();
    await useStore.getState().tickScheduledRuns();
    expect(runState(useStore).lastFiredAt).toBeUndefined();
    expect(runState(useStore).lastError).toMatch(/no longer in this workspace/);
  });
});

it("creates a schedule without chosen days as every day, weekends included", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ agentId: "codex", activeWorkspaceId: "w-sched", scheduledRuns: [] });
  useStore.getState().addScheduledRun({ title: "GitHub star", prompt: daily.prompt, hour: 9, minute: 0, weekdays: [] });
  expect(useStore.getState().scheduledRuns[0].weekdays).toEqual([1, 2, 3, 4, 5, 6, 7]);
});
