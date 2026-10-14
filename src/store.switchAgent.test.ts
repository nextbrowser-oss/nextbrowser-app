import { afterEach, beforeEach, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("./electronBridge", () => ({ ...bridge, filePathForFile: () => "" }));
vi.mock("./lib/analytics", () => ({ setAnalyticsUserId: vi.fn(), trackEvent: vi.fn(), trackScreenView: vi.fn(), trackTiming: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === "agent_authorize") return "codex-cli 0.162.1";
    if (command === "agent_check_login") return true;
    return undefined;
  });
});
afterEach(() => vi.unstubAllGlobals());

const emptyWorkspace = { id: "w", name: "New", profileNames: [], profileToolsets: {}, createdAt: 1, updatedAt: 1 };

it("does not create a project when switching agents in a workspace without one", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ agentId: "claude", workspaces: [emptyWorkspace], activeWorkspaceId: "w", conversations: [], nextctlAvailable: false });
  useStore.getState().switchAgent("codex");
  expect(useStore.getState().agentId).toBe("codex");
  expect(useStore.getState().conversations).toEqual([]);
});

it("connects the newly selected agent instead of leaving it offline", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ agentId: "claude", workspaces: [emptyWorkspace], activeWorkspaceId: "w", conversations: [], nextctlAvailable: false });
  useStore.getState().switchAgent("codex");
  await vi.waitFor(() => expect(useStore.getState().runtime.codex?.ready).toBe(true));
  expect(bridge.invoke).toHaveBeenCalledWith("agent_authorize", expect.objectContaining({ binary: "codex" }));
  expect(useStore.getState().conversations).toEqual([]);
});
