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

it("limits large workspace cleanup to three removals and leaves shared profiles alone", async () => {
  const { useStore } = await import("./store");
  const names = Array.from({ length: 60 }, (_, i) => `batch-${i}`);
  let active = 0, peak = 0;
  const deleteProfile = vi.fn(async (_name: string) => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
  });
  bridge.invoke.mockImplementation(async (command) => {
    if (command === "workspace_delete" || command === "artifact_workspace_delete") expect(active).toBe(0);
    return { revision: 1 };
  });
  useStore.setState({ workspaces: [{ ...workspace("big"), profileNames: [...names, "shared"] }, { ...workspace("keep"), profileNames: ["shared"] }],
    activeWorkspaceId: "keep", conversations: [], deleteProfile, loadProfiles: vi.fn().mockResolvedValue(undefined) });
  const progress: string[] = [];
  await useStore.getState().deleteWorkspace("big", (message) => progress.push(message));
  expect(peak).toBe(3);
  expect(deleteProfile).toHaveBeenCalledTimes(60);
  expect(deleteProfile.mock.calls.map((args) => args[0]).sort()).toEqual([...names].sort());
  expect(useStore.getState().workspaces.map((item) => item.id)).toEqual(["keep"]);
  expect(progress).toContain("Stopping and removing profiles 60/60…");
});

it("settles in-flight removals before reporting a failed workspace deletion", async () => {
  const { useStore } = await import("./store");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let active = 0;
  const failure = new Error("cannot stop browser");
  const remove = vi.fn(async (name: string) => {
    if (name === "bad") throw failure;
    active++; await pending; active--;
  });
  useStore.setState({ workspaces: [{ ...workspace("big"), profileNames: ["bad", "pending-1", "pending-2", "untouched"] }],
    activeWorkspaceId: "big", conversations: [], deleteProfile: remove, loadProfiles: vi.fn().mockResolvedValue(undefined) });
  let settled = false;
  const deletion = useStore.getState().deleteWorkspace("big").catch((error) => { settled = true; return error; });
  await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(3));
  expect(settled).toBe(false);
  expect(active).toBe(2);
  release();
  expect(await deletion).toBe(failure);
  expect(active).toBe(0);
  expect(bridge.invoke).not.toHaveBeenCalledWith("workspace_delete", expect.anything());
  expect(useStore.getState().workspaces[0].id).toBe("big");
});

it("clears the previous profile and conversation when creating a workspace", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ agentId: "claude", workspaces: [workspace("a")], activeWorkspaceId: "a", selectedProfile: "a-profile", activeConvId: { claude: "old" }, conversations: [] });
  const id = await useStore.getState().createWorkspace("New workspace");
  expect(useStore.getState()).toMatchObject({ activeWorkspaceId: id, selectedProfile: undefined });
  expect(useStore.getState().activeConvId.claude).toBeUndefined();
});

it("does not switch workspace or profile when deleting a different workspace", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ workspaces: [workspace("a"), workspace("b"), workspace("c")], activeWorkspaceId: "b", selectedProfile: "b-profile", conversations: [], deleteProfile: vi.fn().mockResolvedValue(undefined) });
  await useStore.getState().deleteWorkspace("c");
  expect(useStore.getState()).toMatchObject({ activeWorkspaceId: "b", selectedProfile: "b-profile" });
});

it("clears stale references when the last workspace is deleted", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ workspaces: [workspace("a")], activeWorkspaceId: "a", selectedProfile: "a-profile", activeConvId: { claude: "old" }, conversations: [], deleteProfile: vi.fn().mockResolvedValue(undefined) });
  await useStore.getState().deleteWorkspace("a");
  expect(useStore.getState()).toMatchObject({ activeWorkspaceId: undefined, selectedProfile: undefined, activeConvId: {} });
});

