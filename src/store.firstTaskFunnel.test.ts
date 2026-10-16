import { beforeEach, expect, it, vi } from "vitest";
import { FIRST_TASK_EXAMPLE } from "./lib/onboarding";
import type { ChatMessage } from "./types";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), prepareSession: vi.fn() }));
vi.mock("./electronBridge", () => ({ invoke: mocks.invoke, listen: mocks.listen, filePathForFile: () => "" }));
vi.mock("./preflight", () => ({ prepareSession: mocks.prepareSession, tidyEngineTabs: vi.fn() }));
vi.mock("./lib/analytics", () => ({ setAnalyticsUserId: vi.fn(), trackEvent: vi.fn(), trackScreenView: vi.fn(), trackTiming: vi.fn() }));

const result = (data: unknown) => ({ code: 0, stdout: JSON.stringify({ ok: true, data }), stderr: "" });

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

let profileStatus = "running";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("localStorage", memoryStorage());
  profileStatus = "running";
  mocks.invoke.mockReset();
  mocks.prepareSession.mockReset();
  mocks.prepareSession.mockResolvedValue({ profileArgs: [] });
  mocks.invoke.mockImplementation(async (command: string, payload: { args: string[] }) => {
    if (command === "agent_run") return { code: 0, stdout: "The page title is Example Domain.", stderr: "" };
    if (command !== "nextctl_run") return null;
    return payload.args[0] === "profiles" ? result({ profiles: [{ name: "qa" }] }) : result({ status: profileStatus });
  });
});

async function newInstall(options: { messages?: ChatMessage[]; profileNames?: string[] } = {}) {
  const { useStore } = await import("./store");
  const analytics = await import("./lib/analytics");
  const state = useStore.getState();
  const profileNames = options.profileNames ?? ["qa"];
  useStore.setState({
    agentId: "codex",
    activeWorkspaceId: "w",
    selectedProfile: profileNames[0],
    workspaces: [{ id: "w", name: "QA", profileNames, profileToolsets: {}, createdAt: 1, updatedAt: 1 }],
    conversations: [{ id: "c", title: "QA", agent: "codex", workspaceId: "w", messages: options.messages ?? [], createdAt: 1, updatedAt: 1, executionTarget: "local" }],
    activeConvId: { codex: "c" },
    statuses: Object.fromEntries(profileNames.map((name) => [name, profileStatus])),
    runtime: { ...state.runtime, codex: { ...state.runtime.codex, ready: true, authorizing: false } },
    startConsumer: vi.fn(),
    startSessionPoll: vi.fn(),
    refreshAll: vi.fn(async () => undefined),
  });
  const runTask = async (text: string) => {
    useStore.getState().enqueue(text);
    const item = useStore.getState().runtime.codex.queue.at(-1)!;
    await useStore.getState().processItem("codex", item);
    return useStore.getState().conversations[0].messages.find((message) => message.id === item.replyId);
  };
  const firstTaskEvents = () => vi.mocked(analytics.trackEvent).mock.calls
    .filter(([name]) => name.startsWith("first_task_"));
  return { useStore, runTask, firstTaskEvents };
}

it("reports a new install's first task and its first browser success, once each", async () => {
  const { runTask, firstTaskEvents } = await newInstall();

  expect((await runTask(FIRST_TASK_EXAMPLE))?.status).toBe("done");
  expect((await runTask("Open example.org"))?.status).toBe("done");

  expect(firstTaskEvents()).toEqual([
    ["first_task_submitted", { agent: "codex", chip_kind: "none", execution_target: "local", from_example: true, onboarding_done: false }],
    ["first_task_succeeded", { agent: "codex", execution_target: "local", from_example: true, onboarding_done: false }],
  ]);
});

it("keeps an install that already sent tasks out of the first-task funnel", async () => {
  const earlier: ChatMessage[] = [
    { id: "u0", role: "user", text: "Earlier task", status: "done", createdAt: 1 },
    { id: "a0", role: "assistant", text: "Done.", status: "done", createdAt: 1 },
  ];
  const { runTask, firstTaskEvents } = await newInstall({ messages: earlier });

  expect((await runTask(FIRST_TASK_EXAMPLE))?.status).toBe("done");

  expect(firstTaskEvents()).toEqual([]);
});

it("waits for a reply that ran with a browser profile before reporting success", async () => {
  const { useStore, runTask, firstTaskEvents } = await newInstall({ profileNames: [] });

  expect((await runTask("What can you do?"))?.status).toBe("done");
  expect(firstTaskEvents().map(([name]) => name)).toEqual(["first_task_submitted"]);

  useStore.setState((state) => ({
    selectedProfile: "qa",
    workspaces: state.workspaces.map((workspace) => ({ ...workspace, profileNames: ["qa"] })),
    statuses: { qa: "running" },
  }));
  expect((await runTask("Open example.com and read the title"))?.status).toBe("done");

  expect(firstTaskEvents()).toEqual([
    ["first_task_submitted", expect.objectContaining({ from_example: false })],
    ["first_task_succeeded", expect.objectContaining({ from_example: false })],
  ]);
});
