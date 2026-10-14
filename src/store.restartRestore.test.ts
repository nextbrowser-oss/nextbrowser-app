import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// QA "COMMON": shut the app down, open it again, and the user's setup must
// still be there. Each test runs the store twice against the same disk and
// localStorage, the way a restart does.

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("./electronBridge", () => ({ invoke: bridge.invoke, listen: bridge.listen, filePathForFile: () => "" }));
vi.mock("./lib/analytics", () => ({ setAnalyticsUserId: vi.fn(), trackEvent: vi.fn(), trackScreenView: vi.fn(), trackTiming: vi.fn() }));

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

function jsonResult(data: unknown) {
  return { stdout: JSON.stringify({ ok: true, data }), stderr: "", code: 0 };
}

const workspace = (id: string, profileNames: string[]) => ({
  id, name: id, profileNames, profileToolsets: {}, profileProxyIds: {}, createdAt: 1, updatedAt: 1,
});
const project = (id: string, workspaceId: string, chatMode: "chat" | "terminal", updatedAt = 1) => ({
  id, title: id, agent: "claude", messages: [], createdAt: updatedAt, updatedAt, chatMode, workspaceId,
});

let appData: Record<string, string>;

function mockDesktop(ownerId = "owner-1") {
  bridge.listen.mockResolvedValue(() => {});
  bridge.invoke.mockImplementation(async (command: string, payload?: { args?: string[]; name?: string; content?: string }) => {
    switch (command) {
      case "app_data_read": return appData[payload?.name ?? ""] ?? null;
      case "app_data_write": appData[payload?.name ?? ""] = payload?.content ?? ""; return undefined;
      case "working_directory": return "";
      case "nextctl_resolve": return "/tmp/nextctl";
      case "nextctl_version": return "nextctl 1.0.0";
      case "nextctl_supports_skill": return true;
      case "agent_authorize": throw new Error("agent unavailable in test");
      case "nextctl_run": {
        const args = payload?.args ?? [];
        if (args[0] === "identity") {
          return jsonResult({ identity: { valid: true, key_id: "key-1", owner_id: ownerId, email: "person@example.com" } });
        }
        if (args[0] === "proxy-traffic") return jsonResult({ proxy_traffic: { limited: false, used_bytes: 0, state: "ok" } });
        if (args[0] === "profiles") return jsonResult({ profiles: [] });
        if (args[0] === "status") return jsonResult({ status: "stopped" });
        if (args[0] === "skill") return jsonResult({ categories: [] });
        return { stdout: "", stderr: "", code: 0 };
      }
      default: throw new Error(`Unexpected bridge command: ${command}`);
    }
  });
}

