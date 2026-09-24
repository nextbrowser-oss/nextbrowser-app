import { beforeEach, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("./electronBridge", () => ({ ...bridge, filePathForFile: () => "" }));
vi.mock("./lib/analytics", () => ({ setAnalyticsUserId: vi.fn(), trackEvent: vi.fn(), trackScreenView: vi.fn(), trackTiming: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  bridge.invoke.mockReset();
  bridge.invoke.mockResolvedValue({ revision: 1 });
});

function freshAccount() {
  return {
    authed: true,
    nextctlAvailable: true,
    workspaces: [] as never[],
    conversations: [] as never[],
    activeWorkspaceId: undefined,
    workspaceSetupRequired: true,
    workspaceSetupAuto: "pending" as const,
  };
}

it("creates a default workspace, project, and one profile per toolset without a modal", async () => {
  const { useStore } = await import("./store");
  const projects = new Map<string, unknown>();
  bridge.invoke.mockImplementation((command: string, args) => {
    if (command === "project_put") {
      projects.set(args.id, { id: args.id, ...args.project, revision: 1, updated_at: new Date().toISOString() });
      return Promise.resolve({ revision: 1 });
    }
    if (command === "nextctl_run") {
      return Promise.resolve({ code: 0, stdout: JSON.stringify({ ok: true, data: { profiles: [] } }), stderr: "" });
    }
    if (command === "workspaces_list") return Promise.resolve({ workspaces: [] });
    if (command === "projects_list") return Promise.resolve({ projects: [...projects.values()] });
    return Promise.resolve({ revision: 1 });
  });
  useStore.setState(freshAccount());

  await useStore.getState().ensureDefaultWorkspaceSetup();

  const state = useStore.getState();
  expect(state.workspaces).toHaveLength(1);
  expect(state.workspaces[0].profileNames).toHaveLength(3);
  expect(Object.values(state.workspaces[0].profileToolsets).sort()).toEqual(["camoufox", "clawbrowser", "dasbrowser"]);
  expect(state.conversations.some((conversation) => conversation.workspaceId === state.workspaces[0].id)).toBe(true);
  expect(state.workspaceSetupRequired).toBe(false);
  expect(state.workspaceSetupAuto).toBe("done");
});

it("keeps the new workspace usable when optional default profiles cannot be created", async () => {
  const { useStore } = await import("./store");
  bridge.invoke.mockImplementation((command: string) => {
    if (command === "nextctl_run") return Promise.resolve({ code: 1, stdout: "", stderr: "cli down" });
    if (command === "workspaces_list") return Promise.resolve({ workspaces: [] });
    if (command === "projects_list") return Promise.resolve({ projects: [] });
    return Promise.resolve({ revision: 1 });
  });
  useStore.setState(freshAccount());

  await useStore.getState().ensureDefaultWorkspaceSetup();

  const state = useStore.getState();
  expect(state.workspaceSetupRequired).toBe(false);
  expect(state.workspaceSetupAuto).toBe("done");
});

it("never repopulates an existing empty workspace or deleted defaults", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ ...freshAccount(), workspaces: [{ id: "empty", name: "Empty", profileNames: [], profileToolsets: {}, createdAt: 1, updatedAt: 1 }], activeWorkspaceId: "empty" });
  await useStore.getState().ensureDefaultWorkspaceSetup();
  expect(bridge.invoke).not.toHaveBeenCalled();
  expect(useStore.getState().workspaces[0].profileNames).toEqual([]);
  expect(useStore.getState().conversations).toEqual([]);
});

it("creates fresh defaults instead of adopting another account's same-named profiles", async () => {
  const { useStore } = await import("./store");
  const original = ["Clawbrowser profile", "DasBrowser profile", "Camoufox profile"];
  const created: string[] = [];
  bridge.invoke.mockImplementation(async (command) => {
    if (command === "nextctl_run") return { code: 0, stdout: JSON.stringify({ ok: true, data: { profiles: original.map((name) => ({ name })) } }), stderr: "" };
    if (command === "workspaces_list") return { workspaces: [] };
    if (command === "projects_list") return { projects: [] };
    return { revision: 1 };
  });
  useStore.setState({ ...freshAccount(), profiles: original.map((name) => ({ name, country: "US" })) });
  const create = vi.spyOn(useStore.getState(), "createManagedProfile").mockImplementation(async (name) => { created.push(name); return name; });
  await useStore.getState().ensureDefaultWorkspaceSetup();
  expect(created).toHaveLength(3);
  expect(created.every((name) => !original.includes(name))).toBe(true);
  expect(useStore.getState().workspaces[0].profileNames.sort()).toEqual(created.sort());
  create.mockRestore();
});
