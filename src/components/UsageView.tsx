import { formattingLocale, translate } from "../shared/lib/i18n";
import { DateRangePicker, IconButton, Tooltip } from "../shared/ui";
import { trafficTrends } from "../lib/trafficTrends";
import { useEffect, useMemo, useState } from "react";
import { nextctlJson } from "../nextctl";
import { useStore } from "../store";
import { invoke } from "../electronBridge";
import { discordUrl, repoUrl } from "../constants";
import { trackEvent } from "../lib/analytics";
import {
  isProxyTrafficExhausted,
  isProxyTrafficHistoryRangeValid,
  isTrustedNodeMavenURL,
  mergeProxyTrafficHistories,
  proxyTrafficHistoryCoverage,
  proxyTrafficHistoryMaxDays,
  proxyTrafficHistoryPresetDays,
  proxyTrafficHistoryWindows,
  type ProxyTrafficHistoryCoverage,
  type ProxyTrafficHistoryPreset,
} from "../lib/proxyTraffic";
import { trafficGateState } from "../lib/trafficGate";
import { formatHistoryDateLabel } from "../lib/trafficChart";
import {
  humanBytes,
  type ProxyTrafficHistory,
  type ProxyTrafficHistoryPoint,
} from "../types";
import { Icon, Spinner } from "./Icon";
import { TrafficChart } from "./TrafficChart";
import { GitHubStarCard } from "./GitHubStarReward";
import { shouldAskForGitHubStar } from "../lib/githubStarReward";

type RangePreset = ProxyTrafficHistoryPreset | "custom" | "all";


const historyRequestConcurrency = 3;

