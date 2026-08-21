import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWorkflowSkill, ChatMessage, Conversation, CustomScript } from "./types";
import type { SkillEntry } from "./skillsCatalog";
import { VPS_PROMPT_MARKER } from "./lib/vpsPrompt";
import { setMultiloginSelection } from "./lib/multiloginSelection";

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

function workflowSkill(): BrowserWorkflowSkill {
  return {
    id: "workflow",
    title: "Collect products",
    domain: "example.com",
    task: "Collect product cards",
    instructions: "Use only for explicit AI repair.",
    actions: [{ tool: "extract", arguments: { selector: ".product", fields: { title: ".name" } } }],
    capability: "scrape",
    parametersSchema: {},
    outputSchema: {},
    recipe: { version: 1, capability: "scrape", actions: [] },
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
  localStorage.clear();
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

describe("deterministic automation replay", () => {
  it("runs without an authenticated agent and preserves profile runtime selection", async () => {
    useStore.setState({
      selectedProfile: "camou-profile",
      workspaces: [{
        id: "workspace",
        name: "Camoufox",
        profileNames: ["camou-profile"],
        profileToolsets: { "camou-profile": "camoufox" },
        createdAt: 1,
        updatedAt: 1,
      }],
      runtime: {
        ...useStore.getState().runtime,
        codex: { ...useStore.getState().runtime.codex, ready: false },
      },
    });
    preflight.prepareSession.mockResolvedValueOnce({
      profileArgs: ["--profile", "camou-profile", "--runtime", "camoufox"],
      host: "example.com",
      steps: [],
    });
    bridge.invoke.mockResolvedValueOnce({ status: "completed", results: [] });

    await expect(useStore.getState().runAutomationRecipe(
      workflowSkill(),
      "execution",
      { backendRunId: "backend-run", query: "laptop" },
    )).resolves.toMatchObject({ status: "completed" });

    expect(preflight.prepareSession).toHaveBeenCalledWith(expect.objectContaining({
      host: "example.com",
      selectedProfile: "camou-profile",
      runtime: "camoufox",
    }));
    expect(bridge.invoke).toHaveBeenCalledWith("automation_recipe_execute", expect.objectContaining({
      executionId: "execution",
      profile: "camou-profile",
      runtime: "camoufox",
      backendRunId: "backend-run",
      parameters: { task: "Collect product cards", query: "laptop" },
    }));
  });
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

  it("finishes a reply from the agent process result when the done event is missed", async () => {
    const remote = conversation("remote", "vps", [
      message("user", "user", "Start the selected cloud phone"),
      { ...message("reply", "assistant", ""), status: "queued" },
    ]);
    useStore.setState({ conversations: [remote], activeConvId: { codex: remote.id } });
    bridge.invoke.mockImplementation((command) => command === "agent_run"
      ? Promise.resolve({ code: 0, stdout: "Cloud phone start requested.", stderr: "" })
      : Promise.resolve(null));

    await useStore.getState().processItem("codex", {
      conversationId: remote.id,
      rawText: "Start the selected cloud phone",
      replyId: "reply",
      executionTarget: "vps",
    });

    const reply = useStore.getState().conversations[0].messages[1];
    expect(reply).toMatchObject({ status: "done", text: "Cloud phone start requested.", stalled: false });
    expect(useStore.getState().conversations[0].updatedAt).toBeGreaterThan(1);
    expect(useStore.getState().runtime.codex.runningReplyId).toBeUndefined();
  });

  it("starts a selected Multilogin cloud phone directly without waiting for Codex", async () => {
    const local = {
      ...conversation("local", "local", [
        message("user", "user", "запусти профиль мультилогина выбранный"),
        { ...message("reply", "assistant", ""), status: "queued" as const },
      ]),
      workspaceId: "work",
    };
    setMultiloginSelection("work", {
      kind: "mobile",
      id: "phone-1",
      name: "Test phone",
      folderId: "folder-1",
    });
    useStore.setState({ conversations: [local], activeConvId: { codex: local.id } });
    bridge.invoke.mockImplementation((command) => {
      if (command === "nextctl_run") {
        return Promise.resolve({
          code: 0,
          stdout: JSON.stringify({ ok: true, data: { status_name: "starting" } }),
          stderr: "",
        });
      }
      return Promise.resolve(null);
    });

    await useStore.getState().processItem("codex", {
      conversationId: local.id,
      rawText: "запусти профиль мультилогина выбранный",
      replyId: "reply",
      executionTarget: "local",
    });

    expect(bridge.invoke.mock.calls.some(([command]) => command === "agent_run")).toBe(false);
    expect(bridge.invoke).toHaveBeenCalledWith("nextctl_run", expect.objectContaining({
      args: [
        "--runtime", "multilogin", "mobile", "start", "phone-1", "--no-wait",
        "--multilogin-folder-id", "folder-1", "--format", "json",
      ],
    }));
    expect(useStore.getState().conversations[0].messages[1]).toMatchObject({
      status: "done",
      text: "Запуск cloud phone «Test phone» отправлен.",
    });
    expect(useStore.getState().conversations[0].updatedAt).toBeGreaterThan(1);
    expect(useStore.getState().tab).toBe("live");
  });

  it("starts a selected Multilogin browser directly and opens Live View", async () => {
    const local = {
      ...conversation("local", "local", [
        message("user", "user", "запусти выбранный профиль мультилогина"),
        { ...message("reply", "assistant", ""), status: "queued" as const },
      ]),
      workspaceId: "work",
    };
    setMultiloginSelection("work", {
      kind: "browser",
      id: "browser-1",
      name: "Work browser",
      folderId: "folder-1",
    });
    useStore.setState({ conversations: [local], activeConvId: { codex: local.id } });
    bridge.invoke.mockImplementation((command) => {
      if (command === "nextctl_run") {
        return Promise.resolve({
          code: 0,
          stdout: JSON.stringify({ ok: true, data: { session: { name: "mlx-browser-browser-1" } } }),
          stderr: "",
        });
      }
      return Promise.resolve(null);
    });

    await useStore.getState().processItem("codex", {
      conversationId: local.id,
      rawText: "запусти выбранный профиль мультилогина",
      replyId: "reply",
      executionTarget: "local",
    });

    expect(bridge.invoke.mock.calls.some(([command]) => command === "agent_run")).toBe(false);
    expect(bridge.invoke).toHaveBeenCalledWith("nextctl_run", expect.objectContaining({
      args: [
        "--runtime", "multilogin",
        "--profile", "mlx-browser-browser-1",
        "--multilogin-profile-id", "browser-1",
        "start", "--multilogin-folder-id", "folder-1", "--format", "json",
      ],
    }));
    expect(useStore.getState().conversations[0].messages[1]).toMatchObject({
      status: "done",
      text: "Браузерный профиль Multilogin «Work browser» запущен. Открываю Live View.",
    });
    expect(useStore.getState().tab).toBe("live");
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

  it("keeps missing Codex app failures actionable", async () => {
    useStore.setState((state) => ({
      runtime: {
        ...state.runtime,
        codex: { ...state.runtime.codex, ready: false, authorizing: false, error: undefined },
      },
    }));
    bridge.invoke.mockRejectedValueOnce(
      new Error("Error invoking remote method 'nextbrowser:invoke': Error: codex executable not found."),
    );

    await useStore.getState().authorizeAgent();

    expect(useStore.getState().agentError()).toBe(
      "ChatGPT desktop app with Codex not found. NextBrowser connects through the executable bundled with the app. Install it, then try again.",
    );
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

describe("browser profile creation", () => {
  it("creates a direct profile without assigning a proxy country", async () => {
    bridge.invoke.mockResolvedValue({
      stdout: JSON.stringify({ ok: true, data: { profiles: [] } }),
      stderr: "",
      code: 0,
    });

    await useStore.getState().createManagedProfile("direct-test", "", { direct: true });

    expect(bridge.invoke).toHaveBeenCalledWith("nextctl_run", expect.objectContaining({
      args: ["profiles", "create", "direct-test", "--no-proxy", "--runtime", "clawbrowser", "--format", "json"],
    }));
  });

  it("passes authenticated custom-proxy passwords through nextctl's private environment variable", async () => {
    bridge.invoke.mockResolvedValue({
      stdout: JSON.stringify({ ok: true, data: { profiles: [] } }),
      stderr: "",
      code: 0,
    });

    await useStore.getState().createManualProxyProfile({
      name: "custom-test",
      scheme: "http",
      host: "127.0.0.1",
      port: 3128,
      username: "tester",
      password: "secret-pass",
    });

    expect(bridge.invoke).toHaveBeenCalledWith("nextctl_run", expect.objectContaining({
      args: [
        "profiles", "create", "custom-test", "--manual-proxy", "--proxy-scheme", "http",
        "--proxy-host", "127.0.0.1", "--proxy-port", "3128", "--proxy-username", "tester", "--format", "json",
      ],
      extraEnv: { NBC_PROXY_PASSWORD: "secret-pass" },
    }));
  });

  it("creates a profile from a saved proxy without exposing credentials to the renderer", async () => {
    bridge.invoke.mockImplementation((command) => Promise.resolve(command === "manual_proxy_profile_create"
      ? { stdout: JSON.stringify({ ok: true, data: {} }), stderr: "", code: 0 }
      : { stdout: JSON.stringify({ ok: true, data: { profiles: [] } }), stderr: "", code: 0 }));

    await useStore.getState().createPersonalProxyProfile("saved-proxy-test", "proxy-id", {
      runtime: "camoufox",
      requestId: "create-request",
      timeoutMs: 90_000,
    });

    expect(bridge.invoke).toHaveBeenCalledWith("manual_proxy_profile_create", {
      profileName: "saved-proxy-test",
      proxyId: "proxy-id",
      runtime: "camoufox",
      requestId: "create-request",
      timeoutMs: 90_000,
    });
    expect(JSON.stringify(bridge.invoke.mock.calls)).not.toContain("NBC_PROXY_PASSWORD");
  });

  it("rejects a failed saved-proxy profile creation without selecting the profile", async () => {
    bridge.invoke.mockResolvedValue({
      stdout: JSON.stringify({ ok: false, error: { code: "PROXY_CONNECTION_FAILED", message: "Proxy refused the connection." } }),
      stderr: "",
      code: 1,
    });

    await expect(useStore.getState().createPersonalProxyProfile("broken-proxy", "proxy-id"))
      .rejects.toThrow("Proxy refused the connection.");
    expect(useStore.getState().selectedProfile).not.toBe("broken-proxy");
  });

  it("persists the personal proxy association in the workspace document", () => {
    useStore.setState({
      activeWorkspaceId: "workspace",
      workspaces: [{
        id: "workspace",
        name: "Workspace",
        profileNames: [],
        profileToolsets: {},
        profileProxyIds: {},
        createdAt: 1,
        updatedAt: 1,
      }],
    });

    useStore.getState().assignProfileToProject("saved-proxy-test", "camoufox", undefined, true, "proxy-id");

    expect(useStore.getState().workspaces[0]).toMatchObject({
      profileNames: ["saved-proxy-test"],
      profileToolsets: { "saved-proxy-test": "camoufox" },
      profileProxyIds: { "saved-proxy-test": "proxy-id" },
    });
  });
});

describe("Live View runtime selection", () => {
  it("keeps the existing Clawbrowser remote timeout", async () => {
    bridge.invoke.mockResolvedValue({
      stdout: JSON.stringify({ viewer_url: "https://example.test/clawbrowser" }),
      stderr: "",
      code: 0,
    });

    await useStore.getState().startRemoteStream({ runtime: "clawbrowser", profile: "work" });

    expect(bridge.invoke).toHaveBeenCalledWith("nextctl_run", {
      args: ["remote", "--profile", "work", "--include-viewer-url", "--format", "json"],
      extraEnv: null,
      requestId: undefined,
      timeoutMs: 60_000,
    });
  });

  it("allows a Multilogin cloud phone enough time to start and connect ADB", async () => {
    bridge.invoke.mockResolvedValue({
      stdout: JSON.stringify({ viewer_url: "https://example.test/mobile" }),
      stderr: "",
      code: 0,
    });

    await useStore.getState().startRemoteStream({
      runtime: "multilogin",
      selection: { kind: "mobile", id: "phone-1", name: "Phone", folderId: "folder-1" },
    });

    expect(bridge.invoke).toHaveBeenCalledWith("nextctl_run", {
      args: [
        "--runtime", "multilogin", "--multilogin-folder-id", "folder-1",
        "mobile", "remote", "phone-1", "--include-viewer-url", "--format", "json",
      ],
      extraEnv: null,
      requestId: undefined,
      timeoutMs: 3 * 60_000,
    });
  });
});

describe("local component and profile lifecycle", () => {
  it("stops a persisted streaming reply when no agent process owns it", () => {
    const stale = conversation("stale", "local", [
      message("user", "user", "Hello"),
      { ...message("reply", "assistant", ""), status: "streaming", runStartedAt: Date.now() - 60 * 60 * 1000 },
    ]);
    const previousUpdatedAt = stale.updatedAt;
    useStore.setState({ conversations: [stale], activeConvId: { codex: stale.id } });

    useStore.getState().reconcileQueues();

    const restored = useStore.getState().conversations[0];
    expect(restored.messages[1]).toMatchObject({ status: "cancelled", text: "[stopped]", stalled: false });
    expect(restored.updatedAt).toBeGreaterThan(previousUpdatedAt);
  });

  it("retries a failed nextctl update twice at five-minute intervals", async () => {
    vi.useFakeTimers();
    try {
      useStore.setState({ nextctlAvailable: true });
      bridge.invoke.mockImplementation((command) => {
        if (command === "nextctl_run") return Promise.resolve({ code: 1, stdout: "", stderr: "offline" });
        return Promise.resolve(null);
      });

      await expect(useStore.getState().checkNextctlUpdate()).resolves.toBe(false);
      expect(localNextctlCalls()).toHaveLength(1);
      expect(useStore.getState().nextctlUpdateStatus).toBe("We couldn't update NextBrowser. Please retry again.");

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(localNextctlCalls()).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(localNextctlCalls()).toHaveLength(3);
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(localNextctlCalls()).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores a profile status when launching it fails", async () => {
    useStore.setState({ statuses: { work: "stopped" } });
    bridge.invoke.mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "browser runtime could not start",
    });

    await expect(useStore.getState().startProfile("work")).rejects.toThrow("browser runtime could not start");

    expect(useStore.getState().statuses.work).toBe("stopped");
  });
});

describe("deferred chat context", () => {
  it("shows only the new message while sending the expanded prompt to the agent", () => {
    const local = conversation("local", "local");
    useStore.setState({ conversations: [local], activeConvId: { codex: local.id } });

    useStore.getState().enqueue(
      "Did pagination finish?",
      undefined,
      undefined,
      [],
      "Recent terminal context\n\nNew user message:\nDid pagination finish?",
    );

    const state = useStore.getState();
    expect(state.conversations[0].messages[0].text).toBe("Did pagination finish?");
    expect(state.runtime.codex.queue[0].rawText).toContain("Recent terminal context");
    expect(state.runtime.codex.queue[0].rawText).toContain("Did pagination finish?");
  });
});
