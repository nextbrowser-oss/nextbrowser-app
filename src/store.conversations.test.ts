import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "./types";

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("./electronBridge", () => ({
  invoke: bridge.invoke,
  listen: bridge.listen,
  filePathForFile: () => "",
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

function conversation(id: string, agent: string, updatedAt: number): Conversation {
  return {
    id,
    title: id,
    agent,
    messages: [],
    createdAt: 1,
    updatedAt,
    executionTarget: "local",
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", memoryStorage());
  bridge.invoke.mockReset();
  bridge.listen.mockReset();
  bridge.invoke.mockResolvedValue(null);
});

describe("conversation deletion", () => {
  it("removes the chat, selects the next chat, and persists the new list", async () => {
    const { useStore } = await import("./store");
    const deleted = conversation("delete-me", "codex", 3);
    const fallback = conversation("keep-me", "codex", 2);
    const otherAgent = conversation("claude-chat", "claude", 1);
    useStore.setState({
      agentId: "codex",
      conversations: [otherAgent, fallback, deleted],
      activeConvId: { codex: deleted.id, claude: otherAgent.id },
    });

    useStore.getState().deleteConversation(deleted.id);

    expect(useStore.getState().conversations.map((item) => item.id)).toEqual([
      otherAgent.id,
      fallback.id,
    ]);
    expect(useStore.getState().activeConvId).toEqual({
      codex: fallback.id,
      claude: otherAgent.id,
    });

    await vi.waitFor(() => {
      const write = bridge.invoke.mock.calls.find(([command]) => command === "app_data_write");
      expect(write).toBeDefined();
      const persisted = JSON.parse(String(write?.[1]?.content)) as Conversation[];
      expect(persisted.map((item) => item.id)).toEqual([otherAgent.id, fallback.id]);
    });
  });
});
