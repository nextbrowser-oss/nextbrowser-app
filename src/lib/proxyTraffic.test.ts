import { describe, expect, it } from "vitest";
import type { ProxyTrafficDomainBreakdown } from "../types";
import {
  domainPaginationItems,
  domainsPageByTraffic,
  isProxyTrafficHistoryRangeValid,
  mergeProxyTrafficHistories,
  proxyTrafficHistoryCoverage,
  proxyTrafficHistoryMaxDays,
  proxyTrafficHistoryPresetDays,
  proxyTrafficHistoryRequestDays,
  proxyTrafficHistoryWindows,
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

  it("splits long ranges into provider-safe windows", () => {
    expect(proxyTrafficHistoryRequestDays).toBe(30);
    expect(proxyTrafficHistoryWindows("2026-04-23", "2026-07-21")).toEqual([
      { from: "2026-04-23", to: "2026-05-22" },
      { from: "2026-05-23", to: "2026-06-21" },
      { from: "2026-06-22", to: "2026-07-21" },
    ]);
    expect(proxyTrafficHistoryWindows("2025-07-22", "2026-07-21")).toHaveLength(13);
    expect(proxyTrafficHistoryWindows("2025-07-22", "2026-07-21").at(-1)).toEqual({
      from: "2026-07-17",
      to: "2026-07-21",
    });
  });

  it("classifies complete, partial, and unavailable history loads", () => {
    expect(proxyTrafficHistoryCoverage(3, 3)).toBe("complete");
    expect(proxyTrafficHistoryCoverage(3, 2)).toBe("partial");
    expect(proxyTrafficHistoryCoverage(3, 0)).toBe("unavailable");
    expect(proxyTrafficHistoryCoverage(0, 0)).toBe("unavailable");
  });

  it("merges available backend windows and fills missing days with zeroes", () => {
    const history = mergeProxyTrafficHistories([
      {
        from: "2026-07-01",
        to: "2026-07-02",
        timezone: "Asia/Tbilisi",
        total_bytes: 100,
        total_requests: 2,
        data_points: [{ label: "2026.07.02", used_bytes: 100, requests: 2 }],
        sources: [{ source: "proxy", used_bytes: 100, requests: 2 }],
        top_domains: [{ domain: "example.com", used_bytes: 100, requests: 2 }],
      },
      {
        from: "2026-07-04",
        to: "2026-07-05",
        timezone: "Asia/Tbilisi",
        total_bytes: 250,
        total_requests: 5,
        data_points: [{ label: "2026-07-05", used_bytes: 250, requests: 5 }],
        sources: [{ source: "proxy", used_bytes: 250, requests: 5 }],
        top_domains: [
          { domain: "example.com", used_bytes: 200, requests: 4 },
          { domain: "another.example", used_bytes: 50, requests: 1 },
        ],
      },
    ], "2026-07-01", "2026-07-05", "Asia/Tbilisi");

    expect(history.data_points).toEqual([
      { label: "2026-07-01", used_bytes: 0, requests: 0 },
      { label: "2026-07-02", used_bytes: 100, requests: 2 },
      { label: "2026-07-03", used_bytes: 0, requests: 0 },
      { label: "2026-07-04", used_bytes: 0, requests: 0 },
      { label: "2026-07-05", used_bytes: 250, requests: 5 },
    ]);
    expect(history).toMatchObject({ total_bytes: 350, total_requests: 7 });
    expect(history.sources).toEqual([{ source: "proxy", used_bytes: 350, requests: 7 }]);
    expect(history.top_domains).toEqual([
      { domain: "example.com", used_bytes: 300, requests: 6 },
      { domain: "another.example", used_bytes: 50, requests: 1 },
    ]);
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

  it("paginates every returned domain in traffic order", () => {
    const domains: ProxyTrafficDomainBreakdown[] = Array.from({ length: 23 }, (_, index) => ({
      domain: `domain-${index}.example`,
      used_bytes: index,
      requests: index,
    }));

    expect(domainsPageByTraffic(domains, 1)).toMatchObject({
      page: 1,
      pageCount: 3,
      domains: [
        { used_bytes: 22 },
        { used_bytes: 21 },
        { used_bytes: 20 },
        { used_bytes: 19 },
        { used_bytes: 18 },
        { used_bytes: 17 },
        { used_bytes: 16 },
        { used_bytes: 15 },
        { used_bytes: 14 },
        { used_bytes: 13 },
      ],
    });
    expect(domainsPageByTraffic(domains, 2).domains.map((domain) => domain.used_bytes)).toEqual([
      12, 11, 10, 9, 8, 7, 6, 5, 4, 3,
    ]);
    expect(domainsPageByTraffic(domains, 3).domains.map((domain) => domain.used_bytes)).toEqual([2, 1, 0]);
  });

  it("keeps an out-of-range page on the nearest available page", () => {
    const domains: ProxyTrafficDomainBreakdown[] = Array.from({ length: 12 }, (_, index) => ({
      domain: `domain-${index}.example`,
      used_bytes: index,
      requests: index,
    }));

    expect(domainsPageByTraffic(domains, 99)).toMatchObject({ page: 2, pageCount: 2 });
    expect(domainsPageByTraffic(domains, 0)).toMatchObject({ page: 1, pageCount: 2 });
  });

  it("keeps long domain pagination compact around the current page", () => {
    expect(domainPaginationItems(1, 10)).toEqual([1, 2, 3, 4, 5, "ellipsis", 10]);
    expect(domainPaginationItems(5, 10)).toEqual([1, "ellipsis", 4, 5, 6, "ellipsis", 10]);
    expect(domainPaginationItems(10, 10)).toEqual([1, "ellipsis", 6, 7, 8, 9, 10]);
    expect(domainPaginationItems(2, 3)).toEqual([1, 2, 3]);
  });
});

describe("proxy traffic top-up", () => {
  it("matches the dashboard top-up cycle at 3 GiB boundaries", () => {
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
