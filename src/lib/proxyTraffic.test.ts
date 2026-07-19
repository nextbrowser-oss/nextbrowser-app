import { describe, expect, it } from "vitest";
import type { ProxyTrafficDomainBreakdown } from "../types";
import {
  domainsByTraffic,
  isProxyTrafficHistoryRangeValid,
  proxyTrafficHistoryMaxDays,
  proxyTrafficHistoryPresetDays,
  proxyTrafficTopUpBytes,
  proxyTrafficTopUpThresholdBytes,
  shouldShowProxyTrafficTopUp,
  sortDomainsByTraffic,
} from "./proxyTraffic";

describe("proxy traffic history range", () => {
  it("offers ranges through one year", () => {
    expect(proxyTrafficHistoryPresetDays).toEqual([7, 14, 30, 90, 180, 365]);
    expect(proxyTrafficHistoryMaxDays).toBe(365);
  });

  it("accepts 365 inclusive days and rejects 366", () => {
    expect(isProxyTrafficHistoryRangeValid("2025-07-20", "2026-07-19")).toBe(true);
    expect(isProxyTrafficHistoryRangeValid("2025-07-19", "2026-07-19")).toBe(false);
  });

  it("rejects reversed and invalid ranges", () => {
    expect(isProxyTrafficHistoryRangeValid("2026-07-20", "2026-07-19")).toBe(false);
    expect(isProxyTrafficHistoryRangeValid("", "2026-07-19")).toBe(false);
  });
});

describe("proxy traffic domain sorting", () => {
  it("sorts domains by transferred bytes in descending order without mutating the response", () => {
    const domains: ProxyTrafficDomainBreakdown[] = [
      { domain: "small.example", used_bytes: 2_100_000, requests: 127 },
      { domain: "large.example", used_bytes: 21_000_000, requests: 43 },
      { domain: "medium.example", used_bytes: 8_100_000, requests: 1_205 },
    ];

    expect(sortDomainsByTraffic(domains).map((domain) => domain.domain)).toEqual([
      "large.example",
      "medium.example",
      "small.example",
    ]);
    expect(domains.map((domain) => domain.domain)).toEqual([
      "small.example",
      "large.example",
      "medium.example",
    ]);
  });

  it("shows the top 10 by default and every returned domain when expanded", () => {
    const domains: ProxyTrafficDomainBreakdown[] = Array.from({ length: 12 }, (_, index) => ({
      domain: `domain-${index}.example`,
      used_bytes: index,
      requests: index,
    }));

    expect(domainsByTraffic(domains, false).map((domain) => domain.used_bytes)).toEqual([
      11, 10, 9, 8, 7, 6, 5, 4, 3, 2,
    ]);
    expect(domainsByTraffic(domains, true)).toHaveLength(12);
  });
});

describe("proxy traffic top-up", () => {
  it("matches the dashboard top-up cycle at 3 GB boundaries", () => {
    expect(shouldShowProxyTrafficTopUp({
      limited: true,
      used_bytes: 3 * proxyTrafficTopUpBytes - proxyTrafficTopUpThresholdBytes - 1,
      limit_bytes: 3 * proxyTrafficTopUpBytes,
      remaining_bytes: proxyTrafficTopUpThresholdBytes + 1,
      state: "ok",
    })).toBe(false);
    expect(shouldShowProxyTrafficTopUp({
      limited: true,
      used_bytes: 3 * proxyTrafficTopUpBytes - proxyTrafficTopUpThresholdBytes,
      limit_bytes: 3 * proxyTrafficTopUpBytes,
      remaining_bytes: proxyTrafficTopUpThresholdBytes,
      state: "near_limit",
    })).toBe(true);
    expect(shouldShowProxyTrafficTopUp({
      limited: true,
      used_bytes: proxyTrafficTopUpBytes,
      limit_bytes: 4 * proxyTrafficTopUpBytes,
      remaining_bytes: 3 * proxyTrafficTopUpBytes,
      state: "ok",
    })).toBe(true);
  });

  it("hides top-up for unlimited traffic", () => {
    expect(shouldShowProxyTrafficTopUp({
      limited: false,
      used_bytes: proxyTrafficTopUpBytes,
      state: "ok",
    })).toBe(false);
  });
});