it("deletes exclusive profiles, projects, schedules, and artifacts after confirmation while keeping shared profiles", async () => {
  const { useStore } = await import("./store");
  const calls: string[] = [];
  bridge.invoke.mockImplementation(async (command: string) => { calls.push(command); return { revision: 1 }; });
  const deleteProfile = vi.fn(async (name: string) => { calls.push(`profile:${name}`); });
  useStore.setState({
    workspaces: [{ ...workspace("a"), profileNames: ["exclusive", "shared"] }, { ...workspace("b"), profileNames: ["shared"] }],
    activeWorkspaceId: "a", deleteProfile,
    conversations: [{ id: "a-chat", workspaceId: "a", agent: "claude", messages: [], createdAt: 1, updatedAt: 1 }, { id: "b-chat", workspaceId: "b", agent: "claude", messages: [], createdAt: 1, updatedAt: 1 }],
    scheduledRuns: [{ id: "a-run", workspaceId: "a" }, { id: "b-run", workspaceId: "b" }],
  } as any);
  await useStore.getState().deleteWorkspace("a");
  expect(deleteProfile).toHaveBeenCalledExactlyOnceWith("exclusive", { deletingWorkspace: true });
  expect(calls.indexOf("profile:exclusive")).toBeLessThan(calls.indexOf("artifact_workspace_delete"));
  expect(calls.indexOf("artifact_workspace_delete")).toBeLessThan(calls.indexOf("workspace_delete"));
  expect(useStore.getState().workspaces.map((item) => item.id)).toEqual(["b"]);
  expect(useStore.getState().conversations.map((item) => item.id)).toEqual(["b-chat"]);
  expect(useStore.getState().scheduledRuns.map((item) => item.id)).toEqual(["b-run"]);
  expect(localStorage.setItem).toHaveBeenCalledWith("deletedWorkspaceIds:v1", JSON.stringify(["a"]));
});

it("keeps the workspace when a profile cannot be stopped or removed", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ workspaces: [workspace("a")], activeWorkspaceId: "a", deleteProfile: vi.fn().mockRejectedValue(new Error("browser still running")) });
  await expect(useStore.getState().deleteWorkspace("a")).rejects.toThrow("browser still running");
  expect(bridge.invoke).not.toHaveBeenCalledWith("workspace_delete", expect.anything());
  expect(useStore.getState().workspaces.map((item) => item.id)).toEqual(["a"]);
});

it("removes a large workspace without a cloud sync after every profile", async () => {
  const { useStore } = await import("./store");
  const syncProjects = vi.fn().mockResolvedValue(undefined);
  const loadProfiles = vi.fn().mockResolvedValue(undefined);
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === "nextctl_run") return { code: 0, stderr: "", stdout: JSON.stringify({ ok: true, data: {} }) };
    if (command === "nextctl_cancel") return false;
    return { revision: 1 };
  });
  useStore.setState({
    authed: true, nextctlAvailable: true, syncProjects, loadProfiles,
    workspaces: [{ ...workspace("a"), profileNames: ["one", "two", "three"] }],
    statuses: { one: "stopped", two: "stopped", three: "stopped" },
    activeWorkspaceId: "a", conversations: [],
  });
  const progress: string[] = [];
  await useStore.getState().deleteWorkspace("a", (message) => progress.push(message));
  expect(bridge.invoke.mock.calls.filter(([command, args]) => command === "nextctl_run" && args?.args?.[1] === "rm")).toHaveLength(3);
  expect(syncProjects).not.toHaveBeenCalled();
  expect(loadProfiles).toHaveBeenCalledOnce();
  expect(progress).toContain("Stopping and removing profiles 3/3…");
});

it("does not resurrect a deleted workspace or its projects from a stale sync response", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ workspaces: [{ ...workspace("a"), profileNames: [] }], activeWorkspaceId: "a", authed: true, conversations: [] });
  await useStore.getState().deleteWorkspace("a");
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === "workspaces_list") return { workspaces: [{ id: "a", name: "a", document: { profileNames: [] }, revision: 1, created_at: "2026-09-29T00:00:00Z", updated_at: "2026-09-29T00:00:00Z" }] };
    if (command === "projects_list") return { projects: [{ id: "old-chat", title: "Old", agent: "claude", chat_mode: "chat", workspace_id: "a", document: { messages: [] }, revision: 1, updated_at: "2026-09-29T00:00:00Z" }] };
    return { revision: 1 };
  });
  await useStore.getState().syncProjects();
  expect(useStore.getState().workspaces).toEqual([]);
  expect(useStore.getState().conversations).toEqual([]);
  expect(bridge.invoke.mock.calls.some(([command]) => command === "workspace_put" || command === "project_put")).toBe(false);
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

