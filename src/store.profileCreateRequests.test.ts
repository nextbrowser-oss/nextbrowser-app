import { beforeEach, expect, it, vi } from "vitest";
import type { ProfileCreateRequest } from "./types";

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("./electronBridge", () => ({ ...bridge, filePathForFile: () => "" }));
vi.mock("./lib/analytics", () => ({
  setAnalyticsUserId: vi.fn(), trackEvent: vi.fn(), trackScreenView: vi.fn(), trackTiming: vi.fn(),
}));

const result = (data: unknown) => ({ code: 0, stderr: "", stdout: JSON.stringify({ ok: true, data }) });

const pendingRequest: ProfileCreateRequest = {
  id: "req-1",
  name_prefix: "pixelscan-test",
  quantity: 3,
  country: "US",
  status: "pending",
  requested_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  bridge.invoke.mockReset();
  bridge.invoke.mockResolvedValue(null);
});

it("polls for pending batch profile-creation requests and surfaces them", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ authed: true, nextctlAvailable: true });
  bridge.invoke.mockImplementation((command, { args } = {}) => {
    if (command !== "nextctl_run") return Promise.resolve(null);
    if (args[0] === "profiles" && args[1] === "requests" && args[2] === "list") {
      return Promise.resolve(result({ requests: [pendingRequest] }));
    }
    return Promise.resolve(result({}));
  });

  await useStore.getState().pollProfileCreateRequests();

  expect(useStore.getState().pendingProfileCreateRequests).toEqual([pendingRequest]);
  const call = bridge.invoke.mock.calls.find(([, arg]) => arg?.args?.[0] === "profiles" && arg?.args?.[1] === "requests");
  expect(call?.[1].args).toEqual(["profiles", "requests", "list", "--status", "pending", "--format", "json"]);
});

it("keeps approval requests ready while the app is backgrounded", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ authed: true, nextctlAvailable: true, appActive: false });
  bridge.invoke.mockImplementation((command, { args } = {}) => {
    if (command === "nextctl_run" && args[0] === "profiles" && args[1] === "requests") {
      return Promise.resolve(result({ requests: [pendingRequest] }));
    }
    return Promise.resolve(null);
  });

  await useStore.getState().pollProfileCreateRequests();
  expect(useStore.getState().pendingProfileCreateRequests).toEqual([pendingRequest]);
});

it("does not poll while signed out", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ authed: false, nextctlAvailable: true });
  bridge.invoke.mockImplementation((command, { args } = {}) => {
    if (command !== "nextctl_run") return Promise.resolve(null);
    if (args[0] === "profiles" && args[1] === "requests") {
      throw new Error("must not poll while signed out");
    }
    return Promise.resolve(result({}));
  });

  await useStore.getState().pollProfileCreateRequests();

  expect(useStore.getState().pendingProfileCreateRequests).toEqual([]);
});

it("approving a request calls approve, clears it locally, and refreshes profiles", async () => {
  const { useStore } = await import("./store");
  useStore.setState({
    authed: true,
    nextctlAvailable: true,
    pendingProfileCreateRequests: [pendingRequest],
    activeWorkspaceId: "w",
    workspaces: [{ id: "w", name: "Test", profileNames: [], profileToolsets: {}, createdAt: 1, updatedAt: 1 }],
  });
  const approveCalls: string[][] = [];
  bridge.invoke.mockImplementation((command, { args } = {}) => {
    if (command !== "nextctl_run") return Promise.resolve(null);
    if (args[0] === "profiles" && args[1] === "requests" && args[2] === "approve") {
      approveCalls.push(args);
      return Promise.resolve(result({ status: "completed", runtime: "camoufox", created_profiles: ["pixelscan-test-1", "pixelscan-test-2", "pixelscan-test-3"] }));
    }
    if (args[0] === "profiles" && args[1] === "ls") {
      return Promise.resolve(result({
        profiles: [
          { name: "pixelscan-test-1" },
          { name: "pixelscan-test-2" },
          { name: "pixelscan-test-3" },
        ],
      }));
    }
    return Promise.resolve(result({ status: "stopped" }));
  });

  await useStore.getState().approveProfileCreateRequest("req-1");

  expect(approveCalls).toEqual([["profiles", "requests", "approve", "req-1", "--format", "json"]]);
  expect(useStore.getState().workspaces[0].profileToolsets["pixelscan-test-1"]).toBe("camoufox");
  expect(useStore.getState().pendingProfileCreateRequests).toEqual([]);
  expect(useStore.getState().profiles.map((p) => p.name)).toEqual([
    "pixelscan-test-1", "pixelscan-test-2", "pixelscan-test-3",
  ]);
});

it("declining a request calls reject with the reason and clears it locally without creating profiles", async () => {
  const { useStore } = await import("./store");
  useStore.setState({
    authed: true,
    nextctlAvailable: true,
    pendingProfileCreateRequests: [pendingRequest],
  });
  const rejectCalls: string[][] = [];
  bridge.invoke.mockImplementation((command, { args } = {}) => {
    if (command !== "nextctl_run") return Promise.resolve(null);
    if (args[0] === "profiles" && args[1] === "requests" && args[2] === "reject") {
      rejectCalls.push(args);
      return Promise.resolve(result({}));
    }
    return Promise.resolve(result({}));
  });

  await useStore.getState().rejectProfileCreateRequest("req-1", "not needed");

  expect(rejectCalls).toEqual([["profiles", "requests", "reject", "req-1", "--reason", "not needed"]]);
  expect(useStore.getState().pendingProfileCreateRequests).toEqual([]);
});