interface BackendHistoryResult {
  coverage: ProxyTrafficHistoryCoverage;
  history?: ProxyTrafficHistory;
  loadedWindows: number;
  requestedWindows: number;
}

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
  accountStart: string | undefined,
  cancelled: () => boolean,
): Promise<BackendHistoryResult> {
  const windows = proxyTrafficHistoryWindows(from, to, accountStart);
  const histories: ProxyTrafficHistory[] = [];

  for (let offset = 0; offset < windows.length; offset += historyRequestConcurrency) {
    if (cancelled()) break;
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

  const coverage = proxyTrafficHistoryCoverage(windows.length, histories.length);
  return {
    coverage,
    history: histories.length
      ? mergeProxyTrafficHistories(histories, from, to, timezone)
      : undefined,
    loadedWindows: histories.length,
    requestedWindows: windows.length,
  };
}

function peakPoint(points: ProxyTrafficHistoryPoint[]): ProxyTrafficHistoryPoint | undefined {
  return points.reduce<ProxyTrafficHistoryPoint | undefined>(
    (peak, point) => (!peak || point.used_bytes > peak.used_bytes ? point : peak),
    undefined,
  );
}

function trendMark(direction?: number) {
  if (direction == null) return null;
  const label = (direction > 0 ? "Increased" : direction < 0 ? "Decreased" : "Unchanged") + " compared with the first half of this period";
  return <Tooltip content={label}><span className="traffic-trend" aria-label={label}>{direction > 0 ? "↑" : direction < 0 ? "↓" : "→"}</span></Tooltip>;
}

export function UsageView() {
  const s = useStore();
  const today = dateValue(new Date());
  const registration = s.accountCreatedAt ? new Date(s.accountCreatedAt) : undefined;
  const accountStart = registration && Number.isFinite(registration.getTime()) && registration <= new Date() ? dateValue(registration) : undefined;
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );
  const [preset, setPreset] = useState<RangePreset>(7);
  const [from, setFrom] = useState(() => shiftDate(today, -6));
  const [to, setTo] = useState(today);
  const [history, setHistory] = useState<ProxyTrafficHistory>();
  const [historyLoading, setHistoryLoading] = useState(true);
  const [refreshError, setRefreshError] = useState<string>();
  const [historyNotice, setHistoryNotice] = useState<string>();
  const [historyReload, setHistoryReload] = useState(0);
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [handoffNotice, setHandoffNotice] = useState<string>();
  const [handoffInviteSent, setHandoffInviteSent] = useState(false);
  const [handoffInviteEmail, setHandoffInviteEmail] = useState<string>();
  const [handoffInviteUnavailable, setHandoffInviteUnavailable] = useState(false);
  const gateState = trafficGateState(s.proxy);
  // A GitHub sign-up lifts its limit with a star, which replaces the Discord ask.
  const githubStar = useStore((state) => state.githubStar);
  const loadGitHubStar = useStore((state) => state.loadGitHubStar);
  const starAsked = shouldAskForGitHubStar(githubStar);
  useEffect(() => {
    if (githubStar === undefined) void loadGitHubStar().catch(() => undefined);
  }, [githubStar, loadGitHubStar]);
  useEffect(() => {
    setHandoffInviteSent(false);
    setHandoffInviteEmail(undefined);
    setHandoffInviteUnavailable(false);
    setHandoffNotice(undefined);
  }, [s.proxy?.provider_account_email, s.authed]);

  useEffect(() => {
    if (!s.authed) {
      setHistory(undefined);
      setHistoryNotice(translate("Sign in to view proxy usage."));
      setHistoryLoading(false);
      return;
    }
    if (!(preset === "all" && accountStart && from === accountStart && to <= today) && !isProxyTrafficHistoryRangeValid(from, to)) {
      setHistory(undefined);
      setHistoryNotice(translate("Choose a valid range of up to 1 year."));
      setHistoryLoading(false);
      return;
    }

    let cancelled = false;
    setHistory(undefined);
    setHistoryLoading(true);
    setHistoryNotice(undefined);
    void loadBackendHistory(from, to, timezone, preset === "all" ? accountStart : undefined, () => cancelled)
      .then((result) => {
        if (cancelled) return;
        setHistory(result.history);
        if (result.coverage === "partial") {
          setHistoryNotice(
            translate("Some periods couldn't load (%1 of %2). Totals exclude them; gaps may appear as zero.", result.loadedWindows, result.requestedWindows),
          );
        } else if (result.coverage === "unavailable") {
          setHistoryNotice(translate("Usage history is unavailable. No history data is shown."));
        }
      })
      .catch(() => {
        if (cancelled) return;
        setHistory(undefined);
        setHistoryNotice(translate("Usage history is unavailable. Try again."));
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, historyReload, s.authed, s.accountOwnerId, timezone, to, accountStart, preset, today]);

  const applyPreset = (days: ProxyTrafficHistoryPreset) => {
    setPreset(days);
    const currentDay = dateValue(new Date());
    setTo(currentDay);
    setFrom(shiftDate(currentDay, -(days - 1)));
  };
  const refreshUsage = async () => {
    setRefreshError(undefined);
    try {
      await s.refreshProxyData();
    } catch {
      setRefreshError(translate("Could not refresh your traffic allowance. Any previously loaded values may be out of date. Try Refresh again."));
    } finally {
      setHistoryReload((value) => value + 1);
    }
  };
  const openTrafficGateGitHub = () => {
    trackEvent("proxy_traffic_gate_github_opened", {
      surface: "usage_card",
      proxy_state: s.proxy?.state ?? "unknown",
      used_bytes_bucket: s.proxy ? Math.floor(s.proxy.used_bytes / (10 * 1024 * 1024)) * 10 : "unknown",
    });
    window.open(repoUrl, "_blank", "noopener,noreferrer");
  };
  const openTrafficGateDiscord = () => {
    trackEvent("proxy_traffic_gate_discord_opened", {
      proxy_state: s.proxy?.state ?? "unknown",
      used_bytes_bucket: s.proxy ? Math.floor(s.proxy.used_bytes / (10 * 1024 * 1024)) * 10 : "unknown",
    });
    window.open(discordUrl, "_blank", "noopener,noreferrer");
  };
  const openNodeMaven = async (kind: "access" | "pricing" | "dashboard") => {
    if (!s.proxy || handoffLoading) return;
    const url = kind === "access" ? s.proxy.provider_access_url
      : kind === "dashboard" ? s.proxy.dashboard_url : s.proxy.pricing_url;
    if (!isTrustedNodeMavenURL(url)) {
      setHandoffNotice(translate("The NodeMaven link is unavailable. Refresh and try again."));
      return;
    }
    setHandoffLoading(true);
    setHandoffNotice(undefined);
    trackEvent(`nodemaven_${kind}_opened`, { proxy_state: s.proxy.state, limited: s.proxy.limited });
    try {
      await invoke("open_external", { url });
      setHandoffNotice(kind === "access"
        ? translate("NodeMaven account setup opened in your browser.")
        : kind === "dashboard"
          ? translate("NodeMaven dashboard opened in your browser.")
          : translate("NodeMaven pricing opened. After checkout, return here and refresh your usage."));
    } catch {
      setHandoffNotice(translate("We couldn't open NodeMaven. Try again."));
    } finally {
      setHandoffLoading(false);
    }
  };
  const buyNodeMavenTraffic = async () => {
    if (!s.proxy || handoffLoading) return;
    if (handoffInviteSent || s.proxy.provider_access_method === "email_sent") {
      await openNodeMaven("pricing");
      return;
    }
    setHandoffLoading(true);
    setHandoffNotice(undefined);
    try {
      const result = await invoke<{ email: string; expiresInDays: number }>("nodemaven_send_invite");
      setHandoffInviteSent(true);
      setHandoffInviteEmail(result.email);
      setHandoffInviteUnavailable(false);
      setHandoffNotice(translate("The password setup link expires in %1 days.", result.expiresInDays));
      trackEvent("nodemaven_invite_sent", { proxy_state: s.proxy.state });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not send the NodeMaven email. Try again.";
      setHandoffInviteUnavailable(message.includes("not enabled yet"));
      setHandoffNotice(message.replace(/^Error invoking remote method 'nextbrowser:invoke': Error: /, ""));
    } finally {
      setHandoffLoading(false);
    }
  };
  const points = history?.data_points ?? [];
  const trends = historyNotice ? undefined : trafficTrends(points);
  const proxyExhausted = isProxyTrafficExhausted(s.proxy);
  const dashboardReady = handoffInviteSent || s.proxy?.provider_access_method === "email_sent";
  const canBuyNodeMavenTraffic = gateState === "open" && proxyExhausted;
  const peak = peakPoint(points);
  const averageBytes = points.length ? (history?.total_bytes ?? 0) / points.length : 0;

  return (
    <div className="page proxy-usage-page">
      <div className="claw-card control-card proxy-card proxy-usage-card">
        {s.proxy ? (
          <>
            {s.proxyWarning && (
              <div className="warning-banner">
                <Icon name="exclamationmark.triangle.fill" size={14} />
                {s.proxyWarning}
              </div>
            )}
            <GitHubStarCard />
            {gateState === "blocked" && !starAsked && (
              <div className="proxy-traffic-gate" role="status">
                <div className="proxy-traffic-gate-heading">
                  <Icon name="lock.fill" size={16} />
                  <strong>{translate("Get 1 GB of free proxy traffic")}</strong>
                </div>
                {proxyExhausted && <p className="muted small">{translate("Free traffic is paused ·")} {humanBytes(s.proxy.remaining_bytes ?? 0)} {translate("remaining")}</p>}
                <p className="muted small">{translate("Connect GitHub and star nextbrowser-oss/nextbrowser-app. Your 1 GB unlocks once the star is checked. If you remove the star later, the bonus pauses again.")}</p>
                <div className="proxy-traffic-gate-actions">
                  <button
                    className="btn-bordered-prominent"
                    type="button"
                    onClick={openTrafficGateGitHub}
                  >
                    <Icon name="star.fill" size={13} />{translate("Open GitHub")}</button>
                  <button className="link small" type="button" onClick={openTrafficGateDiscord}>{translate("Questions? Ask in Discord")}</button>
                </div>
              </div>
            )}
            {s.proxy.provider === "nodemaven" && (canBuyNodeMavenTraffic || dashboardReady) && (
              <div className={`nodemaven-handoff ${proxyExhausted ? "exhausted" : "ready"}`}>
                <div className="nodemaven-handoff-copy">
                  <Icon name={proxyExhausted ? "exclamationmark.triangle.fill" : "checkmark.circle.fill"} size={18} />
                  <div>
                    <strong>{gateState === "blocked" ? translate("NodeMaven dashboard access") : proxyExhausted
                      ? dashboardReady || s.proxy.legacy_migrated ? translate("Proxy traffic has run out") : translate("Your free 1 GB has been used")
                      : translate("Your NodeMaven account is ready")}</strong>
                    <p>
                      {gateState === "blocked" ? translate("Your dashboard remains available. Contact support about the paused proxy allowance before continuing browser work.")
                        : proxyExhausted
                        ? dashboardReady
                          ? translate("Buy more traffic in NodeMaven to continue. Your proxy credentials stay the same.")
                          : translate("Buy more traffic in NodeMaven to continue. We'll email you a link to set your password. Your proxy credentials stay the same.")
                        : dashboardReady
                          ? translate("Your NodeMaven dashboard is ready whenever you need more traffic.")
                          : s.proxy.legacy_migrated
                            ? translate("Your previous traffic balance is available. When it runs out, we'll email you a link to set up your NodeMaven account.")
                            : translate("Your free 1 GB is active. When you need more, we'll email you a link to set up your NodeMaven account.")}
                    </p>
                    {s.proxy.provider_account_email && <span>{translate("NodeMaven account:")} {s.proxy.provider_account_email}</span>}
                  </div>
                </div>
                {dashboardReady && (
                  <div className="nodemaven-account-email" role="status">
                    <strong>{translate("We've prepared your NodeMaven account")}</strong>
                    <p>{translate("A link to set your password has been sent to")}{" "}
                      <strong>{handoffInviteEmail || s.proxy.provider_account_email || translate("your email address")}</strong>.
                      {" "}{translate("Check your inbox and spam folder, set your password, then sign in to NodeMaven to buy traffic.")}</p>
                  </div>
                )}
                <div className="nodemaven-handoff-actions">
                  {dashboardReady && isTrustedNodeMavenURL(s.proxy.dashboard_url) && (
                    <button className="btn-bordered" disabled={handoffLoading} type="button" onClick={() => void openNodeMaven("dashboard")}>
                      <Icon name="arrow.up.right" size={13} />{translate("Open NodeMaven dashboard")}</button>
                  )}
                  {handoffInviteUnavailable && isTrustedNodeMavenURL(s.proxy.provider_access_url) && (
                    <button className={proxyExhausted ? "btn-bordered" : "btn-bordered-prominent"} disabled={handoffLoading} type="button" onClick={() => void openNodeMaven("access")}>
                      <Icon name="person.crop.circle" size={13} />{translate("Set up account access")}</button>
                  )}
                  {canBuyNodeMavenTraffic && (
                    <button className="btn-bordered-prominent" disabled={handoffLoading} type="button" onClick={() => void buyNodeMavenTraffic()}>
                      {handoffLoading ? <Spinner size={13} /> : <Icon name="arrow.up.right" size={13} />}
                      {dashboardReady ? translate("Buy more traffic in NodeMaven") : translate("Buy traffic in NodeMaven")}
                    </button>
                  )}
                  {canBuyNodeMavenTraffic && (
                    <button className="btn-bordered" disabled={s.isRefreshing} type="button" onClick={() => void refreshUsage()}>{translate("I’ve added traffic — Refresh")}</button>
                  )}
                </div>
                {handoffNotice && <p className="nodemaven-handoff-notice" role="status">{handoffNotice}</p>}
              </div>
            )}
          </>
        ) : s.authed ? (
          <div className="proxy-locked" role="status">
            <Icon name="info.circle.fill" size={16} />
            <span>
              <strong>{translate("Allocation unavailable")}</strong>
              <span className="muted small">{translate("Refresh to try loading the latest proxy allocation.")}</span>
            </span>
          </div>
        ) : (
          <button className="proxy-locked" onClick={() => s.setDashboardKeyPromptOpen(true)}>
            <Icon name="lock.fill" size={16} />
            <span>
              <strong>{translate("Sign in required")}</strong>
              <span className="muted small">{translate("Unlock proxy traffic analytics and the enforced traffic limit.")}</span>
            </span>
          </button>
        )}
      </div>

      <section className="proxy-usage-analytics" aria-label={translate("Proxy usage")}>
        <div className="proxy-usage-toolbar">
          <div className="proxy-usage-presets" role="group" aria-label={translate("Usage range")}>
            {proxyTrafficHistoryPresetDays.map((days) => (
              <button
                key={days}
                className={preset === days ? "active" : ""}
                aria-pressed={preset === days}
                onClick={() => applyPreset(days)}
              >
                {days === proxyTrafficHistoryMaxDays ? translate("1 year") : translate("%1 days", days)}
              </button>
            ))}
            <DateRangePicker from={from} to={to} latest={today} selected={preset === "custom"} validRange={isProxyTrafficHistoryRangeValid}
              onApply={(start,end) => { setPreset("custom"); setFrom(start); setTo(end); }}/>
            {accountStart && <button className={preset === "all" ? "active" : ""} aria-pressed={preset === "all"} onClick={() => {
              setPreset("all"); setFrom(accountStart); setTo(today);
            }}>{translate("All time")}</button>}
          </div>
          <IconButton label={translate("Refresh proxy usage")} hint={s.authed ? translate("Refresh proxy usage") : translate("Sign in to refresh proxy usage")}
            size="small" appearance="plain" className="proxy-usage-refresh" disabled={s.isRefreshing || !s.authed}
            onClick={() => void refreshUsage()}>
            {s.isRefreshing ? <Spinner size={15} /> : <Icon name="arrow.clockwise" size={15} />}
          </IconButton>
        </div>

        {(historyLoading || !history) && <h2>{translate("Proxy usage")}</h2>}
        {refreshError && <div role="alert" className="muted small">{refreshError}</div>}
        {historyNotice && (
          <div className="proxy-usage-notice">
            <Icon name="info.circle.fill" size={14} />
            {historyNotice}
          </div>
        )}

        {historyLoading ? (
          <div className="proxy-usage-loading"><Spinner size={18} /> {translate("Loading usage history…")}</div>
        ) : history ? (
          <>

            <div className="claw-card proxy-usage-chart-card">
              <div className="proxy-usage-card-heading">
                <div>
                  <h2>{translate("Proxy usage")}</h2>
                  <span className="muted small">{translate("Traffic over time ·")} {history.timezone}</span>
                </div>
                <span className="proxy-usage-source-badge">{translate("NodeMaven data")}</span>
              </div>
              <dl className="proxy-usage-kpis chart-stats">
                <div className="proxy-usage-kpi">
                  <dt>{translate("Traffic in range")}</dt>
                  <dd>{trendMark(trends?.traffic)}{humanBytes(history.total_bytes)}</dd>
                </div>
                <div className="proxy-usage-kpi">
                  <dt>{translate("Requests")}</dt>
                  <dd>{trendMark(trends?.requests)}{history.total_requests.toLocaleString(formattingLocale())}</dd>
                </div>
                <div className="proxy-usage-kpi">
                  <dt>{translate("Daily average")}</dt>
                  <dd>{trendMark(trends?.traffic)}{humanBytes(averageBytes)}</dd>
                </div>
                <div className="proxy-usage-kpi">
                  <dt>{translate("Peak day")}</dt>
                  <dd>{trendMark(trends?.peak)}{peak ? humanBytes(peak.used_bytes) : "—"}
                    {peak && <small>{formatHistoryDateLabel(peak.label)}</small>}
                  </dd>
                </div>
              </dl>
              {points.length ? (
                <TrafficChart points={points} />
              ) : (
                <div className="proxy-usage-empty">{translate("No traffic recorded in this range.")}</div>
              )}
              {history.sources.length > 0 && (
                <details className="proxy-usage-source-totals"><summary>{translate("Traffic source totals")}</summary>
                  {history.sources.map((source) => (
                    <span key={source.source}>
                      <strong>{source.source === "browser" ? translate("Browser") : translate("Proxy")}</strong>
                      {" "}
                      {humanBytes(source.used_bytes)}
                      {" · "}
                      {source.requests.toLocaleString(formattingLocale())} {translate("req")}</span>
                  ))}
                </details>
              )}
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