it("reports an unsaved profile assignment when the workspace belongs to another account", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ authed: true, workspaces: [workspace("mine")], activeWorkspaceId: "mine", conversations: [] });
  bridge.invoke.mockImplementation((command: string) => {
    if (command === "workspaces_list") return Promise.resolve({ workspaces: [] });
    if (command === "workspace_put") return Promise.reject(Object.assign(new Error("workspace revision conflict"), { status: 409 }));
    if (command === "projects_list") return Promise.resolve({ projects: [] });
    return Promise.resolve({ revision: 1 });
  });
  // Removing a foreign workspace is not a successful profile assignment.
  await expect(useStore.getState().assignProfileToProject("new", "clawbrowser")).rejects.toThrow("belongs to another account");
  expect(useStore.getState().workspaces).toEqual([]);
  expect(bridge.invoke.mock.calls.filter(([command]) => command === "workspace_put")).toHaveLength(2);
  // The sync keeps going instead of aborting on the first unowned workspace.
  expect(bridge.invoke.mock.calls.some(([command]) => command === "projects_list")).toBe(true);
  expect(useStore.getState().projectsSyncing).toBe(false);
});

it("reports an unsaved assignment when the backend no longer has the workspace", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ authed: true, workspaces: [workspace("mine")], activeWorkspaceId: "mine", conversations: [] });
  bridge.invoke.mockImplementation((command: string) => {
    if (command === "workspace_put") return Promise.reject(Object.assign(new Error("workspace not found"), { status: 404 }));
    if (command === "workspaces_list") return Promise.resolve({ workspaces: [] });
    if (command === "projects_list") return Promise.resolve({ projects: [] });
    return Promise.resolve({ revision: 1 });
  });
  // A deleted workspace cannot accept an assignment; do not report success.
  await expect(useStore.getState().assignProfileToProject("new", "clawbrowser")).rejects.toThrow("belongs to another account");
  expect(useStore.getState().workspaces).toEqual([]);
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

it("clears the rotating marker when an IP rotation fails", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ statuses: { p: "running" } });
  bridge.invoke.mockRejectedValue(new Error("cli down"));
  await expect(useStore.getState().rotateProfile("p")).rejects.toThrow();
  // A stuck "rotating" status pauses status polling for every profile.
  expect(useStore.getState().statuses.p).not.toBe("rotating");
  expect(useStore.getState().statuses.p).toBe("unknown");
});

it("terminates an in-flight reply and clears its marker when its chat is deleted", async () => {
  const { useStore } = await import("./store");
  const project = {
    id: "c1", title: "C", agent: "claude",
    messages: [{ id: "r1", role: "assistant" as const, text: "…", status: "streaming" as const, createdAt: 1 }],
    createdAt: 1, updatedAt: 1, executionTarget: "local" as const,
  };
  const runtime = useStore.getState().runtime;
  useStore.setState({
    conversations: [project],
    activeConvId: { claude: "c1" },
    runtime: { ...runtime, claude: { ...runtime.claude, runningReplyId: "r1" } },
  });
  await useStore.getState().deleteConversation("c1");
  expect(useStore.getState().conversations).toEqual([]);
  expect(useStore.getState().runtime.claude.runningReplyId).toBeUndefined();
  expect(bridge.invoke.mock.calls.some(([command, args]) => command === "agent_terminate" && (args as { replyId?: string })?.replyId === "r1")).toBe(true);
});

it("tells the main process when the app, not the user, stops a reply for taking too long", async () => {
  const { useStore } = await import("./store");
  const project = {
    id: "c1", title: "C", agent: "claude",
    messages: [
      { id: "r1", role: "assistant" as const, text: "…", status: "streaming" as const, createdAt: 1 },
      { id: "r2", role: "assistant" as const, text: "…", status: "streaming" as const, createdAt: 2 },
    ],
    createdAt: 1, updatedAt: 1, executionTarget: "local" as const,
  };
  const runtime = useStore.getState().runtime;
  bridge.invoke.mockResolvedValue(null);
  useStore.setState({ conversations: [project], runtime: { ...runtime, claude: { ...runtime.claude, runningReplyId: "r1" } } });
  useStore.getState().stopReply("r1");
  useStore.setState({ runtime: { ...runtime, claude: { ...runtime.claude, runningReplyId: "r2" } } });
  useStore.getState().stopReply("r2", { reason: "timeout" });
  const terminations = bridge.invoke.mock.calls.filter(([command]) => command === "agent_terminate").map(([, args]) => args);
  expect(terminations).toEqual([{ replyId: "r1" }, { replyId: "r2", reason: "timeout" }]);
});

