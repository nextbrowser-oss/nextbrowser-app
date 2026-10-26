import { afterEach, beforeEach, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("./electronBridge", () => ({ ...bridge, filePathForFile: () => "" }));
vi.mock("./lib/analytics", () => ({ setAnalyticsUserId: vi.fn(), trackEvent: vi.fn(), trackScreenView: vi.fn(), trackTiming: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === "agent_authorize") return "1.0.0";
    if (command === "agent_check_login") return true;
    if (command === "nextctl_run") return { code: 0, stdout: "", stderr: "" };
    return undefined;
  });
});
afterEach(() => vi.unstubAllGlobals());

function installCalls() {
  return bridge.invoke.mock.calls.filter(([command, args]) => command === "nextctl_run" && (args as { args: string[] }).args[0] === "install");
}

it("installs the nbc integration of an agent nbc has an adapter for", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ agentId: "claude", conversations: [], nextctlAvailable: true });
  await useStore.getState().authorizeAgent();
  await vi.waitFor(() => expect(installCalls()).toHaveLength(1));
  expect(installCalls()[0][1]).toMatchObject({ args: ["install", "--agent", "claude-code", "--no-api-key-prompt"] });
});

it("does not ask nbc to install an integration it has no adapter for", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ agentId: "pi", conversations: [], nextctlAvailable: true });
  await useStore.getState().authorizeAgent();
  expect(useStore.getState().runtime.pi?.ready).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(installCalls()).toEqual([]);
});

it("asks an agent without an nbc adapter to install the runtime alone when nbc is missing", async () => {
  const { useStore } = await import("./store");
  const enqueue = vi.fn();
  useStore.setState({ agentId: "pi", conversations: [], nextctlAvailable: false, enqueue });
  await useStore.getState().authorizeAgent();
  expect(enqueue).toHaveBeenCalledTimes(1);
  const prompt = String(enqueue.mock.calls[0][0]);
  expect(prompt).toContain("install generic --agent-plugins-dir nbc-agent-plugins --no-api-key-prompt --json");
  expect(prompt).not.toContain("--agent pi");
  expect(prompt).not.toContain("this agent integration");
});

it("checks a skill only for agents nbc has an adapter for", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ agentId: "pi", conversations: [], nextctlSupportsSkill: true });
  bridge.invoke.mockImplementation(async (command: string) => command === "nextctl_run"
    ? { code: 0, stderr: "", stdout: JSON.stringify({ ok: true, data: { found: false } }) }
    : null);
  const entry = { id: "test-skill", title: "Test", subtitle: "example.com", selector: { kind: "domain" as const, value: "example.com" }, category: "browser", categoryTitle: "Browser", categoryIcon: "globe", categoryOrder: 1 };
  // Nothing published for the site: the skills view says so instead of an error.
  await expect(useStore.getState().applySkill(entry)).resolves.toBeUndefined();
  const adapters = bridge.invoke.mock.calls
    .filter(([command]) => command === "nextctl_run")
    .map(([, args]) => { const list = (args as { args: string[] }).args; return list[list.indexOf("--agent") + 1]; });
  expect(adapters.sort()).toEqual(["antigravity", "claude-code", "codex", "cursor", "gemini", "hermes", "openclaw", "opencode"]);
  expect(useStore.getState().skillApplyState("test-skill")).toBe("failed");
  expect(useStore.getState().skillApplyError("test-skill")).toBeUndefined();
});
