import { describe, expect, it } from "vitest";
import type { ProxyTraffic } from "../types";
import {
  freeTrafficAllowanceBytes,
  trafficAllowanceBytes,
  trafficAllowanceFraction,
  trafficAllowanceRemainingBytes,
  trafficGateState,
  trafficGateStateLabel,
} from "./trafficGate";

const mebibyte = 1024 * 1024;

function proxy(overrides: Partial<ProxyTraffic>): ProxyTraffic {
  return {
    limited: true,
    used_bytes: 0,
    state: "ok",
    ...overrides,
  };
}

describe("free traffic allowance", () => {
  it("shows every free account the same 1 GiB", () => {
    expect(freeTrafficAllowanceBytes).toBe(1024 * mebibyte);
  });
});

describe("traffic gate state", () => {
  it("gates a new account until its provisioned limit runs out", () => {
    expect(trafficGateState(proxy({
      used_bytes: 12 * mebibyte,
      limit_bytes: 37 * mebibyte,
      remaining_bytes: 25 * mebibyte,
    }))).toBe("gated");
    expect(trafficGateState(proxy({
      used_bytes: 37 * mebibyte,
      limit_bytes: 37 * mebibyte,
      remaining_bytes: 0,
      state: "exhausted",
    }))).toBe("blocked");
  });

  it("derives the remaining bytes when the backend omits them", () => {
    expect(trafficGateState(proxy({ used_bytes: 70 * mebibyte, limit_bytes: 70 * mebibyte })))
      .toBe("blocked");
  });

  it("never gates accounts that already hold the full allowance", () => {
    expect(trafficGateState(proxy({
      used_bytes: 3 * 1024 * mebibyte,
      limit_bytes: 3 * 1024 * mebibyte,
      remaining_bytes: 0,
      state: "exhausted",
    }))).toBe("open");
    expect(trafficGateState(proxy({ used_bytes: 0, limit_bytes: freeTrafficAllowanceBytes })))
      .toBe("open");
  });

  it("reports unlimited and unknown allocations", () => {
    expect(trafficGateState(proxy({ limited: false, used_bytes: 5 * mebibyte }))).toBe("unlimited");
    expect(trafficGateState(proxy({ used_bytes: 5 * mebibyte }))).toBe("unknown");
    expect(trafficGateState(undefined)).toBe("unknown");
  });
});

describe("displayed allowance", () => {
  it("shows a gated account the full free allowance", () => {
    const gated = proxy({
      used_bytes: 37 * mebibyte,
      limit_bytes: 37 * mebibyte,
      remaining_bytes: 0,
      percent_used: 100,
      state: "exhausted",
    });

    expect(trafficAllowanceBytes(gated)).toBe(freeTrafficAllowanceBytes);
    expect(trafficAllowanceRemainingBytes(gated)).toBe(freeTrafficAllowanceBytes - 37 * mebibyte);
    expect(Math.round(trafficAllowanceFraction(gated) * 100)).toBe(4);
    expect(trafficGateStateLabel(gated)).toBe("paused");
  });

  it("keeps the provider allocation for accounts outside the gate", () => {
    const open = proxy({
      used_bytes: 1536 * mebibyte,
      limit_bytes: 3 * 1024 * mebibyte,
      remaining_bytes: 1536 * mebibyte,
      percent_used: 50,
    });

    expect(trafficAllowanceBytes(open)).toBe(3 * 1024 * mebibyte);
    expect(trafficAllowanceRemainingBytes(open)).toBe(1536 * mebibyte);
    expect(trafficAllowanceFraction(open)).toBe(0.5);
    expect(trafficGateStateLabel(open)).toBe("ok");
  });

  it("has no allowance to show for unlimited accounts", () => {
    const unlimited = proxy({ limited: false, used_bytes: 5 * mebibyte });
    expect(trafficAllowanceBytes(unlimited)).toBeNull();
    expect(trafficAllowanceRemainingBytes(unlimited)).toBeNull();
    expect(trafficAllowanceFraction(unlimited)).toBe(0);
  });
});
