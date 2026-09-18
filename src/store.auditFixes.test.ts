import { afterEach, beforeEach, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("./electronBridge", () => ({ ...bridge, filePathForFile: () => "" }));
vi.mock("./lib/analytics", () => ({ setAnalyticsUserId: vi.fn(), trackEvent: vi.fn(), trackScreenView: vi.fn(), trackTiming: vi.fn() }));
const workspace = (id: string) => ({ id, name: id, profileNames: [id + "-profile"], profileToolsets: {}, createdAt: 1, updatedAt: 1 });
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  bridge.invoke.mockReset(); bridge.invoke.mockResolvedValue({ revision: 1 });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("clears the previous profile and conversation when creating a workspace", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ agentId: "claude", workspaces: [workspace("a")], activeWorkspaceId: "a", selectedProfile: "a-profile", activeConvId: { claude: "old" }, conversations: [] });
  const id = await useStore.getState().createWorkspace("New workspace");
  expect(useStore.getState()).toMatchObject({ activeWorkspaceId: id, selectedProfile: undefined });
  expect(useStore.getState().activeConvId.claude).toBeUndefined();
});

it("does not switch workspace or profile when deleting a different workspace", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ workspaces: [workspace("a"), workspace("b"), workspace("c")], activeWorkspaceId: "b", selectedProfile: "b-profile", conversations: [] });
  await useStore.getState().deleteWorkspace("c");
  expect(useStore.getState()).toMatchObject({ activeWorkspaceId: "b", selectedProfile: "b-profile" });
});

it("clears stale references when the last workspace is deleted", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ workspaces: [workspace("a")], activeWorkspaceId: "a", selectedProfile: "a-profile", activeConvId: { claude: "old" }, conversations: [] });
  await useStore.getState().deleteWorkspace("a");
  expect(useStore.getState()).toMatchObject({ activeWorkspaceId: undefined, selectedProfile: undefined, activeConvId: {} });
});

it("rejects and rolls back assignment on a desktop write failure, then permits retry", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ authed: true, workspaces: [workspace("a")], activeWorkspaceId: "a" });
  bridge.invoke.mockRejectedValueOnce(new Error("disk full"));
  await expect(useStore.getState().assignProfileToProject("new", "clawbrowser")).rejects.toThrow("disk full");
  expect(useStore.getState().workspaces[0].profileNames).toEqual(["a-profile"]);
  await useStore.getState().assignProfileToProject("new", "clawbrowser");
  expect(useStore.getState().workspaces[0].profileNames).toEqual(["a-profile", "new"]);
  // syncProjects() (folded into this mutation since 283e454) also persists
  // conversations.json via the same "app_data_write" command — filter by
  // file name, not just command, or the last call picked up here can be an
  // unrelated write.
  const write = bridge.invoke.mock.calls.filter(([command, args]) => command === "app_data_write" && args?.name === "workspaces.json").at(-1)!;
  expect(JSON.parse(write[1].content)[0].profileNames).toEqual(["a-profile", "new"]);
});

it("serializes simultaneous assignments without dropping either profile", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ authed: true, workspaces: [workspace("a")], activeWorkspaceId: "a" });
  await Promise.all([useStore.getState().assignProfileToProject("one", "clawbrowser"), useStore.getState().assignProfileToProject("two", "camoufox")]);
  expect(useStore.getState().workspaces[0].profileNames).toEqual(["a-profile", "one", "two"]);
});

it("does not reorder on write failure or insert a profile from another workspace", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ authed: true, workspaces: [{ ...workspace("a"), profileNames: ["one", "two"] }] });
  bridge.invoke.mockRejectedValueOnce(new Error("disk full"));
  await expect(useStore.getState().reorderProfileInProject("a", "two", "one")).rejects.toThrow();
  expect(useStore.getState().workspaces[0].profileNames).toEqual(["one", "two"]);
  await expect(useStore.getState().reorderProfileInProject("a", "outside", "one")).rejects.toThrow("no longer");
});

