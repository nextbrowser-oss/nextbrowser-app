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
  bridge.invoke.mockImplementation((command: string) => {
    if (command === "nextctl_run") {
      return Promise.resolve({ code: 0, stdout: JSON.stringify({ ok: true, data: { profiles: [] } }), stderr: "" });
    }
    if (command === "workspaces_list") return Promise.resolve({ workspaces: [] });
    if (command === "projects_list") return Promise.resolve({ projects: [] });
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

it("falls back to the manual gate when defaults cannot be created", async () => {
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
  expect(state.workspaceSetupRequired).toBe(true);
  expect(state.workspaceSetupAuto).toBe("failed");
});
