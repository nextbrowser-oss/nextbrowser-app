import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), prepareSession: vi.fn() }));
vi.mock("./electronBridge", () => ({ invoke: mocks.invoke, listen: mocks.listen, filePathForFile: () => "" }));
vi.mock("./preflight", () => ({ prepareSession: mocks.prepareSession, tidyEngineTabs: vi.fn() }));
vi.mock("./lib/analytics", () => ({ setAnalyticsUserId: vi.fn(), trackEvent: vi.fn(), trackScreenView: vi.fn(), trackTiming: vi.fn() }));
const result = (data: unknown) => ({ code: 0, stdout: JSON.stringify({ ok: true, data }), stderr: "" });
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  mocks.invoke.mockReset(); mocks.prepareSession.mockReset();
  mocks.invoke.mockImplementation(async (command, payload) => {
    if (command !== "nextctl_run") return null;
    return payload.args[0] === "profiles" ? result({ profiles: [{ name: "qa" }] }) : result({ status: "running" });
  });
});

it("keeps a live process Starting until verify finishes and joins duplicate starts", async () => {
  const { useStore } = await import("./store");
  let resolve!: (value: unknown) => void;
  mocks.prepareSession.mockImplementation(() => new Promise((done) => { resolve = done; }));
  const first = useStore.getState().startProfile("qa");
  const second = useStore.getState().startProfile("qa");
  expect(second).toBe(first);
  await useStore.getState().loadProfiles();
  expect(useStore.getState().statuses.qa).toBe("starting");
  expect(useStore.getState().profileSessions.qa.status).toBe("starting");
  expect(mocks.prepareSession).toHaveBeenCalledTimes(1);
  resolve({ profileArgs: [] });
  await first;
  expect(useStore.getState().statuses.qa).toBe("running");
});

it("does not dispatch an agent while startup verification is pending or after it fails", async () => {
  const { useStore } = await import("./store");
  let reject!: (error: Error) => void;
  mocks.prepareSession.mockImplementation(() => new Promise((_done, fail) => { reject = fail; }));
  const state = useStore.getState();
  useStore.setState({
    agentId: "codex", activeWorkspaceId: "w", selectedProfile: "qa",
    workspaces: [{ id: "w", name: "QA", profileNames: ["qa"], profileToolsets: {}, createdAt: 1, updatedAt: 1 }],
    conversations: [{ id: "c", title: "QA", agent: "codex", workspaceId: "w", messages: [], createdAt: 1, updatedAt: 1, executionTarget: "local" }],
    activeConvId: { codex: "c" },
    runtime: { ...state.runtime, codex: { ...state.runtime.codex, ready: true, authorizing: false } },
    startConsumer: vi.fn(),
  });
  const start = useStore.getState().startProfile("qa");
  const failed = expect(start).rejects.toThrow("VERIFY_FAILED");
  useStore.getState().enqueue("Open example.com");
  const item = useStore.getState().runtime.codex.queue[0];
  const run = useStore.getState().processItem("codex", item);
  await vi.waitFor(() => expect(useStore.getState().runtime.codex.runningReplyId).toBe(item.replyId));
  expect(mocks.invoke.mock.calls.some(([name]) => name === "agent_run")).toBe(false);
  reject(new Error("VERIFY_FAILED"));
  await failed; await run;
  expect(mocks.invoke.mock.calls.some(([name]) => name === "agent_run")).toBe(false);
  expect(useStore.getState().statuses.qa).toBe("stopped");
  expect(useStore.getState().conversations[0].messages.find((m) => m.id === item.replyId)?.status).toBe("failed");
});

it("does not dispatch a cancelled request when startup later succeeds", async () => {
  const { useStore } = await import("./store");
  let resolve!: (value: unknown) => void;
  mocks.prepareSession.mockImplementation(() => new Promise((done) => { resolve = done; }));
  const state = useStore.getState();
  useStore.setState({
    agentId: "codex", activeWorkspaceId: "w", selectedProfile: "qa",
    workspaces: [{ id: "w", name: "QA", profileNames: ["qa"], profileToolsets: {}, createdAt: 1, updatedAt: 1 }],
    conversations: [{ id: "c", title: "QA", agent: "codex", workspaceId: "w", messages: [], createdAt: 1, updatedAt: 1, executionTarget: "local" }],
    activeConvId: { codex: "c" },
    runtime: { ...state.runtime, codex: { ...state.runtime.codex, ready: true, authorizing: false } },
    startConsumer: vi.fn(),
  });
  const start = useStore.getState().startProfile("qa");
  useStore.getState().enqueue("Open example.com");
  const item = useStore.getState().runtime.codex.queue[0];
  const run = useStore.getState().processItem("codex", item);
  await vi.waitFor(() => expect(useStore.getState().runtime.codex.runningReplyId).toBe(item.replyId));
  useStore.setState((s) => ({ runtime: { ...s.runtime, codex: { ...s.runtime.codex, pendingStop: true } } }));
  resolve({ profileArgs: [] });
  await start; await run;
  expect(mocks.invoke.mock.calls.some(([name]) => name === "agent_run")).toBe(false);
  expect(useStore.getState().conversations[0].messages.find((m) => m.id === item.replyId)?.status).toBe("cancelled");
});
