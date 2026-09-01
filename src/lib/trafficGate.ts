import type { ProxyTraffic } from "../types";

/**
 * Free traffic gate.
 *
 * Every free account is shown the same 1 GiB allowance, but new accounts are
 * provisioned with a much smaller proxy limit. When that limit is reached the
 * traffic pauses and the account has to ask for the rest in Discord, where an
 * admin lifts the limit by hand.
 *
 * Accounts provisioned before the gate hold a limit at or above the allowance,
 * so they are never gated — the classification below is derived from
 * `limit_bytes` alone and needs no extra backend field.
 */
export const freeTrafficAllowanceBytes = 1024 * 1024 * 1024;

export type TrafficGateState =
  /** No proxy allocation is known yet. */
  | "unknown"
  /** The account has no enforced traffic limit at all. */
  | "unlimited"
  /** The account holds at least the full free allowance. */
  | "open"
  /** The account is inside the gate but still has traffic left. */
  | "gated"
  /** The gate closed: traffic is paused until an admin grants more. */
  | "blocked";

export function trafficGateState(proxyTraffic?: ProxyTraffic | null): TrafficGateState {
  if (!proxyTraffic) return "unknown";
  if (!proxyTraffic.limited) return "unlimited";
  if (proxyTraffic.limit_bytes == null) return "unknown";
  if (proxyTraffic.limit_bytes >= freeTrafficAllowanceBytes) return "open";

  const remainingBytes =
    proxyTraffic.remaining_bytes ?? proxyTraffic.limit_bytes - proxyTraffic.used_bytes;
  return remainingBytes > 0 ? "gated" : "blocked";
}

/** The allocation the account is shown: the free allowance while gated. */
export function trafficAllowanceBytes(proxyTraffic?: ProxyTraffic | null): number | null {
  switch (trafficGateState(proxyTraffic)) {
    case "gated":
    case "blocked":
      return freeTrafficAllowanceBytes;
    case "open":
      return proxyTraffic?.limit_bytes ?? null;
    default:
      return null;
  }
}

export function trafficAllowanceRemainingBytes(proxyTraffic?: ProxyTraffic | null): number | null {
  const allowanceBytes = trafficAllowanceBytes(proxyTraffic);
  if (allowanceBytes == null || !proxyTraffic) return null;
  return Math.max(allowanceBytes - proxyTraffic.used_bytes, 0);
}

export function trafficAllowanceFraction(proxyTraffic?: ProxyTraffic | null): number {
  const allowanceBytes = trafficAllowanceBytes(proxyTraffic);
  if (!allowanceBytes || !proxyTraffic) return 0;
  return Math.min(Math.max(proxyTraffic.used_bytes / allowanceBytes, 0), 1);
}

export function trafficGateStateLabel(proxyTraffic?: ProxyTraffic | null): string {
  const state = trafficGateState(proxyTraffic);
  if (state === "blocked") return "paused";
  if (state === "gated") return "ok";
  return proxyTraffic?.state ?? "unknown";
}
