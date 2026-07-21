import { type FormEvent, useState } from "react";
import { createPortal } from "react-dom";
import { useStore, type ManualProxyProfileInput } from "../store";
import { agentById } from "../agents";
import { BrandHeader, BrandLogo } from "./BrandLogo";
import { Icon, Spinner } from "./Icon";
import { withLocalScripts } from "../skillsCatalog";
import { countryFlag, countryLabel, ROTATION_COUNTRIES } from "../lib/countryFlag";
import { manualProxyDefaultName, parseManualProxyUrl, type ManualProxyScheme } from "../lib/manualProxy";
import { internalError, needsSupportLink } from "../lib/userFacingError";
import type { AppTab } from "../types";
import { UserFacingError } from "./UserFacingError";

type ManualProxyInputMode = "url" | "fields";

interface SidebarProps {
  onOpenAgentSettings: () => void;
}

const NAV_ITEMS: Array<{ id: AppTab; label: string; icon: string }> = [
  { id: "skills", label: "Skills", icon: "square.grid.2x2.fill" },
  { id: "scheduled", label: "Scheduled", icon: "clock.arrow.circlepath" },
  { id: "guide", label: "Guide", icon: "book.fill" },
];

export function Sidebar({ onOpenAgentSettings }: SidebarProps) {
  const s = useStore();
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

  const agentName = agentById(s.agentId).name;
  const ready = s.agentReady();
  const profiles = s.filteredProfiles();
  const skillCount = withLocalScripts(s.skillCategories).reduce((total, category) => total + category.entries.length, 0);
  const defaultStatus = s.defaultSession?.status ?? "unknown";
  const defaultKnown = !!s.defaultSession?.session?.name || defaultStatus !== "unknown";
  const defaultRunning = defaultStatus === "running";
  const defaultBusy = ["starting", "stopping", "rotating"].includes(defaultStatus);
  const defaultIdentity = s.profileIdentities.__default;
  const showDefaultProfile = defaultKnown && !s.profiles.some((p) => p.name === "default");
  const visibleProfileCount = s.profiles.length + (showDefaultProfile ? 1 : 0);
  const runningCount = s.profiles.filter((p) => s.statuses[p.name] === "running").length + (defaultRunning ? 1 : 0);

  const badgeFor = (id: AppTab) => {
    if (id === "skills") return skillCount ? String(skillCount) : undefined;
    if (id === "scheduled") return s.scheduledRuns.length ? String(s.scheduledRuns.length) : undefined;
    return undefined;
  };

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
    } catch {
      setManualError(internalError("We couldn't create the proxy profile."));
    } finally {
      setManualSaving(false);
    }
  };

  if (s.sidebarCollapsed) {
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
        <button className="mini-nav-btn" title={`Agent: ${agentName}`} onClick={onOpenAgentSettings}>
          <Icon name="cpu.fill" size={18} />
          <span>{ready ? "on" : "off"}</span>
        </button>
        <button className="mini-nav-btn" title={`${visibleProfileCount} profiles, ${runningCount} running`} onClick={() => s.setTab("live")}>
          <Icon name="person.crop.circle" size={18} />
          <span>{runningCount}/{visibleProfileCount}</span>
        </button>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={"mini-nav-btn" + (s.tab === item.id ? " active" : "")}
            title={`Open ${item.label}`}
            onClick={() => s.setTab(item.id)}
          >
            <Icon name={item.icon} size={18} />
            {badgeFor(item.id) && <span>{badgeFor(item.id)}</span>}
          </button>
        ))}
        <span className="spacer" />
        <button className="mini-nav-btn" title="Sign out" onClick={() => s.logout()}>
          <Icon name="rectangle.portrait.and.arrow.right" size={18} />
        </button>
      </div>
    );
  }

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
        <button className="sidebar-agent-strip" title="Open agent settings" onClick={onOpenAgentSettings}>
          <Icon name="cpu.fill" size={13} />
          <span className="muted small">Agent</span>
          <strong>{agentName}</strong>
          <span className={"agent-state-pill" + (ready ? " is-ready" : "")}>
            {ready ? "Ready" : "Offline"}
          </span>
        </button>
      </div>

      <nav className="sidebar-scroll sidebar-nav-list" aria-label="Sidebar pages">
        {NAV_ITEMS.map((item) => {
          const badge = badgeFor(item.id);
          return (
            <button
              key={item.id}
              className={"claw-card sidebar-link-card sidebar-page-link" + (s.tab === item.id ? " active" : "")}
              title={`Open ${item.label}`}
              onClick={() => s.setTab(item.id)}
            >
              <Icon name={item.icon} size={14} />
              <span className="section">{item.label}</span>
              <span className="spacer" />
              {badge && <span className="profiles-count">{badge}</span>}
            </button>
          );
        })}

        <div className="claw-card control-card profiles-card">
          <div className="row profiles-panel-head">
            <div className="scheduled-panel-toggle profiles-panel-toggle">
              <Icon name="person.crop.circle" size={13} />
              <span className="section">Profiles</span>
              <span className="profiles-count" title="Total profiles">{visibleProfileCount}</span>
            </div>
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
              title="Create a new managed profile"
              disabled={s.isRefreshing}
              onClick={() => void s.createManagedProfile()}
            >
              <Icon name="plus" size={14} />
              New profile
            </button>
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
          </div>

          <div className="search-box">
            <Icon name="magnifyingglass" size={12} className="muted" />
            <input
              className="search-inline"
              placeholder="Search profiles..."
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
              <button className="btn-bordered full empty-action-button" title="Sign in to create managed profiles" onClick={() => s.setDashboardKeyPromptOpen(true)}>
                <Icon name="lock" size={14} />
                Sign in to create profiles
              </button>
            )}
            {showDefaultProfile && (
              <ProfileRow
                name="default"
                status={defaultStatus}
                running={defaultRunning}
                busy={defaultBusy}
                selected={!s.selectedProfile}
                country={defaultIdentity?.country}
                city={defaultIdentity?.city}
                ip={defaultIdentity?.ip}
                onSelect={() => s.selectProfile(undefined)}
                onStart={() => s.startDefaultSession()}
                onStop={() => s.stopDefaultSession()}
                onLive={() => {
                  s.selectProfile(undefined);
                  s.setTab("live");
                }}
                onMenu={() => setMenuProfile("__default")}
              />
            )}
            {s.profiles.length > 0 && profiles.length === 0 && (
              <div className="muted small">No matches for "{s.profileSearch}".</div>
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
                <ProfileRow
                  key={p.name}
                  name={p.name}
                  status={status}
                  running={running}
                  busy={busy}
                  selected={selected}
                  country={profileCountry}
                  city={profileCity}
                  ip={identity?.ip}
                  manualScheme={manual ? p.manual_proxy?.scheme : undefined}
                  manualTitle={manual ? `${p.manual_proxy?.host ?? ""}:${p.manual_proxy?.port ?? ""}` : undefined}
                  onSelect={() => s.selectProfile(selected ? undefined : p.name)}
                  onStart={() => s.startProfile(p.name)}
                  onStop={() => s.stopProfile(p.name)}
                  onLive={() => {
                    s.selectProfile(p.name);
                    s.setTab("live");
                  }}
                  onMenu={() => setMenuProfile(p.name)}
                />
              );
            })}
          </div>
        </div>
      </nav>

      <hr className="divider" />
      <div className="nextctl-footer muted small">
        <Icon name="terminal" size={12} />
        <span>nextctl {s.nextctlVersion || "..."}</span>
        <button
          className="plain-icon-btn plain-icon-btn-compact nextctl-refresh"
          title="Check for a newer nextctl and update"
          disabled={s.nextctlUpdating}
          onClick={() => s.checkNextctlUpdate()}
        >
          {s.nextctlUpdating ? <Spinner size={12} /> : <Icon name="arrow.triangle.2.circlepath" size={12} />}
        </button>
        {s.nextctlUpdateStatus && (
          <span className={needsSupportLink(s.nextctlUpdateStatus) ? "warn" : ""}>
            · <UserFacingError message={s.nextctlUpdateStatus} surface="component_update" />
          </span>
        )}
        {!s.nextctlSupportsSkill && <span className="warn"> · no skill cmd</span>}
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
                <button className="plain-icon-btn" title="Close" onClick={() => setMenuProfile(null)}>
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
                        title={activeCountry === c.code.toLowerCase() ? `Current country: ${c.code} - ${c.name}` : `${c.code} - ${c.name}`}
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
            {manualError && (
              <div className="error manual-proxy-error">
                <UserFacingError message={manualError} surface="manual_proxy" />
              </div>
            )}
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
            <p>Delete profile "{confirmDelete}"?</p>
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