it("drops queued replies when their chat is deleted", async () => {
  const { useStore } = await import("./store");
  const project = { id: "c1", title: "C", agent: "claude", messages: [], createdAt: 1, updatedAt: 1, executionTarget: "local" as const };
  const runtime = useStore.getState().runtime;
  useStore.setState({
    conversations: [project],
    activeConvId: { claude: "c1" },
    runtime: {
      ...runtime,
      claude: { ...runtime.claude, queue: [{ conversationId: "c1", rawText: "hi", replyId: "q1", executionTarget: "local" as const }] },
    },
  });
  await useStore.getState().deleteConversation("c1");
  // An orphaned queued item would run later and wedge the composer on Stop.
  expect(useStore.getState().runtime.claude.queue).toEqual([]);
});

it("clears a stuck stopping status when profile removal fails", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ statuses: { p: "running" } });
  bridge.invoke.mockImplementation((command: string) => {
    if (command === "nextctl_run") return Promise.resolve({ code: 1, stdout: "", stderr: "cli down" });
    if (command === "nextctl_cancel") return Promise.resolve(false);
    return Promise.resolve(null);
  });
  await expect(useStore.getState().deleteProfile("p")).rejects.toThrow();
  expect(useStore.getState().statuses.p).not.toBe("stopping");
});

it("reports a failed profile-request approval instead of dismissing it", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ pendingProfileCreateRequests: [{ id: "req1" }] as never });
  bridge.invoke.mockImplementation((command: string) => {
    if (command === "nextctl_run") return Promise.resolve({ code: 1, stdout: "", stderr: "backend down" });
    return Promise.resolve(null);
  });
  await expect(useStore.getState().approveProfileCreateRequest("req1")).rejects.toThrow();
  expect(useStore.getState().pendingProfileCreateRequests).toHaveLength(1);
});

it("ignores a second sign-in request while one is already in flight", async () => {
  const { useStore } = await import("./store");
  const runtime = useStore.getState().runtime;
  useStore.setState({ agentId: "claude", runtime: { ...runtime, claude: { ...runtime.claude, authorizing: true } } });
  await useStore.getState().loginAgent();
  expect(bridge.invoke.mock.calls.some(([command]) => command === "open_terminal_login")).toBe(false);
});

it("opens OpenClaw setup without polling for a sign-in it cannot report", async () => {
  const { useStore } = await import("./store");
  bridge.invoke.mockResolvedValue(null);
  useStore.setState({ agentId: "openclaw" });
  await useStore.getState().loginAgent();
  const commands = bridge.invoke.mock.calls.map(([command]) => command);
  expect(commands).toContain("open_terminal_login");
  expect(commands).not.toContain("agent_check_login");
  expect(useStore.getState().runtime.openclaw).toMatchObject({ authorizing: false, error: undefined });
});

it("drops queued replies when the chat is cleared", async () => {
  const { useStore } = await import("./store");
  const project = { id: "c1", title: "C", agent: "claude", messages: [], createdAt: 1, updatedAt: 1, executionTarget: "local" as const };
  const runtime = useStore.getState().runtime;
  useStore.setState({
    conversations: [project],
    activeConvId: { claude: "c1" },
    runtime: { ...runtime, claude: { ...runtime.claude, queue: [{ conversationId: "c1", rawText: "hi", replyId: "q1", executionTarget: "local" as const }] } },
    agentId: project.agent,
  });
  useStore.getState().clearChat();
  expect(useStore.getState().runtime.claude.queue).toEqual([]);
});

it("deletes the private cloud copy of a custom script", async () => {
  const { useStore } = await import("./store");
  useStore.setState({
    customScripts: [{ id: "s1", title: "S", domain: "x.com", instructions: "i", createdAt: 1, updatedAt: 1, serverSlug: "s1.script" } as never],
  });
  bridge.invoke.mockImplementation((command: string) => {
    if (command === "nextctl_run") return Promise.resolve({ code: 0, stdout: JSON.stringify({ ok: true }), stderr: "" });
    return Promise.resolve(null);
  });
  await useStore.getState().deleteCustomScript("s1");
  expect(useStore.getState().customScripts).toEqual([]);
  const deletedCloud = bridge.invoke.mock.calls.some(([command, args]) =>
    command === "nextctl_run" && Array.isArray((args as { args?: string[] })?.args)
      && (args as { args: string[] }).args[0] === "skill" && (args as { args: string[] }).args[1] === "delete");
  expect(deletedCloud).toBe(true);
});

