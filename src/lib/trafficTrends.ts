import type { ProxyTrafficHistoryPoint } from "../types";

// Equal-length halves keep totals comparable for odd-length ranges too.
export function trafficTrends(points: ProxyTrafficHistoryPoint[]) {
  const days = Math.floor(points.length / 2);
  if (!days) return undefined;
  const stats = (rows: ProxyTrafficHistoryPoint[]) =>
    rows.reduce(
      (total, day) => ({
        traffic: total.traffic + day.used_bytes,
        requests: total.requests + day.requests,
        peak: Math.max(total.peak, day.used_bytes),
      }),
      { traffic: 0, requests: 0, peak: 0 },
    );
  const first = stats(points.slice(0, days));
  const last = stats(points.slice(-days));
  return {
    traffic: Math.sign(last.traffic - first.traffic),
    requests: Math.sign(last.requests - first.requests),
    peak: Math.sign(last.peak - first.peak),
  };
}
