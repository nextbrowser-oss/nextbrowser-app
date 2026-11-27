// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("./electronBridge", () => ({ invoke: vi.fn(async () => null), listen: vi.fn(async () => () => {}), filePathForFile: () => "" }));
vi.mock("./lib/analytics", () => ({ setAnalyticsUserId: vi.fn(), trackEvent: vi.fn(), trackScreenView: vi.fn(), trackTiming: vi.fn() }));
import { useStore } from "./store";
import { normalizeConversation, serializeConversations } from "./lib/persistence";
import { projectFolders } from "./lib/projectTree";
import type { Conversation } from "./types";

const project = (): Conversation => ({ id: "project", agent: "codex", title: "Research", workspaceId: "work", messages: [{ id: "original", role: "user", text: "Keep this history", status: "done", createdAt: 1 }], createdAt: 1, updatedAt: 1 });
beforeEach(() => {
  localStorage.clear();
  useStore.setState({ agentId: "codex", activeWorkspaceId: "work", conversations: [project()], activeConvId: { codex: "project" }, runtime: {}, tab: "chat" });
});
it("creates independent sessions while preserving the existing project history and persistence identity", () => {
  const id = useStore.getState().createProjectSession("project");
  const state = useStore.getState();
  const session = state.conversations.find(item => item.id === id)!;
  expect(session).toMatchObject({ projectId: "project", workspaceId: "work", agent: "codex", messages: [] });
  expect(state.conversations[0].messages[0].text).toBe("Keep this history");
  expect(state.activeConvId.codex).toBe(id);
  const restored = serializeConversations(state.conversations).map(item => normalizeConversation(item as unknown as Conversation));
  const folders = projectFolders(restored, "work");
  expect(folders).toHaveLength(1);
  expect(folders[0].sessions.map(item => item.id)).toEqual(["project", id]);
  const next = useStore.getState().newChat();
  expect(useStore.getState().conversations.find(item => item.id === next)?.projectId).toBe("project");
});
it("rejects missing/cross-workspace parents and keeps orphaned sessions accessible", () => {
  useStore.setState({ activeWorkspaceId: "other" });
  expect(useStore.getState().createProjectSession("project")).toBe("");
  expect(useStore.getState().createProjectSession("missing")).toBe("");
  const orphan = { ...project(), id: "orphan", projectId: "missing" };
  expect(projectFolders([orphan], "work")[0].project.id).toBe("orphan");
  expect(projectFolders([orphan], "other")).toHaveLength(0);
});
it("switches a project's API session without replacing CLI history and keeps new chats on that agent", () => {
  const id = useStore.getState().createProjectSession("project", "nextbrowser");
  expect(useStore.getState().agentId).toBe("nextbrowser");
  expect(useStore.getState().activeConvId.nextbrowser).toBe(id);
  expect(useStore.getState().conversations[0]).toEqual(project());
  expect(useStore.getState().conversations.find(item => item.id === id)).toMatchObject({ projectId: "project", agent: "nextbrowser", messages: [] });
  const next = useStore.getState().newChat();
  expect(useStore.getState().conversations.find(item => item.id === next)).toMatchObject({ projectId: "project", agent: "nextbrowser" });
  expect(useStore.getState().createProjectSession("project", "not-an-agent")).toBe("");
});
it("persists a moved session without switching the active chat or copying history", () => {
  useStore.setState(state => ({ conversations: [...state.conversations, { ...project(), id: "destination", title: "Destination", messages: [] }] }));
  const id = useStore.getState().createProjectSession("project");
  const messages = useStore.getState().conversations.find(item => item.id === id)!.messages;
  useStore.getState().moveProjectTreeItem({ dragId: `session:${id}`, targetId: "folder:destination", position: "inside" });
  expect(useStore.getState().activeConvId.codex).toBe(id);
  expect(useStore.getState().conversations.find(item => item.id === id)).toMatchObject({ projectId: "destination", messages });
  const before = useStore.getState().conversations;
  expect(() => useStore.getState().moveProjectTreeItem({ dragId: "session:project", targetId: "folder:destination", position: "inside" })).toThrow();
  expect(useStore.getState().conversations).toBe(before);
});
it("creates a local project folder without an active workspace", () => {
  useStore.setState({ authed: false, activeWorkspaceId: undefined, workspaces: [], conversations: [], activeConvId: {} });
  const id = useStore.getState().createProject("Local research", "chat", "codex");
  expect(id).not.toBe("");
  expect(projectFolders(useStore.getState().conversations, undefined).map(folder => folder.project.title)).toEqual(["Local research"]);
  expect(useStore.getState().activeConvId.codex).toBe(id);
});
