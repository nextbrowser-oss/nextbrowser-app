import { expect, it } from "vitest";
import { applyProjectDrop, canDropProject, projectFolders } from "./projectTree";
import { normalizeConversation, serializeConversations } from "./persistence";
import type { Conversation } from "../types";

const record = (id: string, projectId?: string, workspaceId = "work"): Conversation => ({ id, projectId, workspaceId, agent: "codex", title: id, createdAt: 1, updatedAt: 1, messages: [{ id: `${id}-message`, role: "user", status: "done", createdAt: 1, text: "Keep history" }] });
const records = () => [record("one"), record("two"), record("a", "one"), record("b", "one"), record("c", "two"), record("other", undefined, "private")];
it("moves a session between projects without changing its ID, agent, workspace or history, surviving persistence", () => {
  const input = records(), original = input[2];
  const moved = applyProjectDrop(input, "work", { dragId: "session:a", targetId: "folder:two", position: "inside" }, 100);
  const session = moved.find(item => item.id === "a")!;
  expect(session.projectId).toBe("two");
  expect(session.messages).toBe(original.messages);
  expect(session.agent).toBe(original.agent);
  expect(session.workspaceId).toBe("work");
  expect(input[2].projectId).toBe("one");
  const restored = serializeConversations(moved).map(item => normalizeConversation(item as unknown as Conversation));
  expect(projectFolders(restored, "work").find(folder => folder.project.id === "two")!.sessions.map(item => item.id)).toEqual(["two", "c", "a"]);
});
it("persists explicit folder order and session order", () => {
  let moved = applyProjectDrop(records(), "work", { dragId: "folder:two", targetId: "folder:one", position: "before" });
  expect(projectFolders(moved, "work").map(folder => folder.project.id)).toEqual(["two", "one"]);
  moved = applyProjectDrop(moved, "work", { dragId: "session:b", targetId: "session:a", position: "before" });
  expect(projectFolders(moved, "work").find(folder => folder.project.id === "one")!.sessions.map(item => item.id)).toEqual(["one", "b", "a"]);
});
it("rejects main-session moves, cross-workspace targets, nesting projects and dropping into a leaf", () => {
  for (const event of [
    { dragId: "session:one", targetId: "folder:two", position: "inside" },
    { dragId: "session:a", targetId: "folder:other", position: "inside" },
    { dragId: "folder:one", targetId: "folder:two", position: "inside" },
    { dragId: "session:a", targetId: "session:c", position: "inside" },
    { dragId: "session:a", targetId: "session:two", position: "before" },
  ] as const) {
    expect(canDropProject(records(), "work", event)).toBe(false);
    expect(() => applyProjectDrop(records(), "work", event)).toThrow();
  }
});
