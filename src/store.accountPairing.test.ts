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

const jsonResult = (data: unknown) => ({ code: 0, stderr: "", stdout: JSON.stringify({ ok: true, data }) });

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  bridge.invoke.mockReset();
  bridge.invoke.mockResolvedValue(null);
});

// Guards against the exact race NB-25647DEA-adjacent audit found: cancelling
// a pairing does not (and cannot) abort its in-flight "pairing_poll" call.
// If a second, different pairing is started before the first poll resolves,
// the stale response must not clobber the newer pairing's state or sign the
// session into the account the stale poll belongs to.
it("ignores a pairing_poll result for a pairing that was replaced while the request was in flight", async () => {
  const { useStore } = await import("./store");
  const staleKeyConfigCalls: unknown[] = [];
  const poll = deferred<{ pairing_id: string; kind: string; status: string; expires_at: string; poll_after_ms: number; api_key?: string }>();
  bridge.invoke.mockImplementation((command: string, payload?: { args?: string[] }) => {
    if (command === "pairing_poll") return poll.promise;
    if (command === "nextctl_run") {
      const args = payload?.args ?? [];
      if (args[0] === "config") staleKeyConfigCalls.push(args);
      if (args[0] === "identity") return Promise.resolve(jsonResult({ identity: { valid: true, owner_id: "stale-owner", email: "stale@example.com" } }));
      return Promise.resolve(jsonResult({}));
    }
    return Promise.resolve(null);
  });

  useStore.setState({
    accountPairing: { pairingId: "P1", verificationUrl: "https://example.com/p1", pollToken: "tok1", status: "pending", expiresAt: "2026-01-01T00:00:00Z" },
  });
  const stalePoll = useStore.getState().pollAccountPairing();
  await vi.waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith("pairing_poll", expect.objectContaining({ pairingId: "P1" })));

  // The user cancelled P1 and started a different pairing (P2) before the
  // stale P1 poll resolved.
  useStore.setState({
    accountPairing: { pairingId: "P2", verificationUrl: "https://example.com/p2", pollToken: "tok2", status: "pending", expiresAt: "2026-01-01T00:05:00Z" },
    authed: false,
  });

  // The stale P1 poll now resolves as completed with an api_key — it must
  // not be applied.
  poll.resolve({ pairing_id: "P1", kind: "browser", status: "completed", expires_at: "2026-01-01T00:00:00Z", poll_after_ms: 2000, api_key: "stale-account-key" });
  await stalePoll;

  expect(useStore.getState().authed).toBe(false);
  expect(useStore.getState().accountPairing?.pairingId).toBe("P2");
  expect(useStore.getState().accountPairing?.status).toBe("pending");
  expect(staleKeyConfigCalls.length).toBe(0);
});

it("applies a pairing_poll result normally when the pairing has not changed", async () => {
  const { useStore } = await import("./store");
  bridge.invoke.mockImplementation((command: string, payload?: { args?: string[] }) => {
    if (command === "pairing_poll") {
      return Promise.resolve({ pairing_id: "P1", kind: "browser", status: "pending", expires_at: "2026-01-01T00:10:00Z", poll_after_ms: 2000 });
    }
    if (command === "nextctl_run") {
      const args = payload?.args ?? [];
      if (args[0] === "identity") return Promise.resolve(jsonResult({ identity: { valid: true, owner_id: "owner-1", email: "a@example.com" } }));
      return Promise.resolve(jsonResult({}));
    }
    return Promise.resolve(null);
  });

  useStore.setState({
    accountPairing: { pairingId: "P1", verificationUrl: "https://example.com/p1", pollToken: "tok1", status: "pending", expiresAt: "2026-01-01T00:00:00Z" },
  });
  await useStore.getState().pollAccountPairing();

  expect(useStore.getState().accountPairing?.expiresAt).toBe("2026-01-01T00:10:00Z");
});

it("restores cloud workspaces and projects after browser sign-in", async () => {
  const { useStore } = await import("./store");
  const syncProjects = vi.fn().mockResolvedValue(undefined);
  useStore.setState({
    accountPairing: { pairingId: "P1", verificationUrl: "https://example.com/p1", pollToken: "tok1", status: "pending", expiresAt: "2026-01-01T00:00:00Z" },
    syncProjects,
    startTimers: vi.fn(),
    refreshAll: vi.fn().mockResolvedValue(undefined),
    authorizeAgent: vi.fn().mockResolvedValue(undefined),
  });
  bridge.invoke.mockImplementation((command: string, payload?: { args?: string[] }) => {
    if (command === "pairing_poll") return Promise.resolve({ pairing_id: "P1", kind: "browser", status: "completed", expires_at: "2026-01-01T00:10:00Z", poll_after_ms: 2000, api_key: "qa-key" });
    if (command === "nextctl_run") {
      if (payload?.args?.[0] === "identity") return Promise.resolve(jsonResult({ identity: { valid: true, owner_id: "owner-1", email: "a@example.com" } }));
      return Promise.resolve(jsonResult({}));
    }
    return Promise.resolve(null);
  });

  await useStore.getState().pollAccountPairing();

  expect(useStore.getState().authed).toBe(true);
  expect(syncProjects).toHaveBeenCalledOnce();
});
