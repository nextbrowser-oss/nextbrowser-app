import { afterEach, beforeEach, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("./electronBridge", () => ({ ...bridge, filePathForFile: () => "" }));
vi.mock("./lib/analytics", () => ({ setAnalyticsUserId: vi.fn(), trackEvent: vi.fn(), trackScreenView: vi.fn(), trackTiming: vi.fn() }));

const storage = new Map<string, string>();
let inventory: string[] = [];
let cloudDoc: { profileNames: string[] } = { profileNames: [] };

beforeEach(() => {
  vi.resetModules();
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(async (command: string, args: any) => {
    if (command === "nextctl_run") {
      const data = args.args[0] === "profiles" ? { profiles: inventory.map((name) => ({ name })) } : { status: "stopped" };
      return { code: 0, stderr: "", stdout: JSON.stringify({ ok: true, data }) };
    }
    if (command === "workspaces_list") {
      return { workspaces: [{ id: "w", name: "Work", revision: 1, created_at: new Date(1).toISOString(), updated_at: new Date(1).toISOString(), document: cloudDoc }] };
    }
    if (command === "workspace_put") { cloudDoc = args.workspace.document; return { revision: 2 }; }
    if (command === "projects_list") return { projects: [] };
    return { revision: 1 };
  });
});
afterEach(() => vi.unstubAllGlobals());

it("removes a profile an agent deleted, but keeps one that lives on another device", async () => {
  const { useStore } = await import("./store");
  cloudDoc = { profileNames: ["mine", "other-device"] };
  useStore.setState({
    authed: true, accountOwnerId: "owner", projectsSyncing: false, conversations: [],
    workspaces: [{ id: "w", name: "Work", profileNames: ["mine", "other-device"], profileToolsets: {}, createdAt: 1, updatedAt: 1 }],
    workspaceRevisions: { w: 1 },
  } as any);
  inventory = ["mine"];
  await useStore.getState().loadProfiles();
  // The agent deletes "mine" through nextctl.
  inventory = [];
  await useStore.getState().loadProfiles();
  await vi.waitFor(() => {
    expect(useStore.getState().workspaces[0].profileNames).toEqual(["other-device"]);
    expect(cloudDoc.profileNames).toEqual(["other-device"]);
  });
});
