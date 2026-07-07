import { type FormEvent, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useStore, type ManualProxyProfileInput } from "../store";
import { PRIMARY_AGENTS, ADDITIONAL_AGENTS, agentById } from "../agents";
import { BrandHeader } from "./BrandLogo";
import { ScheduledRunsPanel } from "./ScheduledRunsPanel";
import { Icon, Spinner } from "./Icon";
import { countryFlag, countryLabel, ROTATION_COUNTRIES } from "../lib/countryFlag";
import { manualProxyDefaultName, parseManualProxyUrl, type ManualProxyScheme } from "../lib/manualProxy";
import { trackEvent } from "../lib/analytics";
import { humanBytes, proxyFraction } from "../types";

type ManualProxyInputMode = "url" | "fields";

export function Sidebar() {
  const s = useStore();
  const [agentSearch, setAgentSearch] = useState("");
  const [focused, setFocused] = useState(false);
  const [menuProfile, setMenuProfile] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [manualProxyOpen, setManualProxyOpen] = useState(false);
  const [manualProxyMode, setManualProxyMode] = useState<ManualProxyInputMode>("url");
  const [manualProxyUrl, setManualProxyUrl] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualScheme, setManualScheme] = useState<ManualProxyScheme>("http");
  const [manualHost, setManualHost] = useState("");
  const [manualPort, setManualPort] = useState("8080");
  const [manualUsername, setManualUsername] = useState("");
  const [manualPassword, setManualPassword] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSaving, setManualSaving] = useState(false);

  const matches = useMemo(
    () =>
      ADDITIONAL_AGENTS.filter((a) =>
        a.name.toLowerCase().includes(agentSearch.toLowerCase()),
      ),
    [agentSearch],
  );
  const suggestions = ADDITIONAL_AGENTS.slice(0, 6);
  const frac = proxyFraction(s.proxy);
  const ready = s.agentReady();
  const version = s.agentVersion();
  const error = s.agentError();
  const loggedIn = s.agentLoggedIn();
  const profiles = s.filteredProfiles();
  const runningProfiles = Object.values(s.statuses).filter((status) => status === "running").length;
  const proxyPercent = s.proxy?.percent_used ?? Math.round(frac * 100);
  const agentName =
    PRIMARY_AGENTS.concat(ADDITIONAL_AGENTS).find((a) => a.id === s.agentId)?.name ?? "agent";

  const uniqueManualProxyName = (baseName: string) => {
    const base = baseName.trim() || "manual-proxy";
    const existing = new Set(s.profiles.map((p) => p.name));
    if (!existing.has(base)) return base;
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${base}-${index}`;
      if (!existing.has(candidate)) return candidate;
    }
    return `${base}-${Date.now()}`;
  };

  const resetManualProxyForm = () => {
    setManualProxyMode("url");
    setManualProxyUrl("");
    setManualName("");
    setManualScheme("http");
    setManualHost("");
    setManualPort("8080");
    setManualUsername("");
    setManualPassword("");
    setManualError(null);
  };

  const submitManualProxy = async (event: FormEvent) => {
    event.preventDefault();
    const name = manualName.trim();
    let input: ManualProxyProfileInput;
    if (manualProxyMode === "url") {
      let parsed;
      try {
        parsed = parseManualProxyUrl(manualProxyUrl);
      } catch (error) {
        setManualError(error instanceof Error ? error.message : String(error));
        return;
      }
      input = {
        name: name || uniqueManualProxyName(manualProxyDefaultName(parsed)),
        ...parsed,
      };
    } else {
      const port = Number.parseInt(manualPort, 10);
      if (!name || !manualHost.trim() || !Number.isInteger(port) || port < 1 || port > 65535) {
        setManualError("Name, host, and a valid port are required.");
        return;
      }
      input = {
        name,
        scheme: manualScheme,
        host: manualHost,
        port,
        username: manualUsername,
        password: manualPassword,
      };
    }
    setManualSaving(true);
    setManualError(null);
    try {
      await s.createManualProxyProfile(input);
      resetManualProxyForm();
      setManualProxyOpen(false);
    } catch (error) {
      setManualError(error instanceof Error ? error.message : String(error));
    } finally {
      setManualSaving(false);
    }
  };

  return (
    <div className="sidebar-shell">
      <div className="sidebar-brand">
        <BrandHeader subtitle="native agent console" />
      </div>

      <div className="sidebar-scroll">
        <div className="sidebar-summary">
          <div className="summary-cell">
            <span className={ready ? "status-dot ok-dot" : "status-dot muted-dot"} />
            <span>{ready ? "Agent ready" : "Agent offline"}</span>
          </div>
          <div className="summary-cell">
            <span className={s.proxy ? "status-dot ok-dot" : "status-dot warn-dot"} />
            <span>{s.proxy ? `${proxyPercent}% proxy` : "Proxy locked"}</span>
          </div>
          <div className="summary-cell">
            <span className={runningProfiles > 0 ? "status-dot ok-dot" : "status-dot muted-dot"} />
            <span>{runningProfiles || s.profiles.length} sessions</span>
          </div>
        </div>

        <div className="claw-card control-card proxy-card">
          <div className="row section-row">
            <div>
              <div className="section">PROXY</div>
              <div className="card-title">Traffic budget</div>
            </div>
            <button
              className="plain-icon-btn plain-icon-btn-compact"
              title={s.proxy ? "Refresh proxy usage" : "Unlock proxy usage"}
              disabled={s.isRefreshing}
              onClick={() => s.proxy ? s.refreshProxyData() : s.setDashboardKeyPromptOpen(true)}
            >
              {s.isRefreshing ? (
                <Spinner size={12} />
              ) : (
                <Icon name={s.proxy ? "arrow.clockwise" : "lock"} size={12} className="muted" />
              )}
            </button>
          </div>
          {s.proxy ? (
            <>
              <div className="bar">
                <div
                  className="bar-fill"
                  style={{
                    width: `${frac * 100}%`,
                    background:
                      frac >= 1
                        ? "var(--red)"
                        : frac >= 0.9
                          ? "#ff9500"
                          : frac >= 0.7
                            ? "#ffd60a"
                            : undefined,
                  }}
                />
              </div>
              <div className="row small proxy-stats">
                <span className="mono-digits">
                  {humanBytes(s.proxy.used_bytes)} /{" "}
                  {s.proxy.limit_bytes ? humanBytes(s.proxy.limit_bytes) : "unlimited"}
                </span>
                <span className="status-pill proxy-state">{s.proxy.state}</span>
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
                    trackEvent("proxy_top_up_clicked", {
                      ...params,
                    });
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
                <strong>Dashboard key required</strong>
                <span className="muted small">Unlock proxy usage and profile traffic stats.</span>
              </span>
            </button>
          )}
        </div>

        <div className="claw-card control-card agent-card">
          <div className="agent-card-head">
            <div>
              <div className="section">AGENT</div>
              <div className="card-title">{agentName}</div>
            </div>
            <span className={"agent-state-pill" + (ready ? " is-ready" : "")}>
              {ready ? "Ready" : "Offline"}
            </span>
          </div>
          <div className="agent-primary">
            {PRIMARY_AGENTS.map((a) => (
              <button
                key={a.id}
                className={"chip" + (s.agentId === a.id ? " chip-active" : "")}
                onClick={() => s.switchAgent(a.id)}
              >
                {a.name}
              </button>
            ))}
          </div>
          <div className="agent-search-box">
            <Icon name="magnifyingglass" size={12} className="muted" />
            <input
              className="agent-search-input"
              placeholder="Other agents — Gemini, Qwen, …"
              value={agentSearch}
              onChange={(e) => setAgentSearch(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 120)}
            />
            {agentSearch && (
              <button className="plain-icon-btn plain-icon-btn-compact" onClick={() => setAgentSearch("")}>
                <Icon name="xmark.circle.fill" size={14} className="muted" />
              </button>
            )}
          </div>
          {(agentSearch ? matches : focused ? suggestions : []).map((a) => (
            <button
              key={a.id}
              className="agent-row"
              onMouseDown={() => {
                s.switchAgent(a.id);
                setAgentSearch("");
              }}
            >
              <span>{a.name}</span>
              {s.agentId === a.id && <Icon name="checkmark" size={12} className="accent-icon" />}
            </button>
          ))}
          {!focused && !agentSearch && !PRIMARY_AGENTS.some((a) => a.id === s.agentId) && (
            <div className="active-agent-banner">
              <Icon name="cpu.fill" size={15} />
              <strong>Using {agentName}</strong>
              <span className="spacer" />
              <Icon name="checkmark.circle.fill" size={15} className="ok" />
            </div>
          )}
          <div className="agent-status small">
            {ready ? (
              <>
                <span className="agent-version-line">
                  <Icon name="checkmark.circle.fill" size={13} className="ok" />
                  {version ?? "connected"}
                  {loggedIn === true && <span className="muted"> · signed in</span>}
                </span>
                {loggedIn === true && agentById(s.agentId).logoutArgs.length > 0 && (
                  <button
                    className="switch-account-link"
                    title={`Sign out of ${agentName} to switch accounts`}
                    onClick={() => s.logoutAgent()}
                  >
                    Logout agent
                  </button>
                )}
              </>
            ) : (
              <button className="btn-bordered-prominent connect-btn full" onClick={() => s.authorizeAgent()}>
                <Icon name="bolt.fill" size={14} />
                Connect to chat
              </button>
            )}
            {ready && loggedIn !== true && (
              <button className="btn-bordered full agent-login-btn" onClick={() => s.loginAgent()}>
                <Icon name="person.badge.key" size={14} />
                Log in to {agentName}
              </button>
            )}
            {error && <div className="error">{error}</div>}
          </div>
        </div>

        <div className="claw-card control-card profiles-card">
          <div className="row section-row">
            <div>
              <div className="section">SESSIONS</div>
              <div className="card-title">Profiles</div>
            </div>
            <span className="profiles-count" title="Total profiles">{s.profiles.length}</span>
            <button
              className="plain-icon-btn plain-icon-btn-compact"
              title="Add manual proxy profile"
              onClick={() => {
                resetManualProxyForm();
                setManualProxyOpen(true);
              }}
            >
              <Icon name="plus" size={12} />
            </button>
            <button
              className="plain-icon-btn plain-icon-btn-compact"
              title="Refresh profiles and session status"
              disabled={s.isRefreshing}
              onClick={() => s.refreshSessions()}
            >
              {s.isRefreshing ? <Spinner size={12} /> : <Icon name="arrow.clockwise" size={12} />}
            </button>
            <span className="spacer" />
            {s.anyAgentRunning() && <Spinner size={12} />}
          </div>
          <div className="search-box">
            <Icon name="magnifyingglass" size={12} className="muted" />
            <input
              className="search-inline"
              placeholder="Search profiles…"
              value={s.profileSearch}
              onChange={(e) => s.setProfileSearch(e.target.value)}
            />
            {s.profileSearch && (
              <button
                className="plain-icon-btn plain-icon-btn-compact"
                title="Clear profile search"
                onClick={() => s.setProfileSearch("")}
              >
                <Icon name="xmark.circle.fill" size={14} className="muted" />
              </button>
            )}
          </div>
          <div className="profile-list">
            {s.profiles.length === 0 && (
              <div className="inline-empty">
                <Icon name="person.crop.circle" size={18} className="muted" />
                <div>
                  <strong>No profiles yet</strong>
                  <div className="muted small">Create one from a dashboard key or add a manual proxy.</div>
                </div>
              </div>
            )}
            {s.profiles.length === 0 && !s.proxy && (
              <button className="btn-bordered full empty-action-button" onClick={() => s.setDashboardKeyPromptOpen(true)}>
                <Icon name="lock" size={14} />
                Enter dashboard key before first profile
              </button>
            )}
            {s.profiles.length > 0 && profiles.length === 0 && (
              <div className="muted small">No matches for “{s.profileSearch}”.</div>
            )}
            {profiles.map((p) => {
              const status = s.statuses[p.name] ?? "unknown";
              const running = status === "running";
              const busy = ["starting", "stopping", "rotating"].includes(status);
              const selected = s.selectedProfile === p.name;
              const manual = p.proxy_mode === "manual" && p.manual_proxy;
              return (
                <div
                  key={p.name}
                  className={"profile-row" + (selected ? " selected" : "")}
                  onClick={() => s.selectProfile(selected ? undefined : p.name)}
                >
                  <span className={"dot " + (running ? "green" : busy ? "orange" : "gray")} title={status} />
                  <span className="profile-main">
                    <span className="profile-name">{p.name}</span>
                    <span className="profile-meta">
                      {p.country ? countryLabel(p.country, p.city) : manual ? "Manual proxy" : status}
                    </span>
                  </span>
                  <span className="profile-badges">
                    {p.country && (
                      <span className="badge" title={countryLabel(p.country, p.city)}>
                        {countryFlag(p.country)} {p.country.toUpperCase()}
                      </span>
                    )}
                    {manual && (
                      <span
                        className="badge manual-proxy-badge"
                        title={`${p.manual_proxy?.host ?? ""}:${p.manual_proxy?.port ?? ""}`}
                      >
                        {(p.manual_proxy?.scheme ?? "http").toUpperCase()}
                      </span>
                    )}
                  </span>
                  <span className="spacer" />
                  <div className="profile-actions">
                    {running ? (
                      <>
                        <button
                          className="plain-icon-btn"
                          title="Stop"
                          disabled={busy}
                          onClick={(e) => { e.stopPropagation(); void s.stopProfile(p.name); }}
                        >
                          <Icon name="stop.fill" size={16} />
                        </button>
                        <button
                          className="plain-icon-btn"
                          title="Live view"
                          onClick={(e) => {
                            e.stopPropagation();
                            s.selectProfile(p.name);
                            s.setTab("live");
                          }}
                        >
                          <Icon name="video.fill" size={16} />
                        </button>
                      </>
                    ) : (
                      <button
                        className="plain-icon-btn"
                        title="Start"
                        disabled={busy}
                        onClick={(e) => { e.stopPropagation(); void s.startProfile(p.name); }}
                      >
                        <Icon name="play.fill" size={16} />
                      </button>
                    )}
                    <button
                      className="plain-icon-btn"
                      title="Profile actions"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuProfile(p.name);
                      }}
                    >
                      <Icon name="ellipsis.circle" size={18} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <ScheduledRunsPanel />
      </div>

      <hr className="divider" />
      <div className="clawctl-footer muted small">
        <Icon name="terminal" size={12} />
        <span>clawctl {s.clawctlVersion || "…"}</span>
        <button
          className="plain-icon-btn plain-icon-btn-compact clawctl-refresh"
          title="Check for a newer clawctl and update"
          disabled={s.clawctlUpdating}
          onClick={() => s.checkClawctlUpdate()}
        >
          {s.clawctlUpdating ? (
            <Spinner size={12} />
          ) : (
            <Icon name="arrow.triangle.2.circlepath" size={12} />
          )}
        </button>
        {s.clawctlUpdateStatus && (
          <span className={s.clawctlUpdateStatus.includes("fail") ? "warn" : ""}>
            · {s.clawctlUpdateStatus}
          </span>
        )}
        {!s.clawctlSupportsSkill && <span className="warn"> · no skill cmd</span>}
        <span className="spacer" />
        <button className="sign-out-footer" title="Sign out" onClick={() => s.logout()}>
          <Icon name="rectangle.portrait.and.arrow.right" size={13} />
          Sign out
        </button>
      </div>

      {menuProfile && createPortal((() => {
        const prof = s.profiles.find((p) => p.name === menuProfile);
        const status = s.statuses[menuProfile] ?? "unknown";
        const manual = prof?.proxy_mode === "manual" && prof.manual_proxy;
        return (
          <div className="modal-overlay" onClick={() => setMenuProfile(null)}>
            <div className="modal-card profile-menu" onClick={(e) => e.stopPropagation()}>
              <div className="profile-menu-head">
                <span
                  className={"dot " + (status === "running" ? "green" : status === "unknown" ? "gray" : "orange")}
                  title={status}
                />
                <span className="profile-menu-name">{menuProfile}</span>
                {prof?.country && (
                  <span className="badge" title={countryLabel(prof.country, prof.city)}>
                    {countryFlag(prof.country)} {prof.country.toUpperCase()}
                  </span>
                )}
                {manual && (
                  <span
                    className="badge manual-proxy-badge"
                    title={`${prof.manual_proxy?.host ?? ""}:${prof.manual_proxy?.port ?? ""}`}
                  >
                    {(prof.manual_proxy?.scheme ?? "http").toUpperCase()}
                  </span>
                )}
                <span className="spacer" />
                <button
                  className="plain-icon-btn"
                  title="Close"
                  onClick={() => setMenuProfile(null)}
                >
                  <Icon name="xmark.circle.fill" size={18} />
                </button>
              </div>

              <button
                className="full rotate-btn"
                onClick={() => {
                  s.rotateProfile(menuProfile);
                  setMenuProfile(null);
                }}
              >
                <Icon name="arrow.triangle.2.circlepath" size={14} strokeWidth={2.25} />
                {manual ? "Restart session" : "Rotate IP"}
              </button>

              {!manual && (
                <>
                  <div className="section profile-menu-label">Rotate country</div>
                  <div className="country-grid">
                    {ROTATION_COUNTRIES.map((c) => (
                      <button
                        key={c.code}
                        className="mini country-chip"
                        title={`${c.code} — ${c.name}`}
                        onClick={() => {
                          s.rotateProfileCountry(menuProfile, c.code);
                          setMenuProfile(null);
                        }}
                      >
                        <span className="country-chip-flag">{countryFlag(c.code)}</span>
                        <span className="country-chip-code">{c.code}</span>
                        <span className="country-chip-name">{c.name}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              <div className="profile-menu-divider" />
              <button
                className="profile-delete-btn"
                onClick={() => {
                  setConfirmDelete(menuProfile);
                  setMenuProfile(null);
                }}
              >
                <Icon name="trash" size={14} />
                Delete profile
              </button>
            </div>
          </div>
        );
      })(), document.body)}

      {manualProxyOpen && createPortal((
        <div className="modal-overlay" onMouseDown={() => !manualSaving && setManualProxyOpen(false)}>
          <form className="modal-card manual-proxy-modal" onSubmit={submitManualProxy} onMouseDown={(e) => e.stopPropagation()}>
            <div className="profile-menu-head">
              <Icon name="network" size={16} className="accent-icon" />
              <span className="profile-menu-name">Manual proxy</span>
              <span className="spacer" />
              <button
                type="button"
                className="plain-icon-btn"
                title="Close"
                disabled={manualSaving}
                onClick={() => setManualProxyOpen(false)}
              >
                <Icon name="xmark.circle.fill" size={18} />
              </button>
            </div>

            <div className="manual-proxy-mode" role="tablist" aria-label="Manual proxy input mode">
              <button
                type="button"
                className={manualProxyMode === "url" ? "active" : ""}
                aria-selected={manualProxyMode === "url"}
                onClick={() => {
                  setManualProxyMode("url");
                  setManualError(null);
                }}
              >
                <Icon name="network" size={13} />
                URL
              </button>
              <button
                type="button"
                className={manualProxyMode === "fields" ? "active" : ""}
                aria-selected={manualProxyMode === "fields"}
                onClick={() => {
                  setManualProxyMode("fields");
                  setManualError(null);
                }}
              >
                <Icon name="wrench" size={13} />
                Fields
              </button>
            </div>

            {manualProxyMode === "url" ? (
              <>
                <label className="modal-field">
                  <span>Proxy URL</span>
                  <input
                    value={manualProxyUrl}
                    onChange={(e) => setManualProxyUrl(e.target.value)}
                    placeholder="http://user:pass@host:8080"
                    autoFocus
                  />
                </label>
                <label className="modal-field">
                  <span>Name (optional)</span>
                  <input
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="generated from proxy URL"
                  />
                </label>
              </>
            ) : (
              <>
                <label className="modal-field">
                  <span>Name</span>
                  <input value={manualName} onChange={(e) => setManualName(e.target.value)} autoFocus />
                </label>
                <div className="manual-proxy-grid">
                  <label className="modal-field">
                    <span>Scheme</span>
                    <select value={manualScheme} onChange={(e) => setManualScheme(e.target.value as ManualProxyScheme)}>
                      <option value="http">HTTP</option>
                      <option value="socks5">SOCKS5</option>
                    </select>
                  </label>
                  <label className="modal-field">
                    <span>Port</span>
                    <input value={manualPort} inputMode="numeric" onChange={(e) => setManualPort(e.target.value)} />
                  </label>
                </div>
                <label className="modal-field">
                  <span>Host</span>
                  <input value={manualHost} onChange={(e) => setManualHost(e.target.value)} />
                </label>
                <label className="modal-field">
                  <span>Username</span>
                  <input value={manualUsername} onChange={(e) => setManualUsername(e.target.value)} />
                </label>
                <label className="modal-field">
                  <span>Password</span>
                  <input type="password" value={manualPassword} onChange={(e) => setManualPassword(e.target.value)} />
                </label>
              </>
            )}
            {manualError && <div className="error manual-proxy-error">{manualError}</div>}
            <div className="modal-actions">
              <button type="button" className="secondary" disabled={manualSaving} onClick={() => setManualProxyOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={manualSaving}>
                {manualSaving ? <Spinner size={13} /> : <Icon name="plus" size={13} />}
                Create
              </button>
            </div>
          </form>
        </div>
      ), document.body)}

      {confirmDelete && createPortal((
        <div className="modal-overlay">
          <div className="modal-card">
            <p>Delete profile “{confirmDelete}”?</p>
            <div className="row" style={{ marginTop: 12, gap: 8 }}>
              <button className="secondary" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button
                className="primary danger"
                onClick={() => {
                  s.deleteProfile(confirmDelete);
                  setConfirmDelete(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  );
}
