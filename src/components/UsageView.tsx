import { useEffect, useMemo, useState } from "react";
import { nextctlJson } from "../nextctl";
import { invoke } from "../electronBridge";
import { useStore } from "../store";
import { trackEvent } from "../lib/analytics";
import { internalError } from "../lib/userFacingError";
import {
  domainPaginationItems,
  domainsPageByTraffic,
  isProxyTrafficHistoryRangeValid,
  mergeProxyTrafficHistories,
  proxyTrafficHistoryMaxDays,
  proxyTrafficHistoryPresetDays,
  proxyTrafficHistoryWindows,
  proxyTrafficTopUpBytes,
  proxyTrafficWarning,
  shouldShowProxyTrafficTopUp,
  proxyTrafficDomainsPageSize,
  type ProxyTrafficHistoryPreset,
} from "../lib/proxyTraffic";
import { formatHistoryDateLabel } from "../lib/trafficChart";
import {
  humanBytes,
  proxyFraction,
  type ProxyTraffic,
  type ProxyTrafficHistory,
  type ProxyTrafficHistoryPoint,
} from "../types";
import { Icon, Spinner } from "./Icon";
import { TrafficChart } from "./TrafficChart";
import { UserFacingError } from "./UserFacingError";

type RangePreset = ProxyTrafficHistoryPreset | "custom";
type TopUpNotice = { tone: "success" | "error"; message: string };

const numberFormatter = new Intl.NumberFormat();
const historyRequestConcurrency = 3;

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

async function loadBackendHistory(
  from: string,
  to: string,
  timezone: string,
): Promise<ProxyTrafficHistory> {
  const windows = proxyTrafficHistoryWindows(from, to);
  const histories: ProxyTrafficHistory[] = [];

  for (let offset = 0; offset < windows.length; offset += historyRequestConcurrency) {
    const batch = windows.slice(offset, offset + historyRequestConcurrency);
    const results = await Promise.allSettled(batch.map(async (window) => {
      const payload = await nextctlJson<{ proxy_traffic_history: ProxyTrafficHistory }>([
        "proxy-traffic",
        "--from",
        window.from,
        "--to",
        window.to,
        "--timezone",
        timezone,
      ]);
      return payload.proxy_traffic_history;
    }));
    for (const result of results) {
      if (result.status === "fulfilled") histories.push(result.value);
    }
  }

  return mergeProxyTrafficHistories(histories, from, to, timezone);
}