/** A fresh renderer over the same app data and localStorage. */
async function launch() {
  vi.resetModules();
  const { useStore } = await import("./store");
  useStore.setState({ syncProjects: vi.fn().mockResolvedValue(undefined), refreshAll: vi.fn().mockResolvedValue(undefined) });
  await useStore.getState().bootstrap();
  return useStore;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", memoryStorage());
  bridge.invoke.mockReset();
  bridge.listen.mockReset();
  appData = {
    "workspaces.json": JSON.stringify([workspace("work", ["US shop", "DE shop"]), workspace("personal", ["Home"])]),
    "conversations.json": JSON.stringify([project("work-chat", "work", "chat"), project("personal-terminal", "personal", "terminal")]),
  };
  localStorage.setItem("cachedAccountOwnerId", "owner-1");
  mockDesktop();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("restart keeps the selected browser profile", () => {
  it("reopens the active workspace with the profile picked before shutdown", async () => {
    const first = await launch();
    first.getState().selectWorkspace("work");
    first.getState().selectProfile("DE shop");

    const second = await launch();

    expect(second.getState().activeWorkspaceId).toBe("work");
    expect(second.getState().selectedProfile).toBe("DE shop");
  });

  it("keeps a separate selection per workspace across switches and restarts", async () => {
    const first = await launch();
    first.getState().selectWorkspace("work");
    first.getState().selectProfile("US shop");
    first.getState().selectWorkspace("personal");
    expect(first.getState().selectedProfile).toBeUndefined();
    first.getState().selectProfile("Home");
    first.getState().selectWorkspace("work");
    expect(first.getState().selectedProfile).toBe("US shop");
    first.getState().selectWorkspace("personal");

    const second = await launch();
    expect(second.getState().selectedProfile).toBe("Home");
    second.getState().selectWorkspace("work");
    expect(second.getState().selectedProfile).toBe("US shop");
  });

  it("keeps the agent default when the user cleared the profile", async () => {
    const first = await launch();
    first.getState().selectWorkspace("work");
    first.getState().selectProfile("US shop");
    first.getState().selectProfile(undefined);

    const second = await launch();

    expect(second.getState().selectedProfile).toBeUndefined();
  });

  it("does not restore a profile the workspace no longer has", async () => {
    const first = await launch();
    first.getState().selectWorkspace("work");
    first.getState().selectProfile("DE shop");
    appData["workspaces.json"] = JSON.stringify([workspace("work", ["US shop"]), workspace("personal", ["Home"])]);

    const second = await launch();

    expect(second.getState().selectedProfile).toBeUndefined();
  });

  it("drops the restored profile when cloud sync removed it from the workspace", async () => {
    const first = await launch();
    first.getState().selectWorkspace("work");
    first.getState().selectProfile("DE shop");
    const second = await launch();
    expect(second.getState().selectedProfile).toBe("DE shop");

    const later = new Date(Date.now() + 60_000).toISOString();
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === "workspaces_list") return { workspaces: [
        { id: "work", name: "work", revision: 2, created_at: later, updated_at: later, document: { profileNames: ["US shop"], profileToolsets: {}, profileProxyIds: {} } },
        { id: "personal", name: "personal", revision: 2, created_at: later, updated_at: later, document: { profileNames: ["Home"], profileToolsets: {}, profileProxyIds: {} } },
      ] };
      if (command === "projects_list") return { projects: [] };
      if (command === "app_data_write") return undefined;
      return { revision: 3 };
    });
    vi.resetModules();
    const { useStore } = await import("./store");
    useStore.setState({
      authed: true,
      projectsSyncing: false,
      workspaces: second.getState().workspaces,
      conversations: [],
      activeWorkspaceId: "work",
      selectedProfile: "DE shop",
      workspaceRevisions: { work: 1, personal: 1 },
    });

    await useStore.getState().syncProjects();

    expect(useStore.getState().selectedProfile).toBeUndefined();
  });

  it("forgets the remembered profiles when another account signs in", async () => {
    const first = await launch();
    first.getState().selectWorkspace("work");
    first.getState().selectProfile("DE shop");
    mockDesktop("owner-2");

    await first.getState().login("owner-2-key");

    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index) ?? "");
    expect(first.getState().selectedProfile).toBeUndefined();
    expect(keys.filter((key) => key.startsWith("nextbrowser.selectedProfile."))).toEqual([]);
  });
});

describe("restart reopens the project in its own mode", () => {
  it("opens a chat project as chat even if a terminal project was last toggled elsewhere", async () => {
    localStorage.setItem("activeWorkspaceId", "work");
    localStorage.setItem("terminalChat", "true");

    const store = await launch();

    expect(store.getState().activeConversation()?.id).toBe("work-chat");
    expect(store.getState().terminalChat).toBe(false);
  });

  it("opens a terminal project as terminal even if the global flag says chat", async () => {
    localStorage.setItem("activeWorkspaceId", "personal");
    localStorage.setItem("terminalChat", "false");

    const store = await launch();

    expect(store.getState().activeConversation()?.id).toBe("personal-terminal");
    expect(store.getState().terminalChat).toBe(true);
  });

  it("keeps the agent, workspace and project picked before shutdown", async () => {
    appData["conversations.json"] = JSON.stringify([
      project("work-chat", "work", "chat", 5),
      project("work-terminal", "work", "terminal", 1),
      project("personal-terminal", "personal", "terminal"),
    ]);
    const first = await launch();
    first.getState().selectConversation("work-terminal");

    const second = await launch();

    expect(second.getState()).toMatchObject({ agentId: "claude", activeWorkspaceId: "work", terminalChat: true });
    expect(second.getState().activeConversation()?.id).toBe("work-terminal");
  });
});
