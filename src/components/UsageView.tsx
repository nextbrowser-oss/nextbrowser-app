import { useEffect, useMemo, useState } from "react";
import { nextctlJson } from "../nextctl";
import { useStore } from "../store";
import { trackEvent } from "../lib/analytics";
import {
  humanBytes,
  proxyFraction,
  type ProxyTrafficHistory,
  type ProxyTrafficHistoryPoint,
  type UsageSnapshot,
} from "../types";
import { Icon, Spinner } from "./Icon";

type HistorySource = "backend" | "local";
type RangePreset = 7 | 14 | 30 | "custom";

const numberFormatter = new Intl.NumberFormat();

function dateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateValue(date);
}

function localHistory(
  snapshots: UsageSnapshot[],
  from: string,
  to: string,
  timezone: string,
): ProxyTrafficHistory {
  const fromTime = new Date(`${from}T00:00:00`).getTime();
  const toTime = new Date(`${to}T23:59:59.999`).getTime();
  const sorted = snapshots.slice().sort((left, right) => left.date - right.date);
  const baseline = sorted.filter((snapshot) => snapshot.date < fromTime).at(-1);
  const daily = new Map<string, UsageSnapshot>();
  for (const snapshot of sorted) {
    if (snapshot.date < fromTime || snapshot.date > toTime) continue;
    daily.set(dateValue(new Date(snapshot.date)), snapshot);
  }

  let previous = baseline?.usedBytes;
  const dataPoints: ProxyTrafficHistoryPoint[] = [];
  for (const [day, snapshot] of daily) {
    const usedBytes = previous == null ? 0 : Math.max(snapshot.usedBytes - previous, 0);
    dataPoints.push({ label: day, used_bytes: usedBytes, requests: 0 });
    previous = snapshot.usedBytes;
  }
  const totalBytes = dataPoints.reduce((total, point) => total + point.used_bytes, 0);

  return {
    from,
    to,
    timezone,
    total_bytes: totalBytes,
    total_requests: 0,
    data_points: dataPoints,
    sources: [],
    top_domains: [],
  };
}

function peakPoint(points: ProxyTrafficHistoryPoint[]): ProxyTrafficHistoryPoint | undefined {
  return points.reduce<ProxyTrafficHistoryPoint | undefined>(
    (peak, point) => (!peak || point.used_bytes > peak.used_bytes ? point : peak),
    undefined,
  );
}

function shortLabel(label: string): string {
  const parsed = new Date(`${label}T12:00:00`);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return label.length > 7 ? label.slice(0, 7) : label;
}

