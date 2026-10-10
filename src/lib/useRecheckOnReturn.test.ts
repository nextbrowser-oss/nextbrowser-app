import { describe, expect, it, vi } from "vitest";
import { returnWatch } from "./useRecheckOnReturn";

describe("returnWatch", () => {
  it("reads nothing until Open armed it", async () => {
    const recheck = vi.fn(async () => true);
    const watch = returnWatch(1000, () => 0);
    expect(await watch.onReturn(true, recheck)).toBe(false);
    expect(recheck).not.toHaveBeenCalled();
  });

  it("reads on every return until a read finds the sign-in", async () => {
    const answers = [undefined, false, true];
    const recheck = vi.fn(async () => answers.shift());
    const watch = returnWatch(1000, () => 0);
    watch.arm();
    expect(await watch.onReturn(true, recheck)).toBe(true);
    expect(await watch.onReturn(true, recheck)).toBe(true);
    expect(await watch.onReturn(true, recheck)).toBe(true);
    expect(await watch.onReturn(true, recheck)).toBe(false);
    expect(recheck).toHaveBeenCalledTimes(3);
  });

  it("skips a hidden window, a read already running and an expired watch", async () => {
    let clock = 0;
    let release: (value: boolean) => void = () => {};
    const recheck = vi.fn(() => new Promise<boolean>((resolve) => { release = resolve; }));
    const watch = returnWatch(1000, () => clock);
    watch.arm();
    expect(await watch.onReturn(false, recheck)).toBe(false);
    const first = watch.onReturn(true, recheck);
    expect(await watch.onReturn(true, recheck)).toBe(false);
    release(false);
    expect(await first).toBe(true);
    clock = 1001;
    expect(await watch.onReturn(true, recheck)).toBe(false);
    expect(recheck).toHaveBeenCalledTimes(1);
  });

  it("treats a failed read as no answer", async () => {
    const recheck = vi.fn().mockRejectedValueOnce(new Error("CDP_UNREACHABLE")).mockResolvedValueOnce(true);
    const watch = returnWatch(1000, () => 0);
    watch.arm();
    expect(await watch.onReturn(true, recheck)).toBe(true);
    expect(await watch.onReturn(true, recheck)).toBe(true);
    expect(await watch.onReturn(true, recheck)).toBe(false);
  });
});
