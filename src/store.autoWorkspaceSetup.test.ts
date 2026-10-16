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
  // The first task runs in the selected profile, so one is selected for it.
  expect(state.selectedProfile).toBe("Clawbrowser profile");
  const { trackTiming } = await import("./lib/analytics");
  expect(trackTiming).toHaveBeenCalledWith("workspace_auto_setup_completed", expect.any(Number), { profiles_created: 3, profiles_failed: 0 });
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
  const { trackTiming } = await import("./lib/analytics");
  expect(trackTiming).toHaveBeenCalledWith("workspace_auto_setup_completed", expect.any(Number), { profiles_created: 0, profiles_failed: 3 });
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

const toolsets = { "Clawbrowser profile": "clawbrowser", "DasBrowser profile": "dasbrowser", "Camoufox profile": "camoufox" } as const;

// A workspace made on another computer: its profiles live there, not here.
function syncedWorkspace() {
  return {
    id: "synced",
    name: "My workspace",
    profileNames: Object.keys(toolsets),
    profileToolsets: { ...toolsets },
    profileProxyIds: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

function computerWith(local: string[]) {
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === "nextctl_run") return { code: 0, stdout: JSON.stringify({ ok: true, data: { profiles: local.map((name) => ({ name })) } }), stderr: "" };
    if (command === "workspaces_list") return { workspaces: [] };
    if (command === "projects_list") return { projects: [] };
    return { revision: 1 };
  });
}

function signedInOnNewComputer() {
  return { ...freshAccount(), workspaceSetupRequired: false, workspaceSetupAuto: "done" as const, workspaces: [syncedWorkspace()], activeWorkspaceId: "synced" };
}

it("never creates profiles for a workspace synced from another computer by itself", async () => {
  const { useStore } = await import("./store");
  useStore.setState(signedInOnNewComputer());
  await useStore.getState().ensureDefaultWorkspaceSetup();
  expect(bridge.invoke).not.toHaveBeenCalled();
  expect(useStore.getState().workspaces[0].profileNames).toEqual(Object.keys(toolsets));
});

it("creates this computer's default profiles on request, once", async () => {
  const { useStore } = await import("./store");
  // Another account's profile on this machine keeps its name too.
  const local = ["Clawbrowser profile 2"];
  computerWith(local);
  useStore.setState(signedInOnNewComputer());
  const create = vi.spyOn(useStore.getState(), "createManagedProfile").mockImplementation(async (name) => { local.push(name); return name; });

  await useStore.getState().createDefaultProfiles();

  // The workspace keeps the other computer's profiles under their names.
  expect(create.mock.calls.map(([name, , options]) => [name, options?.runtime])).toEqual([
    ["Clawbrowser profile 3", "clawbrowser"],
    ["DasBrowser profile 2", "dasbrowser"],
    ["Camoufox profile 2", "camoufox"],
  ]);
  const state = useStore.getState();
  expect(state.workspaces[0].profileNames).toEqual([...Object.keys(toolsets), "Clawbrowser profile 3", "DasBrowser profile 2", "Camoufox profile 2"]);
  expect(state.workspaces[0].profileToolsets).toMatchObject({ "Clawbrowser profile 3": "clawbrowser", "DasBrowser profile 2": "dasbrowser", "Camoufox profile 2": "camoufox" });
  expect(state).toMatchObject({ profilesLoaded: true, defaultProfilesCreating: false, defaultProfilesError: undefined });
  expect(state.selectedProfile).toBe("Clawbrowser profile 3");

  await useStore.getState().createDefaultProfiles();

  expect(create).toHaveBeenCalledTimes(3);
  create.mockRestore();
});

it("selects the first default that could be made when Clawbrowser fails", async () => {
  const { useStore } = await import("./store");
  const local: string[] = [];
  computerWith(local);
  useStore.setState(signedInOnNewComputer());
  // Like the real one, creating a profile selects it.
  const create = vi.spyOn(useStore.getState(), "createManagedProfile").mockImplementation(async (name, _country, options) => {
    if (options?.runtime === "clawbrowser") throw new Error("Clawbrowser is not available");
    local.push(name);
    useStore.getState().selectProfile(name);
    return name;
  });

  await useStore.getState().createDefaultProfiles();

  expect(useStore.getState().selectedProfile).toBe("DasBrowser profile 2");
  create.mockRestore();
});

it("keeps a profile the user already selected in the workspace", async () => {
  const { useStore } = await import("./store");
  const local = ["Camoufox profile"];
  computerWith(local);
  useStore.setState({ ...signedInOnNewComputer(), profiles: [{ name: "Camoufox profile" }], selectedProfile: "Camoufox profile" });
  const create = vi.spyOn(useStore.getState(), "createManagedProfile").mockImplementation(async (name) => {
    local.push(name);
    useStore.getState().selectProfile(name);
    return name;
  });

  await useStore.getState().createDefaultProfiles();

  expect(create.mock.calls.map(([, , options]) => options?.runtime)).toEqual(["clawbrowser", "dasbrowser"]);
  expect(useStore.getState().selectedProfile).toBe("Camoufox profile");
  create.mockRestore();
});

it("creates the profiles it can and skips a toolset that fails", async () => {
  const { useStore } = await import("./store");
  const local: string[] = [];
  computerWith(local);
  useStore.setState(signedInOnNewComputer());
  const create = vi.spyOn(useStore.getState(), "createManagedProfile").mockImplementation(async (name, _country, options) => {
    if (options?.runtime === "dasbrowser") throw new Error("DasBrowser is not available");
    local.push(name);
    return name;
  });

  await useStore.getState().createDefaultProfiles();

  expect(useStore.getState().workspaces[0].profileNames.slice(3)).toEqual(["Clawbrowser profile 2", "Camoufox profile 2"]);
  expect(useStore.getState().defaultProfilesError).toBeUndefined();
  create.mockRestore();
});

it("says why when no profile could be created", async () => {
  const { useStore } = await import("./store");
  computerWith([]);
  useStore.setState(signedInOnNewComputer());
  const create = vi.spyOn(useStore.getState(), "createManagedProfile").mockRejectedValue(new Error("cli down"));

  await useStore.getState().createDefaultProfiles();

  expect(create).toHaveBeenCalledTimes(3);
  expect(useStore.getState().workspaces[0].profileNames).toEqual(Object.keys(toolsets));
  expect(useStore.getState().defaultProfilesCreating).toBe(false);
  expect(useStore.getState().defaultProfilesError).toMatch(/^We couldn't create the profiles\. .*Ref: NB-/);
  create.mockRestore();
});