export function UsageView() {
  const s = useStore();
  const today = useMemo(() => dateValue(new Date()), []);
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );
  const [preset, setPreset] = useState<RangePreset>(7);
  const [from, setFrom] = useState(() => shiftDate(today, -6));
  const [to, setTo] = useState(today);
  const [history, setHistory] = useState<ProxyTrafficHistory>();
  const [historySource, setHistorySource] = useState<HistorySource>("backend");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyNotice, setHistoryNotice] = useState<string>();
  const [historyReload, setHistoryReload] = useState(0);
  const fraction = proxyFraction(s.proxy);

  useEffect(() => {
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    const rangeDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    if (Number.isNaN(rangeDays) || rangeDays < 0 || rangeDays > 30) {
      setHistory(undefined);
      setHistoryNotice("Choose a valid range of up to 30 days.");
      setHistoryLoading(false);
      return;
    }

    let cancelled = false;
    setHistoryLoading(true);
    setHistoryNotice(undefined);
    void nextctlJson<{ proxy_traffic_history: ProxyTrafficHistory }>([
      "proxy-traffic",
      "--from",
      from,
      "--to",
      to,
      "--timezone",
      timezone,
    ])
      .then((payload) => {
        if (cancelled) return;
        setHistory(payload.proxy_traffic_history);
        setHistorySource("backend");
      })
      .catch(() => {
        if (cancelled) return;
        setHistory(localHistory(s.usageHistory, from, to, timezone));
        setHistorySource("local");
        setHistoryNotice("Backend analytics are unavailable. Showing locally recorded traffic changes.");
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, historyReload, s.usageHistory, timezone, to]);

  const applyPreset = (days: 7 | 14 | 30) => {
    setPreset(days);
    setTo(today);
    setFrom(shiftDate(today, -(days - 1)));
  };
  const refreshUsage = async () => {
    await s.refreshProxyData();
    setHistoryReload((value) => value + 1);
  };
  const points = history?.data_points ?? [];
  const maximumBytes = Math.max(...points.map((point) => point.used_bytes), 1);
  const peak = peakPoint(points);
  const averageBytes = points.length ? (history?.total_bytes ?? 0) / points.length : 0;
  const runningSessions = Object.values(s.statuses).filter((status) => status === "running").length
    + (s.defaultSession?.status === "running" ? 1 : 0);
  const currentRuntime = runningSessions
    ? s.defaultSession?.backend || "Clawbrowser"
    : "No active session";

  return (
    <div className="page proxy-usage-page">
      <div className="proxy-usage-header">
        <div>
          <h2>Proxy usage</h2>
          <p className="muted">Traffic, requests, sources, and top domains from NodeMaven.</p>
        </div>
        <button className="btn-bordered" disabled={s.isRefreshing} onClick={() => void refreshUsage()}>
          {s.isRefreshing ? <Spinner size={13} /> : <Icon name="arrow.clockwise" size={13} />}
          Refresh
        </button>
      </div>

      <div className="claw-card control-card proxy-card proxy-usage-card">
        <div className="row section-row">
          <div>
            <div className="section">CURRENT ALLOCATION</div>
            <div className="proxy-usage-current-title">
              {s.proxy ? humanBytes(s.proxy.used_bytes) : "Usage locked"}
              <span className="muted"> / {s.proxy?.limit_bytes ? humanBytes(s.proxy.limit_bytes) : "unlimited"}</span>
            </div>
          </div>
          {s.proxy && <span className="status-pill proxy-state">{s.proxy.state}</span>}
        </div>
        {s.proxy ? (
          <>
            <div className="bar proxy-usage-progress">
              <div
                className="bar-fill"
                style={{
                  width: `${fraction * 100}%`,
                  background:
                    fraction >= 1
                      ? "var(--red)"
                      : fraction >= 0.9
                        ? "#ff9500"
                        : fraction >= 0.7
                          ? "#ffd60a"
                          : undefined,
                }}
              />
            </div>
            <div className="row small proxy-usage-allocation-meta">
              <span>{s.proxy.percent_used == null ? "Unlimited plan" : `${Math.round(s.proxy.percent_used)}% used`}</span>
              <span className="spacer" />
              {s.proxy.remaining_bytes != null && <span>{humanBytes(s.proxy.remaining_bytes)} remaining</span>}
            </div>
            {s.proxyWarning && (
              <div className="warning-banner">
                <Icon name="exclamationmark.triangle.fill" size={14} />
                {s.proxyWarning}
              </div>
            )}
            {s.proxy.dashboard_url && (
              <a
                className="link small"
                href={s.proxy.dashboard_url}
                target="_blank"
                rel="noreferrer"
                onClick={() => {
                  const params = {
                    proxy_state: s.proxy?.state ?? "unknown",
                    limited: s.proxy?.limited ?? false,
                    percent_used_bucket:
                      s.proxy?.percent_used == null
                        ? "unknown"
                        : Math.min(100, Math.floor(s.proxy.percent_used / 10) * 10),
                  };
                  trackEvent("proxy_top_up_requested", params);
                  trackEvent("proxy_top_up_clicked", params);
                }}
              >
                Top up in dashboard →
              </a>
            )}
          </>
        ) : (
          <button className="proxy-locked" onClick={() => s.setDashboardKeyPromptOpen(true)}>
            <Icon name="lock.fill" size={16} />
            <span>
              <strong>Sign in required</strong>
              <span className="muted small">Unlock proxy traffic analytics and the enforced traffic limit.</span>
            </span>
          </button>
        )}
      </div>

      <section className="proxy-usage-analytics">
        <div className="proxy-usage-toolbar">
          <div className="proxy-usage-presets" role="group" aria-label="Usage range">
            {([7, 14, 30] as const).map((days) => (
              <button
                key={days}
                className={preset === days ? "active" : ""}
                onClick={() => applyPreset(days)}
              >
                {days} days
              </button>
            ))}
          </div>
          <div className="proxy-usage-date-range">
            <label>
              <span>From</span>
              <input
                type="date"
                value={from}
                max={to}
                onChange={(event) => {
                  setPreset("custom");
                  setFrom(event.target.value);
                }}
              />
            </label>
            <label>
              <span>To</span>
              <input
                type="date"
                value={to}
                min={from}
                max={today}
                onChange={(event) => {
                  setPreset("custom");
                  setTo(event.target.value);
                }}
              />
            </label>
          </div>
          <span className={`proxy-usage-source-badge ${historySource}`}>
            {historySource === "backend" ? "NodeMaven live" : "Local fallback"}
          </span>
        </div>

        {historyNotice && (
          <div className="proxy-usage-notice">
            <Icon name="info.circle.fill" size={14} />
            {historyNotice}
          </div>
        )}

        {historyLoading ? (
          <div className="proxy-usage-loading"><Spinner size={18} /> Loading usage history…</div>
        ) : history ? (
          <>
            <div className="proxy-usage-kpis">
              <div className="claw-card proxy-usage-kpi">
                <span className="muted small">Traffic in range</span>
                <strong>{humanBytes(history.total_bytes)}</strong>
              </div>
              <div className="claw-card proxy-usage-kpi">
                <span className="muted small">Requests</span>
                <strong>{historySource === "backend" ? numberFormatter.format(history.total_requests) : "—"}</strong>
              </div>
              <div className="claw-card proxy-usage-kpi">
                <span className="muted small">Daily average</span>
                <strong>{humanBytes(averageBytes)}</strong>
              </div>
              <div className="claw-card proxy-usage-kpi">
                <span className="muted small">Peak day</span>
                <strong>{peak ? humanBytes(peak.used_bytes) : "—"}</strong>
                {peak && <span className="muted small">{shortLabel(peak.label)}</span>}
              </div>
            </div>

            <div className="claw-card proxy-usage-chart-card">
              <div className="proxy-usage-card-heading">
                <div>
                  <strong>Traffic over time</strong>
                  <span className="muted small">Daily transferred bytes · {history.timezone}</span>
                </div>
                <Icon name="chart.bar.fill" size={18} className="accent-icon" />
              </div>
              {points.length ? (
                <div className="proxy-usage-chart" role="img" aria-label="Proxy traffic by day">
                  {points.map((point) => (
                    <div
                      key={point.label}
                      className="proxy-usage-chart-column"
                      title={`${point.label}: ${humanBytes(point.used_bytes)} · ${numberFormatter.format(point.requests)} requests`}
                    >
                      <span className="proxy-usage-chart-value">{humanBytes(point.used_bytes)}</span>
                      <span
                        className="proxy-usage-chart-bar"
                        style={{ height: `${Math.max(point.used_bytes / maximumBytes * 100, point.used_bytes ? 5 : 2)}%` }}
                      />
                      <span className="proxy-usage-chart-label">{shortLabel(point.label)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="proxy-usage-empty">No traffic recorded in this range.</div>
              )}
            </div>

            <div className="proxy-usage-details-grid">
              <div className="claw-card proxy-usage-detail-card">
                <div className="proxy-usage-card-heading">
                  <div>
                    <strong>Traffic source</strong>
                    <span className="muted small">NodeMaven proxy vs browser transport</span>
                  </div>
                  <Icon name="point.3.connected.trianglepath.dotted" size={18} />
                </div>
                <div className="proxy-usage-runtime-row">
                  <span>
                    <span className="muted small">Runtime now</span>
                    <strong>{currentRuntime}</strong>
                  </span>
                  <span>
                    <span className="muted small">Running sessions</span>
                    <strong>{runningSessions}</strong>
                  </span>
                </div>
                {history.sources.length ? history.sources.map((source) => {
                  const share = history.total_bytes ? source.used_bytes / history.total_bytes * 100 : 0;
                  return (
                    <div key={source.source} className="proxy-usage-source-row">
                      <div className="row small">
                        <strong>{source.source === "proxy" ? "Managed proxy" : "NodeMaven Browser"}</strong>
                        <span className="spacer" />
                        <span>{humanBytes(source.used_bytes)} · {numberFormatter.format(source.requests)} req</span>
                      </div>
                      <div className="bar"><div className="bar-fill" style={{ width: `${Math.min(share, 100)}%` }} /></div>
                    </div>
                  );
                }) : <div className="proxy-usage-empty">Source breakdown requires backend analytics.</div>}
              </div>

              <div className="claw-card proxy-usage-detail-card">
                <div className="proxy-usage-card-heading">
                  <div>
                    <strong>Top domains</strong>
                    <span className="muted small">Highest traffic destinations in this range</span>
                  </div>
                  <Icon name="globe" size={18} />
                </div>
                {history.top_domains.length ? (
                  <div className="proxy-usage-domain-list">
                    {history.top_domains.map((domain) => (
                      <div key={domain.domain} className="proxy-usage-domain-row">
                        <strong title={domain.domain}>{domain.domain}</strong>
                        <span>{humanBytes(domain.used_bytes)}</span>
                        <span className="muted small">{numberFormatter.format(domain.requests)} req</span>
                      </div>
                    ))}
                  </div>
                ) : <div className="proxy-usage-empty">Domain analytics require backend history.</div>}
              </div>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
