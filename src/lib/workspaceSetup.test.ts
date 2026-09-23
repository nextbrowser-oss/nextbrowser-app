import { describe, expect, it } from "vitest";
import { requiresWorkspaceSetup } from "./workspaceSetup";
import type { Conversation, Workspace } from "../types";

describe("workspace setup gate", () => {
  it("cannot be bypassed by stale local onboarding state", () => {
    expect(requiresWorkspaceSetup([], [])).toBe(true);
  });

  it("is dismissed once an account has a workspace", () => {
    const workspace = {
      id: "workspace-1",
      name: "Research",
      profileNames: ["browser"],
      profileToolsets: {},
      createdAt: 1,
      updatedAt: 1,
    } satisfies Workspace;
    const conversation = {
      id: "chat-1",
      title: "Research",
      agent: "codex",
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      workspaceId: workspace.id,
    } satisfies Conversation;
    expect(requiresWorkspaceSetup([workspace], [conversation], workspace.id)).toBe(false);
  });

  it("allows an intentionally empty workspace", () => {
    const workspace = {
      id: "workspace-1", name: "Research", profileNames: [], profileToolsets: {}, createdAt: 1, updatedAt: 1,
    } satisfies Workspace;
    expect(requiresWorkspaceSetup([workspace], [], workspace.id)).toBe(false);
  });

  it("does not recreate a deleted last profile", () => {
    const workspace = {
      id: "workspace-1", name: "Research", profileNames: [], profileToolsets: {}, createdAt: 1, updatedAt: 1,
    } satisfies Workspace;
    const conversation = {
      id: "chat-1", title: "Research", agent: "codex", messages: [], createdAt: 1, updatedAt: 1,
      workspaceId: workspace.id,
    } satisfies Conversation;
    expect(requiresWorkspaceSetup([workspace], [conversation], workspace.id)).toBe(false);
  });
});
