import { beforeEach, expect, it, vi } from "vitest";
import type { BuiltinAgentStatus } from "./lib/builtinAgent";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), prepareSession: vi.fn() }));
vi.mock("./electronBridge", () => ({ invoke: mocks.invoke, listen: mocks.listen, filePathForFile: () => "" }));
vi.mock("./preflight", () => ({ prepareSession: mocks.prepareSession, tidyEngineTabs: vi.fn() }));
vi.mock("./lib/analytics", () => ({ setAnalyticsUserId: vi.fn(), trackEvent: vi.fn(), trackScreenView: vi.fn(), trackTiming: vi.fn() }));

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

const READY: BuiltinAgentStatus = {
  settings: { provider: "nvidia", baseURL: "", model: "nvidia/llama-3.3-nemotron-super-49b-v1.5" },
  keys: { nvidia: true },
  secureStorage: true,
  configured: true,
  problem: "",
  providerName: "NVIDIA",
  model: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
};

let status: BuiltinAgentStatus = READY;
let agentRun: { code: number; stdout: string; stderr: string; reason?: string; failure?: { code: string; expected: boolean } };
let storage: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  storage = memoryStorage();
  vi.stubGlobal("localStorage", storage);
  status = READY;
  agentRun = { code: 0, stdout: "The title is Example Domain.", stderr: "" };
  mocks.invoke.mockReset();
  mocks.prepareSession.mockResolvedValue({ profileArgs: [] });
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "builtin_agent_status") return status;
    if (command === "agent_run") return agentRun;
    if (command === "nextctl_run") return { code: 0, stdout: JSON.stringify({ ok: true, data: { profiles: [] } }), stderr: "" };
    return null;
  });
});

async function setup() {
  const { useStore } = await import("./store");
  const state = useStore.getState();
  useStore.setState({
    agentId: "nextbrowser",
    activeWorkspaceId: "w",
    selectedProfile: "Work",
    workspaces: [{ id: "w", name: "QA", profileNames: ["Work"], profileToolsets: { Work: "camoufox" }, createdAt: 1, updatedAt: 1 }],
    conversations: [{ id: "c", title: "QA", agent: "nextbrowser", workspaceId: "w", messages: [], createdAt: 1, updatedAt: 1, executionTarget: "local" }],
    activeConvId: { nextbrowser: "c" },
    statuses: { Work: "running" },
    nextctlAvailable: true,
    runtime: { ...state.runtime, nextbrowser: { ...state.runtime.nextbrowser, ready: false, authorizing: false } },
    startSessionPoll: vi.fn(),
    refreshAll: vi.fn(async () => undefined),
  });
  return useStore;
}

it("connects the built-in agent from its saved setup, without a CLI or an nbc adapter", async () => {
  const useStore = await setup();
  await useStore.getState().authorizeAgent();
  const runtime = useStore.getState().runtime.nextbrowser;
  expect(runtime).toMatchObject({ ready: true, loggedIn: true, authorizing: false, version: "NVIDIA · nvidia/llama-3.3-nemotron-super-49b-v1.5" });
  expect(runtime.error).toBeUndefined();
  const commands = mocks.invoke.mock.calls.map(([command]) => command);
  expect(commands).toContain("builtin_agent_status");
  expect(commands).not.toContain("agent_authorize");
  expect(commands).not.toContain("agent_check_login");
  expect(mocks.invoke.mock.calls.some(([command, args]) => command === "nextctl_run" && (args as { args: string[] }).args[0] === "install")).toBe(false);
});

it("asks for the setup when no key or model is saved", async () => {
  status = { ...READY, keys: {}, configured: false, problem: "Add your NVIDIA API key." };
  const useStore = await setup();
  await useStore.getState().authorizeAgent();
  expect(useStore.getState().runtime.nextbrowser).toMatchObject({ ready: false, authorizing: false });
  expect(useStore.getState().agentError()).toBe("Set up the Nextbrowser agent in Settings → Agent. Add your NVIDIA API key.");
});

