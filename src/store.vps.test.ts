import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, Conversation, CustomScript } from "./types";
import type { SkillEntry } from "./skillsCatalog";
import { VPS_PROMPT_MARKER } from "./lib/vpsPrompt";

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

const preflight = vi.hoisted(() => ({
  prepareSession: vi.fn(),
}));

vi.mock("./electronBridge", () => ({
  invoke: bridge.invoke,
  listen: bridge.listen,
  filePathForFile: () => "",
}));

vi.mock("./preflight", () => ({
  prepareSession: preflight.prepareSession,
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

function message(id: string, role: ChatMessage["role"], text: string): ChatMessage {
  return { id, role, text, status: "done", createdAt: 1 };
}

function conversation(id: string, executionTarget: "local" | "vps", messages: ChatMessage[] = []): Conversation {
  return {
    id,
    title: executionTarget === "vps" ? "VPS" : "Local",
    agent: "codex",
    messages,
    createdAt: 1,
    updatedAt: 1,
    executionTarget,
  };
}

function skillEntry(overrides: Partial<SkillEntry> = {}): SkillEntry {
  return {
    id: "remote-skill",
    title: "Remote skill",
    subtitle: "example.com",
    selector: { kind: "domain", value: "example.com" },
    category: "browser",
    categoryTitle: "Browser",
    categoryIcon: "globe",
    categoryOrder: 1,
    ...overrides,
  };
}

function customScript(): CustomScript {
  return {
    id: "custom-remote",
    title: "Remote custom script",
    domain: "example.com",
    instructions: "Extract the page title.",
    createdAt: 1,
    updatedAt: 1,
  };
}

function localNextctlCalls() {
  return bridge.invoke.mock.calls.filter(([command]) => command === "nextctl_run");
}

let useStore: (typeof import("./store"))["useStore"];
let initialState: ReturnType<(typeof import("./store"))["useStore"]["getState"]>;

beforeAll(async () => {
  vi.stubGlobal("localStorage", memoryStorage());
  ({ useStore } = await import("./store"));
  initialState = useStore.getState();
});

beforeEach(() => {
  bridge.invoke.mockReset();
  bridge.listen.mockReset();
  preflight.prepareSession.mockReset();
  preflight.prepareSession.mockResolvedValue({ profileArgs: [], host: undefined });
  const runtime = Object.fromEntries(
    Object.entries(initialState.runtime).map(([id, value]) => [id, { ...value, queue: [] }]),
  );
  runtime.codex = { ...runtime.codex, ready: true, authorizing: false, queue: [] };
  useStore.setState({
    ...initialState,
    agentId: "codex",
    runtime,
    conversations: [],
    activeConvId: {},
    startConsumer: vi.fn(),
    startSessionPoll: vi.fn(),
  }, true);
});

describe("VPS execution target isolation", () => {
  it("stores the remote target on queued follow-up turns", () => {
    const remote = conversation("remote", "vps");
    useStore.setState({ conversations: [remote], activeConvId: { codex: remote.id } });

    useStore.getState().enqueue("Open example.com");

    const queued = useStore.getState().runtime.codex.queue;
    expect(queued).toHaveLength(1);
    expect(queued[0].executionTarget).toBe("vps");
  });

  it("does not start local session polling for a remote queue item", async () => {
    const remote = conversation("remote", "vps", [
      message("user", "user", "Open example.com"),
      { ...message("reply", "assistant", ""), status: "queued" },
    ]);
    const startSessionPoll = vi.fn();
    useStore.setState({
      conversations: [remote],
      activeConvId: { codex: remote.id },
      startSessionPoll,
    });
    bridge.invoke.mockImplementation((command) => command === "agent_run"
      ? Promise.reject(new Error("stop after prompt capture"))
      : Promise.resolve(null));

    await useStore.getState().processItem("codex", {
      conversationId: remote.id,
      rawText: "Open example.com",
      replyId: "reply",
      executionTarget: "vps",
    });

    expect(startSessionPoll).not.toHaveBeenCalled();
    const agentRun = bridge.invoke.mock.calls.find(([command]) => command === "agent_run");
    expect(agentRun?.[1]?.stdinText).toContain("Strict VPS remote-only mode");
    expect(bridge.invoke.mock.calls.some(([command]) => String(command).startsWith("nextctl_"))).toBe(false);
  });

  it("creates a distinct named VPS chat when local history already exists", async () => {
    const local = conversation("local", "local", [message("user", "user", "Local work")]);
    useStore.setState({ conversations: [local], activeConvId: { codex: local.id } });

    await useStore.getState().sendVPSPrompt(`${VPS_PROMPT_MARKER}\nUse the selected VPS.`, "prod-vps");

    const state = useStore.getState();
    const remote = state.conversations.find((candidate) => candidate.executionTarget === "vps");
    expect(remote?.id).not.toBe(local.id);
    expect(remote?.title).toBe("VPS · prod-vps");
    expect(remote?.vpsConnectionLabel).toBe("prod-vps");
    expect(state.activeConvId.codex).toBe(remote?.id);
    expect(state.runtime.codex.queue.at(-1)?.executionTarget).toBe("vps");
  });

  it("does not place a VPS turn behind already queued local work", async () => {
    const local = conversation("local", "local");
    useStore.setState({ conversations: [local], activeConvId: { codex: local.id } });
    useStore.getState().enqueue("Run this locally first");

    await expect(useStore.getState().sendVPSPrompt(
      `${VPS_PROMPT_MARKER}\nSSH command: ssh prod`,
      "prod-vps",
    )).rejects.toThrow("Finish or cancel queued local work");

    expect(useStore.getState().runtime.codex.queue).toHaveLength(1);
    expect(useStore.getState().runtime.codex.queue[0].executionTarget).toBe("local");
  });

  it("waits for an in-flight local session preflight before starting VPS work", async () => {
    let finishPreflight!: (value: { profileArgs: string[]; host?: string }) => void;
    preflight.prepareSession.mockImplementationOnce(() => new Promise((resolve) => {
      finishPreflight = resolve;
    }));
    const local = conversation("local", "local");
    useStore.setState({ conversations: [local], activeConvId: { codex: local.id } });

    const localRun = useStore.getState().runCustomScript(customScript());
    await vi.waitFor(() => expect(preflight.prepareSession).toHaveBeenCalledTimes(1));

    let vpsSettled = false;
    const vpsRun = useStore.getState().sendVPSPrompt(
      `${VPS_PROMPT_MARKER}\nSSH command: ssh prod`,
      "prod-vps",
    ).finally(() => { vpsSettled = true; });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(vpsSettled).toBe(false);
    expect(useStore.getState().runtime.codex.queue).toHaveLength(0);
    expect(useStore.getState().conversations.some((item) => item.executionTarget === "vps")).toBe(false);

    finishPreflight({ profileArgs: [], host: "example.com" });
    await localRun;
    const localReply = useStore.getState().runtime.codex.queue.at(-1);
    expect(localReply?.executionTarget).toBe("local");
    expect(useStore.getState().cancelQueuedReply(localReply!.replyId)).toBe(true);

    await vpsRun;
    expect(useStore.getState().runtime.codex.queue.at(-1)?.executionTarget).toBe("vps");
  });

  it("queues a VPS skill without applying it or preparing a local session", async () => {
    const remote = conversation("remote", "vps");
    const applySkill = vi.fn();
    useStore.setState({
      conversations: [remote],
      activeConvId: { codex: remote.id },
      applySkill,
    });

    await useStore.getState().useSkillInChat(skillEntry());

    expect(applySkill).not.toHaveBeenCalled();
    expect(preflight.prepareSession).not.toHaveBeenCalled();
    expect(localNextctlCalls()).toHaveLength(0);
    expect(useStore.getState().runtime.codex.queue.at(-1)).toMatchObject({
      conversationId: remote.id,
      executionTarget: "vps",
    });
  });

  it("queues a VPS JavaScript catalog entry without local evaluation or preflight", async () => {
    const remote = conversation("remote", "vps");
    useStore.setState({ conversations: [remote], activeConvId: { codex: remote.id } });

    await useStore.getState().runScript(skillEntry({ js: "document.title" }), "example.com");

    expect(preflight.prepareSession).not.toHaveBeenCalled();
    expect(localNextctlCalls()).toHaveLength(0);
    const queued = useStore.getState().runtime.codex.queue.at(-1);
    expect(queued).toMatchObject({ conversationId: remote.id, executionTarget: "vps" });
    expect(queued?.rawText).toContain("already-installed remote nextctl browser evaluation command");
  });

  it("queues a custom script for the VPS without preparing a local session", async () => {
    const remote = conversation("remote", "vps");
    useStore.setState({ conversations: [remote], activeConvId: { codex: remote.id } });

    await useStore.getState().runCustomScript(customScript());

    expect(preflight.prepareSession).not.toHaveBeenCalled();
    expect(localNextctlCalls()).toHaveLength(0);
    const queued = useStore.getState().runtime.codex.queue.at(-1);
    expect(queued).toMatchObject({ conversationId: remote.id, executionTarget: "vps" });
    expect(queued?.rawText).toContain("Extract the page title.");
  });

  it("does not update local nextctl while VPS work is queued", async () => {
    const remote = conversation("remote", "vps");
    useStore.setState({
      conversations: [remote],
      activeConvId: { codex: remote.id },
      nextctlAvailable: true,
    });
    useStore.getState().enqueue("Open example.com remotely");

    await expect(useStore.getState().checkNextctlUpdate()).resolves.toBe(false);

    expect(localNextctlCalls()).toHaveLength(0);
    expect(bridge.invoke).not.toHaveBeenCalledWith("nextctl_version");
  });

  it("blocks direct local nextctl actions and skill checks while VPS work is queued", async () => {
    const remote = conversation("remote", "vps");
    useStore.setState({
      conversations: [remote],
      activeConvId: { codex: remote.id },
      nextctlAvailable: true,
      nextctlSupportsSkill: true,
    });
    useStore.getState().enqueue("Continue remotely");

    await expect(useStore.getState().startDefaultSession()).rejects.toThrow(
      "Local nextctl operations are paused",
    );
    await expect(useStore.getState().applySkill(skillEntry())).rejects.toThrow(
      "Local skill checks are paused",
    );

    expect(localNextctlCalls()).toHaveLength(0);
  });

  it("skips local nextctl integration setup when authorization restores VPS work", async () => {
    const remote = conversation("remote", "vps");
    useStore.setState({
      conversations: [remote],
      activeConvId: { codex: remote.id },
      nextctlAvailable: true,
    });
    useStore.getState().enqueue("Continue on the VPS");
    useStore.setState((state) => ({
      runtime: {
        ...state.runtime,
        codex: { ...state.runtime.codex, ready: false, authorizing: false },
      },
    }));
    bridge.invoke.mockImplementation((command) => {
      if (command === "agent_authorize") return Promise.resolve("1.0.0");
      if (command === "agent_check_login") return Promise.resolve(true);
      return Promise.resolve(null);
    });

    await useStore.getState().authorizeAgent();

    expect(bridge.invoke).toHaveBeenCalledWith("agent_authorize", expect.any(Object));
    expect(localNextctlCalls()).toHaveLength(0);
  });

  it("rejects a VPS marker inserted into a queued local turn", () => {
    const local = conversation("local", "local");
    useStore.setState({ conversations: [local], activeConvId: { codex: local.id } });
    useStore.getState().enqueue("Keep this turn local");
    const queued = useStore.getState().runtime.codex.queue.at(-1);

    const edited = useStore.getState().editQueuedReply(
      queued!.replyId,
      `${VPS_PROMPT_MARKER}\nConnect somewhere else.`,
    );

    expect(edited).toBe(false);
    expect(useStore.getState().runtime.codex.queue.at(-1)).toMatchObject({
      rawText: "Keep this turn local",
      executionTarget: "local",
    });
    expect(useStore.getState().conversations[0].messages[0].text).toBe("Keep this turn local");
  });

  it("rejects a VPS marker submitted through the ordinary local enqueue path", () => {
    const local = conversation("local", "local");
    useStore.setState({ conversations: [local], activeConvId: { codex: local.id } });

    useStore.getState().enqueue(`${VPS_PROMPT_MARKER}\nUse an arbitrary VPS.`);

    expect(useStore.getState().runtime.codex.queue).toHaveLength(0);
    expect(useStore.getState().conversations[0]).toMatchObject({
      executionTarget: "local",
      messages: [],
    });
  });

  it("resets VPS target after the initial setup is edited and then cancelled", async () => {
    await useStore.getState().sendVPSPrompt(
      `${VPS_PROMPT_MARKER}\nSSH command: ssh prod\n\nUse the selected VPS.`,
      "prod-vps",
    );
    const queued = useStore.getState().runtime.codex.queue.at(-1);
    const before = useStore.getState().activeConversation();
    expect(before).toMatchObject({ executionTarget: "vps", title: "VPS · prod-vps" });
    expect(before?.vpsConnectionLabel).toBe("prod-vps");
    expect(before?.vpsConnectionInstructions).toContain("SSH command: ssh prod");

    expect(useStore.getState().editQueuedReply(queued!.replyId, "Use the existing VPS connection.")).toBe(true);

    const cancelled = useStore.getState().cancelQueuedReply(queued!.replyId);

    expect(cancelled).toBe(true);
    expect(useStore.getState().runtime.codex.queue).toHaveLength(0);
    expect(useStore.getState().activeConversation()).toMatchObject({
      title: "Chat",
      executionTarget: "local",
      messages: [],
    });
    expect(useStore.getState().activeConversation()?.vpsConnectionInstructions).toBeUndefined();
    expect(useStore.getState().activeConversation()?.vpsConnectionLabel).toBeUndefined();
  });
});
