import { beforeEach, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("./electronBridge", () => ({ ...bridge, filePathForFile: () => "" }));
vi.mock("./lib/analytics", () => ({ setAnalyticsUserId: vi.fn(), trackEvent: vi.fn(), trackScreenView: vi.fn(), trackTiming: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  bridge.invoke.mockReset();
  bridge.invoke.mockResolvedValue(null);
});

it("creates a schedule without chosen days as every day, weekends included", async () => {
  const { useStore } = await import("./store");
  useStore.setState({ agentId: "codex", activeWorkspaceId: "w-sched", scheduledRuns: [] });
  useStore.getState().addScheduledRun({ title: "GitHub star", prompt: "Check GitHub star for nextbrowser project.", hour: 9, minute: 0, weekdays: [] });
  expect(useStore.getState().scheduledRuns[0].weekdays).toEqual([1, 2, 3, 4, 5, 6, 7]);
});