it("reads the setup again while ready, so a new model shows at once", async () => {
  const useStore = await setup();
  await useStore.getState().authorizeAgent();
  status = { ...READY, settings: { provider: "gemini", model: "gemini-2.5-flash" }, providerName: "Google Gemini", model: "gemini-2.5-flash", keys: { gemini: true } };
  await useStore.getState().refreshBuiltinAgent();
  expect(useStore.getState().agentVersion()).toBe("Google Gemini · gemini-2.5-flash");
});

it("sends a chat turn to the built-in agent with tool-only instructions", async () => {
  const useStore = await setup();
  await useStore.getState().authorizeAgent();
  useStore.setState({ startConsumer: vi.fn() });
  useStore.getState().enqueue("Open example.com and tell me the title");
  const item = useStore.getState().runtime.nextbrowser.queue.at(-1)!;
  await useStore.getState().processItem("nextbrowser", item);

  const run = mocks.invoke.mock.calls.find(([command]) => command === "agent_run")![1] as Record<string, unknown>;
  expect(run).toMatchObject({ agentId: "nextbrowser", args: [], binary: "", envVar: "", conversationId: "c", workspaceId: "w" });
  const prompt = String(run.stdinText);
  expect(prompt).toContain("Open example.com and tell me the title");
  expect(prompt).toContain("- Work: Camoufox");
  expect(prompt).toContain("camoufox for Camoufox");
  // Nothing a CLI agent needs: no shell, no curl, no host start commands.
  for (const cli of ["command -v nbc", "curl", "NEXTBROWSER_CONTROL_URL", "nbc profiles", "navigate_extract"]) expect(prompt).not.toContain(cli);
  expect(run.browserProfiles).toEqual([{ name: "Work", runtime: "camoufox", running: true, selected: true, ownerConversationId: undefined }]);
  const reply = useStore.getState().conversations[0].messages.find((message) => message.id === item.replyId);
  expect(reply).toMatchObject({ status: "done", text: "The title is Example Domain." });
});

it("shows a failure the user fixes in Settings without a reference, and an unexpected one with one", async () => {
  const useStore = await setup();
  await useStore.getState().authorizeAgent();
  useStore.setState({ startConsumer: vi.fn() });
  const run = async () => {
    useStore.getState().enqueue("Open example.com");
    const item = useStore.getState().runtime.nextbrowser.queue.at(-1)!;
    await useStore.getState().processItem("nextbrowser", item);
    return useStore.getState().conversations[0].messages.find((message) => message.id === item.replyId)!;
  };
  agentRun = { code: 1, stdout: "", stderr: "x", reason: "NVIDIA's free limit is reached. Wait a minute and try again, or switch to another provider in Settings → Agent.", failure: { code: "rate_limit", expected: true } };
  const limited = await run();
  expect(limited.status).toBe("failed");
  expect(limited.text).toBe(agentRun.reason);

  agentRun = { code: 1, stdout: "", stderr: "x", reason: "NVIDIA had a server error (HTTP 503). Try again in a minute.", failure: { code: "server", expected: false } };
  const broken = await run();
  expect(broken.status).toBe("failed");
  expect(broken.text).toMatch(/^NVIDIA had a server error \(HTTP 503\)\. Try again in a minute\. Ref: NB-[0-9A-F]{8}-[0-9A-F]{4}$/);
});

it("keeps built-in agent projects out of the terminal", async () => {
  const useStore = await setup();
  useStore.getState().setTerminalChat(true);
  expect(useStore.getState().terminalChat).toBe(false);
  const id = useStore.getState().createProject("Research", "terminal");
  expect(useStore.getState().conversations.find((conversation) => conversation.id === id)?.chatMode).toBe("chat");
  expect(useStore.getState().terminalChat).toBe(false);
});

it("never puts an API key in the window's storage or state", async () => {
  const useStore = await setup();
  await useStore.getState().authorizeAgent();
  const snapshot = JSON.stringify({ state: useStore.getState(), storage: [...storage.values] });
  expect(snapshot).not.toMatch(/nvapi-|apiKey|"key":/);
});