function peakPoint(points: ProxyTrafficHistoryPoint[]): ProxyTrafficHistoryPoint | undefined {
  return points.reduce<ProxyTrafficHistoryPoint | undefined>(
    (peak, point) => (!peak || point.used_bytes > peak.used_bytes ? point : peak),
    undefined,
  );
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
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyNotice, setHistoryNotice] = useState<string>();
  const [historyReload, setHistoryReload] = useState(0);
  const [domainsPage, setDomainsPage] = useState(1);
  const [topUpLoading, setTopUpLoading] = useState(false);
  const [topUpNotice, setTopUpNotice] = useState<TopUpNotice>();
  const fraction = proxyFraction(s.proxy);

  useEffect(() => {
    setDomainsPage(1);
  }, [history]);

  useEffect(() => {
    if (!isProxyTrafficHistoryRangeValid(from, to)) {
      setHistory(undefined);
      setHistoryNotice("Choose a valid range of up to 1 year.");
      setHistoryLoading(false);
      return;
    }

    let cancelled = false;
    setHistoryLoading(true);
    setHistoryNotice(undefined);
    void loadBackendHistory(from, to, timezone)
      .then((proxyTrafficHistory) => {
        if (cancelled) return;
        setHistory(proxyTrafficHistory);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, historyReload, timezone, to]);

  const applyPreset = (days: ProxyTrafficHistoryPreset) => {
    setPreset(days);
    setTo(today);
    setFrom(shiftDate(today, -(days - 1)));
  };
  const refreshUsage = async () => {
    await s.refreshProxyData();
    setHistoryReload((value) => value + 1);
  };
  const topUpProxyTraffic = async () => {
    if (!s.proxy || topUpLoading) return;
    const analyticsParams = {
      proxy_state: s.proxy.state,
      limited: s.proxy.limited,
      percent_used_bucket:
        s.proxy.percent_used == null
          ? "unknown"
          : Math.min(100, Math.floor(s.proxy.percent_used / 10) * 10),
    };
    setTopUpLoading(true);
    setTopUpNotice(undefined);
    trackEvent("proxy_top_up_requested", analyticsParams);
    try {
      const proxyTraffic = await invoke<ProxyTraffic>("proxy_traffic_top_up");
      try {
        await s.loadProxy();
      } catch {
        useStore.setState({
          proxy: proxyTraffic,
          proxyWarning: proxyTrafficWarning(proxyTraffic),
        });
      }
      setTopUpNotice({
        tone: "success",
        message: `Added ${humanBytes(proxyTraffic.top_up_bytes ?? proxyTrafficTopUpBytes)} of proxy traffic.`,
      });
      trackEvent("proxy_top_up_succeeded", analyticsParams);
    } catch {
      setTopUpNotice({
        tone: "error",
        message: internalError("We couldn't add proxy traffic."),
      });
      trackEvent("proxy_top_up_failed", analyticsParams);
    } finally {
      setTopUpLoading(false);
    }
  };
  const points = history?.data_points ?? [];
  const topDomains = history?.top_domains ?? [];
  const domainPage = domainsPageByTraffic(topDomains, domainsPage);
  const showProxyTrafficTopUp = shouldShowProxyTrafficTopUp(s.proxy);
  const peak = peakPoint(points);
  const averageBytes = points.length ? (history?.total_bytes ?? 0) / points.length : 0;

  return (
    <div className="page proxy-usage-page">
      <div className="proxy-usage-header">
        <div>
          <h2>Proxy usage</h2>
          <p className="muted">Traffic, requests, and domains from NodeMaven.</p>
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
            {showProxyTrafficTopUp && (
              <div className="proxy-usage-top-up-actions">
                <button
                  className="btn-bordered-prominent"
                  disabled={topUpLoading}
                  type="button"
                  onClick={() => void topUpProxyTraffic()}
                >
                  {topUpLoading ? <Spinner size={13} /> : <Icon name="plus" size={13} />}
                  {topUpLoading ? "Adding 1 GB" : "Add 1 GB"}
                </button>
              </div>
            )}
            {topUpNotice && (
              <div
                className={`proxy-usage-top-up-notice ${topUpNotice.tone}`}
                role={topUpNotice.tone === "error" ? "alert" : "status"}
              >
                <Icon
                  name={topUpNotice.tone === "error" ? "exclamationmark.triangle.fill" : "checkmark.circle.fill"}
                  size={14}
                />
                <UserFacingError message={topUpNotice.message} surface="proxy_top_up" />
              </div>
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
            {proxyTrafficHistoryPresetDays.map((days) => (
              <button
                key={days}
                className={preset === days ? "active" : ""}
                onClick={() => applyPreset(days)}
              >
                {days === proxyTrafficHistoryMaxDays ? "1 year" : `${days} days`}
              </button>
            ))}
          </div>
          <div className="proxy-usage-date-range">
            <label>
              <span>From</span>
              <input
                type="date"
                value={from}
                min={shiftDate(to, -(proxyTrafficHistoryMaxDays - 1))}
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
                max={shiftDate(from, proxyTrafficHistoryMaxDays - 1) < today
                  ? shiftDate(from, proxyTrafficHistoryMaxDays - 1)
                  : today}
                onChange={(event) => {
                  setPreset("custom");
                  setTo(event.target.value);
                }}
              />
            </label>
          </div>
          <span className="proxy-usage-source-badge backend">NodeMaven live</span>
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
                <strong>{numberFormatter.format(history.total_requests)}</strong>
              </div>
              <div className="claw-card proxy-usage-kpi">
                <span className="muted small">Daily average</span>
                <strong>{humanBytes(averageBytes)}</strong>
              </div>
              <div className="claw-card proxy-usage-kpi">
                <span className="muted small">Peak day</span>
                <strong>{peak ? humanBytes(peak.used_bytes) : "—"}</strong>
                {peak && <span className="muted small">{formatHistoryDateLabel(peak.label)}</span>}
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
                <TrafficChart points={points} />
              ) : (
                <div className="proxy-usage-empty">No traffic recorded in this range.</div>
              )}
            </div>

            <div className="proxy-usage-details-grid">
              <div className="claw-card proxy-usage-detail-card">
                <div className="proxy-usage-card-heading">
                  <div>
                    <strong>Domains</strong>
                    <span className="muted small">All destinations in this range · {topDomains.length} domains</span>
                  </div>
                  <Icon name="globe" size={18} />
                </div>
                {topDomains.length ? (
                  <div className="proxy-usage-domain-table-wrap">
                    <table className="proxy-usage-domain-table">
                      <colgroup>
                        <col className="proxy-usage-domain-rank-column" />
                        <col />
                        <col className="proxy-usage-domain-traffic-column" />
                        <col className="proxy-usage-domain-requests-column" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th scope="col">#</th>
                          <th scope="col">Domain</th>
                          <th scope="col">Traffic</th>
                          <th scope="col">Requests</th>
                        </tr>
                      </thead>
                      <tbody>
                        {domainPage.domains.map((domain, index) => (
                          <tr key={`${domain.domain}-${index}`}>
                            <td className="proxy-usage-domain-rank">
                              {(domainPage.page - 1) * proxyTrafficDomainsPageSize + index + 1}
                            </td>
                            <td className="proxy-usage-domain-name" title={domain.domain}>{domain.domain}</td>
                            <td>{humanBytes(domain.used_bytes)}</td>
                            <td>{numberFormatter.format(domain.requests)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <div className="proxy-usage-empty">No domains recorded in this range.</div>}
                {domainPage.pageCount > 1 && (
                  <nav className="proxy-usage-domain-pagination" aria-label="Domain pages">
                    <button
                      type="button"
                      aria-label="Previous domain page"
                      disabled={domainPage.page === 1}
                      onClick={() => setDomainsPage(domainPage.page - 1)}
                    >
                      ‹
                    </button>
                    {domainPaginationItems(domainPage.page, domainPage.pageCount).map((item, index) => (
                      item === "ellipsis" ? (
                        <span key={`ellipsis-${index}`} className="proxy-usage-domain-pagination-gap" aria-hidden="true">…</span>
                      ) : (
                        <button
                          key={item}
                          className={item === domainPage.page ? "active" : ""}
                          type="button"
                          aria-label={`Domain page ${item}`}
                          aria-current={item === domainPage.page ? "page" : undefined}
                          onClick={() => setDomainsPage(item)}
                        >
                          {item}
                        </button>
                      )
                    ))}
                    <button
                      type="button"
                      aria-label="Next domain page"
                      disabled={domainPage.page === domainPage.pageCount}
                      onClick={() => setDomainsPage(domainPage.page + 1)}
                    >
                      ›
                    </button>
                  </nav>
                )}
              </div>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
