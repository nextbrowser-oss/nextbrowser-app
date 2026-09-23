import { beforeEach, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("./electronBridge", () => ({ ...bridge, filePathForFile: () => "" }));
vi.mock("./lib/analytics", () => ({ setAnalyticsUserId: vi.fn(), trackEvent: vi.fn(), trackScreenView: vi.fn(), trackTiming: vi.fn() }));
const workspace = { id: "w", name: "QA", profileNames: [], profileToolsets: {}, createdAt: 1, updatedAt: 1 };
const chat = { id: "c", title: "QA", workspaceId: "w", agent: "codex", messages: [], createdAt: 1, updatedAt: 1 };
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  bridge.invoke.mockReset();
  bridge.invoke.mockResolvedValue({ revision: 1 });
});
it("never adopts machine-wide profiles or unassigned chats into a new workspace", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ authed: true, profiles: [{ name: "other-account" }], workspaces: [], conversations: [{ ...chat, workspaceId: undefined }] });
  const id = await useStore.getState().createWorkspace("Empty");
  expect(useStore.getState().workspaces.find((w) => w.id === id)?.profileNames).toEqual([]);
  expect(useStore.getState().conversations[0].workspaceId).toBeUndefined();
});
it("retains the project and reports a failed server deletion", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ conversations: [chat] });
  bridge.invoke.mockRejectedValueOnce(new Error("offline"));
  await expect(useStore.getState().deleteConversation("c")).rejects.toThrow("offline");
  expect(useStore.getState().conversations).toEqual([chat]);
});
it("does not create a project when startup reconnects an agent in an empty workspace", async () => {
  const { useStore } = await import("./store");
  bridge.invoke.mockImplementation(async (command) => command === "agent_check_login" ? true : "dev");
  useStore.setState({ agentId: "codex", workspaces: [workspace], activeWorkspaceId: "w", conversations: [], activeConvId: {}, workspacesLoaded: true });
  await useStore.getState().authorizeAgent({ skipNextctlSetup: true });
  expect(useStore.getState().runtime.codex.error).toBeUndefined();
  expect(useStore.getState().runtime.codex.ready).toBe(true);
  expect(useStore.getState().conversations).toEqual([]);
});
it("does not resurrect a deleted project from an in-flight stale cloud list", async () => {
  const { useStore } = await import("./store");
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => { finish = resolve; });
  bridge.invoke.mockImplementation(async (command) => {
    if (command === "workspaces_list") return { workspaces: [] };
    if (command === "projects_list") return pending;
    return { revision: 1 };
  });
  useStore.setState({ authed: true, workspaces: [workspace], conversations: [chat] });
  const sync = useStore.getState().syncProjects();
  await vi.waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith("projects_list"));
  await useStore.getState().deleteConversation("c");
  finish({ projects: [{ id: "c", title: "QA", agent: "codex", workspace_id: "w", document: chat, revision: 1, updated_at: new Date().toISOString() }] });
  await sync;
  expect(useStore.getState().conversations).toEqual([]);
  expect(bridge.invoke.mock.calls.some(([command]) => command === "project_put")).toBe(false);
});
it("keeps messages received while a cloud list is pending", async () => {
  const { useStore } = await import("./store");
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => { finish = resolve; });
  bridge.invoke.mockImplementation(async (command) => command === "projects_list" ? pending : command === "workspaces_list" ? { workspaces: [] } : { revision: 1 });
  useStore.setState({ authed: true, workspaces: [workspace], conversations: [chat] });
  const sync = useStore.getState().syncProjects();
  await vi.waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith("projects_list"));
  const updated = { ...chat, title: "New message", updatedAt: Date.now(), messages: [{ id: "m", role: "user" as const, text: "Keep me", createdAt: Date.now(), status: "done" as const }] };
  useStore.setState({ conversations: [updated] });
  finish({ projects: [] });
  await sync;
  expect(useStore.getState().conversations[0].messages[0].text).toBe("Keep me");
});