it("does not ask for first-run defaults after the account deletes its last workspace", async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  const { useStore } = await import("./store");
  useStore.setState({ accountOwnerId: "owner-a", workspaces: [workspace("a")], activeWorkspaceId: "a", conversations: [], deleteProfile: vi.fn().mockResolvedValue(undefined) });
  await useStore.getState().deleteWorkspace("a");
  expect(useStore.getState().workspaces).toEqual([]);
  expect(useStore.getState().workspaceSetupRequired).toBe(false);
});

it("drops a workspace deleted on another device instead of uploading it again", async () => {
  const storage = new Map<string, string>([["syncedWorkspaceIds:v1", JSON.stringify(["gone", "kept"])]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  const keptCloud = { id: "kept", name: "kept", revision: 2, created_at: new Date(1).toISOString(), updated_at: new Date(5).toISOString(), document: { profileNames: [], profileToolsets: {} } };
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === "workspaces_list") return { workspaces: [keptCloud] };
    if (command === "projects_list") return { projects: [] };
    return { revision: 1 };
  });
  const { useStore } = await import("./store");
  // A fresh start: the workspace is only in the local cache, revisions are empty.
  useStore.setState({
    authed: true, projectsSyncing: false, workspaceRevisions: {}, activeWorkspaceId: "gone",
    workspaces: [{ ...workspace("gone"), updatedAt: 10 }, { ...workspace("kept"), profileNames: [], updatedAt: 5 }],
    conversations: [{ id: "gone-chat", workspaceId: "gone", agent: "claude", messages: [], createdAt: 1, updatedAt: 1 }],
  } as any);
  await useStore.getState().syncProjects();
  expect(bridge.invoke).not.toHaveBeenCalledWith("workspace_put", expect.objectContaining({ id: "gone" }));
  expect(useStore.getState().workspaces.map((item) => item.id)).toEqual(["kept"]);
  expect(useStore.getState().conversations).toEqual([]);
  expect(JSON.parse(storage.get("deletedWorkspaceIds:v1") || "[]")).toContain("gone");
});

it("keeps a profile moved to another workspace out of the source after a revision conflict", async () => {
  const cloudDoc = (id: string, profileNames: string[], revision: number) => ({
    id, name: id, revision, created_at: new Date(1).toISOString(), updated_at: new Date(2).toISOString(),
    document: { profileNames, profileToolsets: Object.fromEntries(profileNames.map((name) => [name, "clawbrowser"])) },
  });
  let conflictOnce = true;
  const puts: Array<{ id: string; names: string[] }> = [];
  bridge.invoke.mockImplementation(async (command: string, args: any) => {
    // Another device edited workspace "a" meanwhile (its copy still lists "p").
    if (command === "workspaces_list") return { workspaces: [cloudDoc("a", ["p", "other-device"], 7), cloudDoc("b", [], 3)] };
    if (command === "workspace_put") {
      if (args.id === "a" && conflictOnce) { conflictOnce = false; throw new Error("workspace revision conflict"); }
      puts.push({ id: args.id, names: args.workspace.document.profileNames });
      return { revision: 9 };
    }
    if (command === "projects_list") return { projects: [] };
    return { revision: 1 };
  });
  const { useStore } = await import("./store");
  useStore.setState({
    authed: true, projectsSyncing: false, conversations: [], statuses: {}, profileSessions: {},
    workspaces: [{ ...workspace("a"), profileNames: ["p"], profileToolsets: { p: "clawbrowser" }, updatedAt: 2 }, { ...workspace("b"), profileNames: [], updatedAt: 2 }],
    workspaceRevisions: { a: 5, b: 3 }, activeWorkspaceId: "a",
  } as any);
  await useStore.getState().moveProfileToWorkspace("p", "b");
  const a = useStore.getState().workspaces.find((item) => item.id === "a")!;
  expect(a.profileNames).toEqual(["other-device"]);
  expect(puts.find((put) => put.id === "a")?.names).toEqual(["other-device"]);
});
