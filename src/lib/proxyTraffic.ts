import {
  proxyFraction,
  type ProxyTraffic,
  type ProxyTrafficDomainBreakdown,
  type ProxyTrafficHistory,
  type ProxyTrafficHistoryPoint,
  type ProxyTrafficSourceBreakdown,
} from "../types";

export const proxyTrafficDomainsPageSize = 10;
export const proxyTrafficHistoryMaxDays = 365;
export const proxyTrafficHistoryPresetDays = [7, 14, 30, 90, 180, 365] as const;
export const proxyTrafficHistoryRequestDays = 30;
export const proxyTrafficTopUpBytes = 1024 * 1024 * 1024;
export const proxyTrafficTopUpCycleSize = 3;
export const proxyTrafficTopUpThresholdBytes = 100 * 1024 * 1024;

const millisecondsPerDay = 86_400_000;

export type ProxyTrafficHistoryPreset = typeof proxyTrafficHistoryPresetDays[number];

export interface ProxyTrafficHistoryWindow {
  from: string;
  to: string;
}

const historyDatePattern = /^(\d{4})[.-](\d{1,2})[.-](\d{1,2})$/;

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function shiftISODate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function historyPointDate(
  label: string,
  history: ProxyTrafficHistory,
): string | undefined {
  const value = label.trim();
  const match = historyDatePattern.exec(value);
  if (match) {
    const candidate = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    const parsed = new Date(`${candidate}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && isoDate(parsed) === candidate ? candidate : undefined;
  }

  const fromYear = Number(history.from.slice(0, 4));
  const toYear = Number(history.to.slice(0, 4));
  for (let year = fromYear; year <= toYear; year += 1) {
    const parsed = new Date(`${value} ${year} 12:00:00`);
    if (Number.isNaN(parsed.getTime())) continue;
    const candidate = isoDate(new Date(Date.UTC(
      parsed.getFullYear(),
      parsed.getMonth(),
      parsed.getDate(),
    )));
    if (candidate >= history.from && candidate <= history.to) return candidate;
  }
  return undefined;
}

export function isProxyTrafficHistoryRangeValid(from: string, to: string): boolean {
  const fromTime = Date.parse(`${from}T00:00:00Z`);
  const toTime = Date.parse(`${to}T00:00:00Z`);
  const rangeDays = (toTime - fromTime) / millisecondsPerDay + 1;
  return Number.isInteger(rangeDays) && rangeDays >= 1 && rangeDays <= proxyTrafficHistoryMaxDays;
}

export function proxyTrafficHistoryWindows(
  from: string,
  to: string,
): ProxyTrafficHistoryWindow[] {
  if (!isProxyTrafficHistoryRangeValid(from, to)) return [];

  const windows: ProxyTrafficHistoryWindow[] = [];
  let cursor = from;
  while (cursor <= to) {
    const windowEnd = shiftISODate(cursor, proxyTrafficHistoryRequestDays - 1);
    const end = windowEnd < to ? windowEnd : to;
    windows.push({ from: cursor, to: end });
    cursor = shiftISODate(end, 1);
  }
  return windows;
}

export function mergeProxyTrafficHistories(
  histories: ProxyTrafficHistory[],
  from: string,
  to: string,
  timezone: string,
): ProxyTrafficHistory {
  const points = new Map<string, ProxyTrafficHistoryPoint>();
  const sources = new Map<ProxyTrafficSourceBreakdown["source"], ProxyTrafficSourceBreakdown>();
  const domains = new Map<string, ProxyTrafficDomainBreakdown>();

  for (const history of histories) {
    for (const point of history.data_points) {
      const day = historyPointDate(point.label, history);
      if (!day || day < from || day > to) continue;
      const existing = points.get(day);
      points.set(day, {
        label: day,
        used_bytes: (existing?.used_bytes ?? 0) + point.used_bytes,
        requests: (existing?.requests ?? 0) + point.requests,
      });
    }
    for (const source of history.sources) {
      const existing = sources.get(source.source);
      sources.set(source.source, {
        source: source.source,
        used_bytes: (existing?.used_bytes ?? 0) + source.used_bytes,
        requests: (existing?.requests ?? 0) + source.requests,
      });
    }
    for (const domain of history.top_domains) {
      const existing = domains.get(domain.domain);
      domains.set(domain.domain, {
        domain: domain.domain,
        used_bytes: (existing?.used_bytes ?? 0) + domain.used_bytes,
        requests: (existing?.requests ?? 0) + domain.requests,
      });
    }
  }

  const dataPoints: ProxyTrafficHistoryPoint[] = [];
  for (let day = from; day <= to; day = shiftISODate(day, 1)) {
    dataPoints.push(points.get(day) ?? { label: day, used_bytes: 0, requests: 0 });
  }

  return {
    from,
    to,
    timezone,
    total_bytes: dataPoints.reduce((total, point) => total + point.used_bytes, 0),
    total_requests: dataPoints.reduce((total, point) => total + point.requests, 0),
    data_points: dataPoints,
    sources: [...sources.values()],
    top_domains: [...domains.values()],
  };
}

export function shouldShowProxyTrafficTopUp(proxyTraffic?: ProxyTraffic | null): boolean {
  if (!proxyTraffic?.limited || proxyTraffic.limit_bytes == null) {
    return false;
  }

  const remainingBytes =
    proxyTraffic.remaining_bytes ?? proxyTraffic.limit_bytes - proxyTraffic.used_bytes;
  const topUpCount = Math.floor(proxyTraffic.limit_bytes / proxyTrafficTopUpBytes);
  return (
    topUpCount % proxyTrafficTopUpCycleSize !== 0
    || remainingBytes <= proxyTrafficTopUpThresholdBytes
  );
}

export function proxyTrafficWarning(proxyTraffic: ProxyTraffic): string | undefined {
  const fraction = proxyFraction(proxyTraffic);
  if (fraction >= 1) return "Proxy traffic limit reached. Add data in Usage.";
  if (fraction >= 0.9) return "Proxy traffic almost exhausted.";
  return undefined;
}

export function sortDomainsByTraffic(
  domains: ProxyTrafficDomainBreakdown[],
): ProxyTrafficDomainBreakdown[] {
  return domains.slice().sort((left, right) => right.used_bytes - left.used_bytes);
}

export function domainsPageByTraffic(
  domains: ProxyTrafficDomainBreakdown[],
  requestedPage: number,
): {
  domains: ProxyTrafficDomainBreakdown[];
  page: number;
  pageCount: number;
} {
  const sorted = sortDomainsByTraffic(domains);
  const pageCount = Math.ceil(sorted.length / proxyTrafficDomainsPageSize);
  const page = Math.min(Math.max(Math.trunc(requestedPage) || 1, 1), Math.max(pageCount, 1));
  const offset = (page - 1) * proxyTrafficDomainsPageSize;

  return {
    domains: sorted.slice(offset, offset + proxyTrafficDomainsPageSize),
    page,
    pageCount,
  };
}

export function domainPaginationItems(
  currentPage: number,
  pageCount: number,
): Array<number | "ellipsis"> {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const pages = currentPage <= 4
    ? [1, 2, 3, 4, 5, pageCount]
    : currentPage >= pageCount - 3
      ? [1, pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount]
      : [1, currentPage - 1, currentPage, currentPage + 1, pageCount];

  return pages.flatMap((page, index) => (
    index > 0 && page - pages[index - 1] > 1 ? ["ellipsis", page] : [page]
  ));
}
