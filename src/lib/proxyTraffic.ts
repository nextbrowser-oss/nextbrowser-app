import { proxyFraction, type ProxyTraffic, type ProxyTrafficDomainBreakdown } from "../types";

export const topDomainsPreviewCount = 10;
export const proxyTrafficHistoryMaxDays = 365;
export const proxyTrafficHistoryPresetDays = [7, 14, 30, 90, 180, 365] as const;
export const proxyTrafficTopUpBytes = 1024 * 1024 * 1024;
export const proxyTrafficTopUpCycleSize = 3;
export const proxyTrafficTopUpThresholdBytes = 100 * 1024 * 1024;

const millisecondsPerDay = 86_400_000;

export type ProxyTrafficHistoryPreset = typeof proxyTrafficHistoryPresetDays[number];

export function isProxyTrafficHistoryRangeValid(from: string, to: string): boolean {
  const fromTime = Date.parse(`${from}T00:00:00Z`);
  const toTime = Date.parse(`${to}T00:00:00Z`);
  const rangeDays = (toTime - fromTime) / millisecondsPerDay + 1;
  return Number.isInteger(rangeDays) && rangeDays >= 1 && rangeDays <= proxyTrafficHistoryMaxDays;
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

export function domainsByTraffic(
  domains: ProxyTrafficDomainBreakdown[],
  expanded: boolean,
): ProxyTrafficDomainBreakdown[] {
  const sorted = sortDomainsByTraffic(domains);
  return expanded ? sorted : sorted.slice(0, topDomainsPreviewCount);
}
