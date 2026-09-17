import { beforeEach, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("./electronBridge", () => ({ ...bridge, filePathForFile: () => "" }));
vi.mock("./lib/analytics", () => ({
  setAnalyticsUserId: vi.fn(), trackEvent: vi.fn(), trackScreenView: vi.fn(), trackTiming: vi.fn(),
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const result = (data: unknown) => ({ code: 0, stderr: "", stdout: JSON.stringify({ ok: true, data }) });
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  bridge.invoke.mockReset();
  bridge.invoke.mockResolvedValue(null);
});

it("does not let an older profile refresh hide a newly created profile", async () => {
  const { useStore } = await import("./store");
  const oldStatus = deferred<ReturnType<typeof result>>();
  let lists = 0;
  bridge.invoke.mockImplementation((command, { args } = {}) => {
    if (command !== "nextctl_run") return Promise.resolve(null);
    if (args[0] === "profiles") return Promise.resolve(result({ profiles: ++lists === 1 ? [{ name: "one" }] : [{ name: "one" }, { name: "two" }] }));
    if (lists === 1) return oldStatus.promise;
    return Promise.resolve(result({ status: "stopped" }));
  });
  const oldRefresh = useStore.getState().loadProfiles();
  await vi.waitFor(() => expect(bridge.invoke.mock.calls.some(([, arg]) => arg?.args?.[0] === "status")).toBe(true));
  await useStore.getState().loadProfiles();
  oldStatus.resolve(result({ status: "stopped" }));
  await oldRefresh;
  expect(useStore.getState().profiles.map((p) => p.name)).toEqual(["one", "two"]);
});

it("preserves and persists a profile assigned while cloud sync is waiting for projects", async () => {
  const { useStore } = await import("./store");
  const projects = deferred<{ projects: never[] }>();
  const workspace = { id: "w", name: "Workspace", profileNames: ["one"], profileToolsets: {}, createdAt: 1, updatedAt: 1 };
  useStore.setState({ authed: true, workspaces: [workspace], activeWorkspaceId: "w" });
  bridge.invoke.mockImplementation((command) => {
    if (command === "workspaces_list") return Promise.resolve({ workspaces: [] });
    if (command === "workspace_put") return Promise.resolve({ revision: 1 });
    if (command === "projects_list") return projects.promise;
    return Promise.resolve(null);
  });
  const sync = useStore.getState().syncProjects();
  await vi.waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith("projects_list"));
  await useStore.getState().assignProfileToProject("two", "clawbrowser");
  projects.resolve({ projects: [] });
  await sync;
  await vi.waitFor(() => expect(useStore.getState().projectsSyncing).toBe(false));
  expect(useStore.getState().workspaces[0].profileNames).toEqual(["one", "two"]);
  const writes = bridge.invoke.mock.calls.filter(([command, args]) => command === "app_data_write" && args.name === "workspaces.json");
  expect(JSON.parse(writes.at(-1)![1].content)[0].profileNames).toEqual(["one", "two"]);
  const uploads = bridge.invoke.mock.calls.filter(([command]) => command === "workspace_put");
  expect(uploads.at(-1)![1].workspace.document.profileNames).toEqual(["one", "two"]);
});

it("does not let an older status overwrite a newer running session", async () => {
  const { useStore } = await import("./store");
  const oldStatus = deferred<ReturnType<typeof result>>();
  let statusCalls = 0;
  bridge.invoke.mockImplementation((command, { args } = {}) => {
    if (command !== "nextctl_run") return Promise.resolve(null);
    if (args[0] === "profiles") return Promise.resolve(result({ profiles: [{ name: "one", country: "US" }] }));
    if (args[0] === "status") return ++statusCalls === 1
      ? oldStatus.promise
      : Promise.resolve(result({ status: "running" }));
    return Promise.resolve(null);
  });
  const oldRefresh = useStore.getState().loadProfiles();
  await vi.waitFor(() => expect(statusCalls).toBe(1));
  await useStore.getState().loadProfiles();
  oldStatus.resolve(result({ status: "stopped" }));
  await oldRefresh;
  expect(useStore.getState().statuses.one).toBe("running");
  expect(useStore.getState().profileSessions.one.status).toBe("running");
  expect(useStore.getState().profileIdentities.one.country).toBe("US");
});

it("ignores a stale inventory response that arrives after the newer list", async () => {
  const { useStore } = await import("./store");
  const olderList = deferred<ReturnType<typeof result>>();
  let lists = 0;
  bridge.invoke.mockImplementation((command, { args } = {}) => {
    if (command !== "nextctl_run") return Promise.resolve(null);
    if (args[0] === "profiles") return ++lists === 1 ? olderList.promise : Promise.resolve(result({ profiles: [{ name: "two" }] }));
    return Promise.resolve(result({ status: "stopped" }));
  });
  const oldRefresh = useStore.getState().loadProfiles();
  await useStore.getState().loadProfiles();
  olderList.resolve(result({ profiles: [{ name: "deleted" }] }));
  await oldRefresh;
  expect(useStore.getState().profiles.map((p) => p.name)).toEqual(["two"]);
});

it("shows profiles even while a browser status request is slow", async () => {
  const { useStore } = await import("./store");
  const status = deferred<ReturnType<typeof result>>();
  bridge.invoke.mockImplementation((command, { args } = {}) => {
    if (command !== "nextctl_run") return Promise.resolve(null);
    if (args[0] === "profiles") return Promise.resolve(result({ profiles: [{ name: "one" }, { name: "two" }] }));
    return status.promise;
  });
  const refresh = useStore.getState().loadProfiles();
  await vi.waitFor(() => expect(useStore.getState().profiles.map((p) => p.name)).toEqual(["one", "two"]));
  status.resolve(result({ status: "stopped" }));
  await refresh;
});

it("still applies cloud workspace updates when there are no concurrent local edits", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ authed: true, workspaces: [{ id: "w", name: "Workspace", profileNames: ["one"], profileToolsets: {}, createdAt: 1, updatedAt: 1 }], activeWorkspaceId: "w" });
  bridge.invoke.mockImplementation((command) => {
    if (command === "workspaces_list") return Promise.resolve({ workspaces: [{ id: "w", name: "Workspace", revision: 2, created_at: new Date(1).toISOString(), updated_at: new Date(2).toISOString(), document: { profileNames: ["one", "two"], profileToolsets: {} } }] });
    if (command === "projects_list") return Promise.resolve({ projects: [] });
    return Promise.resolve(null);
  });
  await useStore.getState().syncProjects();
  expect(useStore.getState().workspaces[0].profileNames).toEqual(["one", "two"]);
  expect(bridge.invoke.mock.calls.filter(([command]) => command === "workspaces_list")).toHaveLength(1);
});

it("does not restore a profile association removed during sync", async () => {
  const { useStore } = await import("./store");
  const projects = deferred<{ projects: never[] }>();
  useStore.setState({ authed: true, workspaces: [{ id: "w", name: "Workspace", profileNames: ["one", "two"], profileToolsets: {}, createdAt: 1, updatedAt: 1 }], activeWorkspaceId: "w" });
  bridge.invoke.mockImplementation((command) => {
    if (command === "workspaces_list") return Promise.resolve({ workspaces: [] });
    if (command === "workspace_put") return Promise.resolve({ revision: 1 });
    if (command === "projects_list") return projects.promise;
    return Promise.resolve(null);
  });
  const sync = useStore.getState().syncProjects();
  await vi.waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith("projects_list"));
  useStore.setState((state) => ({ workspaces: state.workspaces.map((workspace) => ({ ...workspace, profileNames: ["two"], updatedAt: Date.now() })) }));
  projects.resolve({ projects: [] });
  await sync;
  await vi.waitFor(() => expect(useStore.getState().projectsSyncing).toBe(false));
  expect(useStore.getState().workspaces[0].profileNames).toEqual(["two"]);
});
