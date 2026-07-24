import { beforeEach, describe, expect, it, vi } from "vitest";
import { cancelNextctlRun, nextctlRun } from "./nextctl";

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("./electronBridge", () => ({
  invoke: bridge.invoke,
}));

describe("nextctl cancellable commands", () => {
  beforeEach(() => bridge.invoke.mockReset());

  it("sends a bounded timeout and request id to Electron", async () => {
    bridge.invoke.mockResolvedValue({ stdout: "", stderr: "", code: 0 });

    await nextctlRun(
      ["profiles", "create", "demo"],
      undefined,
      { requestId: "profile-create-demo", timeoutMs: 30_000 },
    );

    expect(bridge.invoke).toHaveBeenCalledWith("nextctl_run", {
      args: ["profiles", "create", "demo"],
      extraEnv: null,
      requestId: "profile-create-demo",
      timeoutMs: 30_000,
    });
  });

  it("cancels the matching Electron command", async () => {
    bridge.invoke.mockResolvedValue(true);

    await expect(cancelNextctlRun("profile-create-demo")).resolves.toBe(true);
    expect(bridge.invoke).toHaveBeenCalledWith("nextctl_cancel", {
      requestId: "profile-create-demo",
    });
  });
});