function ProfileRow({
  name,
  status,
  running,
  busy,
  selected,
  country,
  city,
  ip,
  manualScheme,
  manualTitle,
  onSelect,
  onStart,
  onStop,
  onLive,
  onMenu,
}: {
  name: string;
  status: string;
  running: boolean;
  busy: boolean;
  selected: boolean;
  country?: string | null;
  city?: string | null;
  ip?: string | null;
  manualScheme?: string | null;
  manualTitle?: string;
  onSelect: () => void;
  onStart: () => void;
  onStop: () => void;
  onLive: () => void;
  onMenu: () => void;
}) {
  return (
    <div className={"profile-row" + (selected ? " selected" : "")} onClick={onSelect}>
      <span className={"dot " + (running ? "green" : busy ? "orange" : "gray")} title={status} />
      <span className="profile-main">
        <span className="profile-title-line">
          <span className="profile-name">{name}</span>
          {country && (
            <span className="badge profile-country-badge" title={countryLabel(country, city)}>
              {countryFlag(country)} {country.toUpperCase()}
            </span>
          )}
        </span>
        <span className="profile-meta">
          {ip ? `${status} · ${ip}` : status}
        </span>
      </span>
      <span className="profile-badges">
        {manualScheme && (
          <span className="badge manual-proxy-badge" title={manualTitle}>
            {manualScheme.toUpperCase()}
          </span>
        )}
      </span>
      <span className="spacer" />
      <div className="profile-actions">
        {running ? (
          <>
            <button
              className="plain-icon-btn"
              title={`Stop ${name}`}
              aria-label={`Stop ${name}`}
              data-tooltip={`Stop ${name}`}
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                void onStop();
              }}
            >
              <Icon name="stop.fill" size={16} />
            </button>
            <button
              className="plain-icon-btn"
              title="Live view"
              aria-label={`Open live view for ${name}`}
              data-tooltip="Live view"
              onClick={(event) => {
                event.stopPropagation();
                onLive();
              }}
            >
              <Icon name="video.fill" size={16} />
            </button>
          </>
        ) : (
          <button
            className="plain-icon-btn"
            title={`Start ${name}`}
            aria-label={`Start ${name}`}
            data-tooltip={`Start ${name}`}
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              void onStart();
            }}
          >
            <Icon name="play.fill" size={16} />
          </button>
        )}
        <button
          className="plain-icon-btn"
          title="Profile actions"
          aria-label={`Profile actions for ${name}`}
          data-tooltip="Actions"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onMenu();
          }}
        >
          <Icon name="ellipsis.circle" size={18} />
        </button>
      </div>
    </div>
  );
}
