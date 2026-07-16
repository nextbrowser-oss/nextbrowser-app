import { type FormEvent, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useStore, type ManualProxyProfileInput } from "../store";
import { PRIMARY_AGENTS, ADDITIONAL_AGENTS, agentById } from "../agents";
import { BrandHeader, BrandLogo } from "./BrandLogo";
import { ScheduledRunsPanel } from "./ScheduledRunsPanel";
import { Icon, Spinner } from "./Icon";
import { countryFlag, countryLabel, ROTATION_COUNTRIES } from "../lib/countryFlag";
import { manualProxyDefaultName, parseManualProxyUrl, type ManualProxyScheme } from "../lib/manualProxy";

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
  const ready = s.agentReady();
  const version = s.agentVersion();
  const error = s.agentError();
  const loggedIn = s.agentLoggedIn();
  const profiles = s.filteredProfiles();
  const defaultStatus = s.defaultSession?.status ?? "unknown";
  const defaultKnown = !!s.defaultSession?.session?.name || defaultStatus !== "unknown";
  const defaultRunning = defaultStatus === "running";
  const defaultBusy = ["starting", "stopping", "rotating"].includes(defaultStatus);
  const defaultIdentity = s.profileIdentities.__default;
  const showDefaultProfile = defaultKnown && !s.profiles.some((p) => p.name === "default");
  const visibleProfileCount = s.profiles.length + (showDefaultProfile ? 1 : 0);
  const agentName =
    PRIMARY_AGENTS.concat(ADDITIONAL_AGENTS).find((a) => a.id === s.agentId)?.name ?? "agent";

  if (s.sidebarCollapsed) {
    const runningCount = s.profiles.filter((p) => s.statuses[p.name] === "running").length + (showDefaultProfile ? 1 : 0);
    return (
      <div className="sidebar-mini">
        <button
          className="plain-icon-btn sidebar-collapse-toggle"
          title="Expand sidebar"
          aria-label="Expand sidebar"
          onClick={() => s.setSidebarCollapsed(false)}
        >
          <Icon name="sidebar.left" size={17} />
        </button>
        <BrandLogo size={28} />
        <button className="mini-nav-btn" title={`Agent: ${agentName}`} onClick={() => s.setTab("chat")}>
          <Icon name="cpu.fill" size={18} />
          <span>{s.agentReady() ? "on" : "off"}</span>
        </button>
        <button className="mini-nav-btn" title={`${visibleProfileCount} profiles, ${runningCount} running`} onClick={() => s.setTab("live")}>
          <Icon name="person.crop.circle" size={18} />
          <span>{runningCount}/{visibleProfileCount}</span>
        </button>
        <span className="spacer" />
        <button className="mini-nav-btn" title="Sign out" onClick={() => s.logout()}>
          <Icon name="rectangle.portrait.and.arrow.right" size={18} />
        </button>
      </div>
    );
  }

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
        <div className="row">
          <BrandHeader subtitle="native agent console" />
          <span className="spacer" />
          <button
            className="plain-icon-btn plain-icon-btn-compact sidebar-collapse-toggle"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            onClick={() => s.setSidebarCollapsed(true)}
          >
            <Icon name="sidebar.leading" size={15} />
          </button>
        </div>
      </div>

      <div className="sidebar-scroll">
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
                title={`Switch to ${a.name}`}
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
              <button className="plain-icon-btn plain-icon-btn-compact" title="Clear agent search" onClick={() => setAgentSearch("")}>
                <Icon name="xmark.circle.fill" size={14} className="muted" />
              </button>
            )}
          </div>
          {(agentSearch ? matches : focused ? suggestions : []).map((a) => (
            <button
              key={a.id}
              className="agent-row"
              title={`Switch to ${a.name}`}
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
              <button className="btn-bordered-prominent connect-btn full" title={`Connect ${agentName}`} onClick={() => s.authorizeAgent()}>
                <Icon name="bolt.fill" size={14} />
                Connect to chat
              </button>
            )}
            {ready && loggedIn !== true && (
              <button className="btn-bordered full agent-login-btn" title={`Open ${agentName} login`} onClick={() => s.loginAgent()}>
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
              <div className="section">PROFILES</div>
              <div className="card-title">Profiles</div>
            </div>
            <span className="profiles-count" title="Total profiles">{visibleProfileCount}</span>
            <button
              className="mini proxy-profile-btn"
              title="Add manual proxy profile"
              onClick={() => {
                resetManualProxyForm();
                setManualProxyOpen(true);
              }}
            >
              Proxy
            </button>
            <button
              className="plain-icon-btn plain-icon-btn-compact"
              title="Refresh profiles"
              disabled={s.isRefreshing}
              onClick={() => s.refreshSessions()}
            >
              {s.isRefreshing ? <Spinner size={12} /> : <Icon name="arrow.clockwise" size={12} />}
            </button>
            <span className="spacer" />
            {s.anyAgentRunning() && <Spinner size={12} />}
          </div>
          <div className="session-quick-actions">
            <button
              className="btn-bordered full"
              title={s.selectedProfile ? `Start selected profile: ${s.selectedProfile}` : "Start default profile"}
              disabled={s.isRefreshing}
              onClick={() => void (s.selectedProfile ? s.startProfile(s.selectedProfile) : s.startDefaultSession())}
            >
              <Icon name="play.fill" size={14} />
              {s.selectedProfile ? "Start selected profile" : "Start default profile"}
            </button>
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
            {visibleProfileCount === 0 && (
              <div className="inline-empty">
                <Icon name="person.crop.circle" size={18} className="muted" />
                <div>
                  <strong>No profiles yet</strong>
                </div>
              </div>
            )}
            {visibleProfileCount === 0 && !s.proxy && (
              <button className="btn-bordered full empty-action-button" title="Enter dashboard key to unlock managed profiles" onClick={() => s.setDashboardKeyPromptOpen(true)}>
                <Icon name="lock" size={14} />
                Enter dashboard key before first profile
              </button>
            )}
            {showDefaultProfile && (
              <div
                className={"profile-row" + (!s.selectedProfile ? " selected" : "")}
                onClick={() => s.selectProfile(undefined)}
              >
                <span className={"dot " + (defaultRunning ? "green" : defaultBusy ? "orange" : "gray")} title={defaultStatus} />
                <span className="profile-main">
                  <span className="profile-title-line">
                    <span className="profile-name">default</span>
                    {defaultIdentity?.country && (
                      <span className="badge profile-country-badge" title={countryLabel(defaultIdentity.country, defaultIdentity.city)}>
                        {countryFlag(defaultIdentity.country)} {defaultIdentity.country.toUpperCase()}
                      </span>
                    )}
                  </span>
                  <span className="profile-meta">
                    {defaultIdentity?.ip ? `${defaultStatus} · ${defaultIdentity.ip}` : defaultStatus}
                  </span>
                </span>
                <span className="spacer" />
                <div className="profile-actions">
                  {defaultRunning ? (
                    <>
                      <button
                        className="plain-icon-btn"
                        title="Stop default"
                        disabled={defaultBusy}
                        onClick={(e) => { e.stopPropagation(); void s.stopDefaultSession(); }}
                      >
                        <Icon name="stop.fill" size={16} />
                      </button>
                      <button
                        className="plain-icon-btn"
                        title="Live view"
                        onClick={(e) => {
                          e.stopPropagation();
                          s.selectProfile(undefined);
                          s.setTab("live");
                        }}
                      >
                        <Icon name="video.fill" size={16} />
                      </button>
                    </>
                  ) : (
                    <button
                      className="plain-icon-btn"
                      title="Start default"
                      disabled={defaultBusy}
                      onClick={(e) => { e.stopPropagation(); void s.startDefaultSession(); }}
                    >
                      <Icon name="play.fill" size={16} />
                    </button>
                  )}
                  <button
                    className="plain-icon-btn"
                    title="Profile actions"
                    disabled={defaultBusy}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuProfile("__default");
                    }}
                  >
                    <Icon name="ellipsis.circle" size={18} />
                  </button>
                </div>
              </div>
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
              const identity = s.profileIdentities[p.name];
              const profileCountry = p.country ?? identity?.country;
              const profileCity = p.city ?? identity?.city;
              return (
                <div
                  key={p.name}
                  className={"profile-row" + (selected ? " selected" : "")}
                  onClick={() => s.selectProfile(selected ? undefined : p.name)}
                >
                  <span className={"dot " + (running ? "green" : busy ? "orange" : "gray")} title={status} />
                  <span className="profile-main">
                    <span className="profile-title-line">
                      <span className="profile-name">{p.name}</span>
                      {profileCountry && (
                        <span className="badge profile-country-badge" title={countryLabel(profileCountry, profileCity)}>
                          {countryFlag(profileCountry)} {profileCountry.toUpperCase()}
                        </span>
                      )}
                    </span>
                    <span className="profile-meta">
                      {identity?.ip ? `${status} · ${identity.ip}` : profileCountry ? countryLabel(profileCountry, profileCity) : manual ? "Manual proxy" : status}
                    </span>
                  </span>
                  <span className="profile-badges">
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
                        title={`Stop ${p.name}`}
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
        const isDefaultProfile = menuProfile === "__default";
        const prof = s.profiles.find((p) => p.name === menuProfile);
        const identity = isDefaultProfile ? s.profileIdentities.__default : s.profileIdentities[menuProfile];
        const activeCountry = (isDefaultProfile ? identity?.country : prof?.country ?? identity?.country)?.toLowerCase();
        const status = isDefaultProfile ? defaultStatus : s.statuses[menuProfile] ?? "unknown";
        const manual = prof?.proxy_mode === "manual" && prof.manual_proxy;
        return (
          <div className="modal-overlay" onClick={() => setMenuProfile(null)}>
            <div className="modal-card profile-menu" onClick={(e) => e.stopPropagation()}>
              <div className="profile-menu-head">
                <span
                  className={"dot " + (status === "running" ? "green" : status === "unknown" ? "gray" : "orange")}
                  title={status}
                />
                <span className="profile-menu-name">{isDefaultProfile ? "default" : menuProfile}</span>
                {activeCountry && (
                  <span className="badge profile-country-badge" title={countryLabel(activeCountry, identity?.city ?? prof?.city)}>
                    {countryFlag(activeCountry)} {activeCountry.toUpperCase()}
                  </span>
                )}
                {identity?.ip && <span className="badge profile-ip-badge" title="Current proxy IP">{identity.ip}</span>}
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
                  if (isDefaultProfile) s.rotateDefaultSession();
                  else s.rotateProfile(menuProfile);
                  setMenuProfile(null);
                }}
              >
                <Icon name="arrow.triangle.2.circlepath" size={14} strokeWidth={2.25} />
                {manual ? "Restart profile" : "Rotate IP"}
              </button>

              {!manual && (
                <>
                  <div className="section profile-menu-label">Rotate country</div>
                  <div className="country-grid">
                    {ROTATION_COUNTRIES.map((c) => (
                      <button
                        key={c.code}
                        className={"mini country-chip" + (activeCountry === c.code.toLowerCase() ? " active" : "")}
                        title={activeCountry === c.code.toLowerCase() ? `Current country: ${c.code} — ${c.name}` : `${c.code} — ${c.name}`}
                        onClick={() => {
                          if (isDefaultProfile) s.rotateDefaultSessionCountry(c.code);
                          else s.rotateProfileCountry(menuProfile, c.code);
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

              {!isDefaultProfile && (
                <>
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
                </>
              )}
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