it("rolls back and reports a transient cloud sync failure, unlike an unrecoverable ownership conflict", async () => {
  // Workspace mutations are cloud-authoritative (283e454): a generic sync
  // failure (offline, backend down) is retryable, so the local change is
  // rolled back and the real error surfaces — the opposite of the
  // unrecoverable "belongs to another account" case (see the test above),
  // where there is no valid revision to ever retry against and the mutation
  // is deliberately kept instead.
  const { useStore } = await import("./store");
  useStore.setState({ authed: true, workspaces: [workspace("a")], activeWorkspaceId: "a", syncProjects: vi.fn().mockRejectedValue(new Error("offline")) });
  await expect(useStore.getState().assignProfileToProject("new", "clawbrowser")).rejects.toThrow("offline");
  expect(useStore.getState().workspaces[0].profileNames).toEqual(["a-profile"]);
});

it("keeps a profile usable when a workspace id belongs to another account", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ authed: true, workspaces: [workspace("mine")], activeWorkspaceId: "mine", conversations: [] });
  bridge.invoke.mockImplementation((command: string) => {
    if (command === "workspaces_list") return Promise.resolve({ workspaces: [] });
    if (command === "workspace_put") return Promise.reject(Object.assign(new Error("workspace revision conflict"), { status: 409 }));
    if (command === "projects_list") return Promise.resolve({ projects: [] });
    return Promise.resolve({ revision: 1 });
  });
  // The backend owns this id globally, so no revision can ever match. The
  // assignment must still succeed instead of failing on the cloud sync —
  // even though that means the only workspace it touched, being unowned,
  // gets filtered out of local state entirely rather than kept with a
  // revision that can never sync.
  await expect(useStore.getState().assignProfileToProject("new", "clawbrowser")).resolves.toBeUndefined();
  expect(useStore.getState().workspaces).toEqual([]);
  expect(bridge.invoke.mock.calls.filter(([command]) => command === "workspace_put")).toHaveLength(2);
  // The sync keeps going instead of aborting on the first unowned workspace.
  expect(bridge.invoke.mock.calls.some(([command]) => command === "projects_list")).toBe(true);
  expect(useStore.getState().projectsSyncing).toBe(false);
});

it("reports refresh failure and releases the loading state", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ loadProxy: vi.fn().mockRejectedValue(new Error("offline")) });
  await expect(useStore.getState().refreshProxyData()).rejects.toThrow("offline");
  expect(useStore.getState().isRefreshing).toBe(false);
});

it("does not treat unknown login state as successful logout", async () => {
  const { useStore } = await import("./store");
  vi.useFakeTimers();
  useStore.setState({ agentId: "claude", conversations: [] });
  bridge.invoke.mockResolvedValue(null);
  const logout = useStore.getState().logoutAgent();
  await vi.advanceTimersByTimeAsync(60_000);
  await logout;
  expect(useStore.getState().runtime.claude.error).toContain("could not be confirmed");
});

it("accepts explicit signed-out status and clears a previous error", async () => {
  const { useStore } = await import("./store");
  vi.useFakeTimers();
  useStore.setState({ agentId: "claude", conversations: [] });
  bridge.invoke.mockResolvedValue(false);
  const logout = useStore.getState().logoutAgent();
  await vi.advanceTimersByTimeAsync(5_000);
  await logout;
  expect(useStore.getState().runtime.claude).toMatchObject({ loggedIn: false, error: undefined });
});

it("rejects a duplicate skill application while the first IPC is pending", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ nextctlSupportsSkill: true });
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => { finish = resolve; });
  const response = { code: 0, stderr: "", stdout: JSON.stringify({ ok: true, data: { found: false } }) };
  bridge.invoke.mockImplementation((command) => command === "nextctl_run" ? pending : Promise.resolve(null));
  const entry = { id: "test-skill", title: "Test", subtitle: "example.com", selector: { kind: "domain" as const, value: "example.com" }, category: "browser", categoryTitle: "Browser", categoryIcon: "globe", categoryOrder: 1 };
  const applying = useStore.getState().applySkill(entry);
  await expect(useStore.getState().applySkill(entry)).rejects.toThrow("already being applied");
  finish(response);
  await applying;
});

it("does not hide saved instructions when deletion cannot be persisted", async () => {
  const { useStore } = await import("./store");
  const script = { id: "test", title: "Test", domain: "", instructions: "Keep me", createdAt: 1, updatedAt: 1 };
  useStore.setState({ customScripts: [script] });
  bridge.invoke.mockRejectedValueOnce(new Error("disk full"));
  await expect(useStore.getState().deleteCustomScript("test")).rejects.toThrow("disk full");
  expect(useStore.getState().customScripts).toEqual([script]);
  await useStore.getState().deleteCustomScript("test");
  expect(useStore.getState().customScripts).toEqual([]);
});
