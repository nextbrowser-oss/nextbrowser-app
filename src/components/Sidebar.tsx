import { useStore } from "../store";
import { agentById } from "../agents";
import { BrandHeader, BrandLogo } from "./BrandLogo";
import { Icon, Spinner } from "./Icon";
import { withLocalScripts } from "../skillsCatalog";
import { countryFlag, countryLabel } from "../lib/countryFlag";
import type { AppTab } from "../types";

interface SidebarProps {
  onOpenAgentSettings: () => void;
}

const NAV_ITEMS: Array<{ id: AppTab; label: string; icon: string }> = [
  { id: "profiles", label: "Profiles", icon: "person.crop.circle" },
  { id: "skills", label: "Skills", icon: "square.grid.2x2.fill" },
  { id: "scheduled", label: "Scheduled", icon: "clock.arrow.circlepath" },
  { id: "guide", label: "Guide", icon: "book.fill" },
];

export function Sidebar({ onOpenAgentSettings }: SidebarProps) {
  const s = useStore();
  const agentName = agentById(s.agentId).name;
  const ready = s.agentReady();
  const defaultStatus = s.defaultSession?.status ?? "unknown";
  const defaultKnown = !!s.defaultSession?.session?.name || defaultStatus !== "unknown";
  const defaultRunning = defaultStatus === "running";
  const defaultBusy = ["starting", "stopping", "rotating"].includes(defaultStatus);
  const defaultIdentity = s.profileIdentities.__default;
  const showDefaultProfile = defaultKnown && !s.profiles.some((p) => p.name === "default");
  const visibleProfileCount = s.profiles.length + (showDefaultProfile ? 1 : 0);
  const skillCount = withLocalScripts(s.skillCategories).reduce((total, category) => total + category.entries.length, 0);

  const badgeFor = (id: AppTab) => {
    if (id === "profiles") return visibleProfileCount ? String(visibleProfileCount) : undefined;
    if (id === "skills") return skillCount ? String(skillCount) : undefined;
    if (id === "scheduled") return s.scheduledRuns.length ? String(s.scheduledRuns.length) : undefined;
    return undefined;
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

        <div className="claw-card sidebar-profiles-list-card">
          <div className="sidebar-profiles-head">
            <button className="scheduled-panel-toggle" title="Open profiles" onClick={() => s.setTab("profiles")}>
              <span className="section">PROFILES</span>
              <span className="profiles-count" title="Total profiles">{visibleProfileCount}</span>
            </button>
            <button
              className="plain-icon-btn plain-icon-btn-compact"
              title="Refresh profiles"
              disabled={s.isRefreshing}
              onClick={() => s.refreshSessions()}
            >
              {s.isRefreshing ? <Spinner size={12} /> : <Icon name="arrow.clockwise" size={12} />}
            </button>
          </div>
          <div className="sidebar-profile-list">
            {visibleProfileCount === 0 && (
              <button className="sidebar-profile-empty" title="Sign in to create profiles" onClick={() => s.setDashboardKeyPromptOpen(true)}>
                <Icon name="lock" size={13} />
                <span>No profiles yet</span>
              </button>
            )}
            {showDefaultProfile && (
              <SidebarProfileRow
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
              />
            )}
            {s.profiles.map((profile) => {
              const status = s.statuses[profile.name] ?? "unknown";
              const running = status === "running";
              const busy = ["starting", "stopping", "rotating"].includes(status);
              const identity = s.profileIdentities[profile.name];
              return (
                <SidebarProfileRow
                  key={profile.name}
                  name={profile.name}
                  status={status}
                  running={running}
                  busy={busy}
                  selected={s.selectedProfile === profile.name}
                  country={profile.country ?? identity?.country}
                  city={profile.city ?? identity?.city}
                  ip={identity?.ip}
                  onSelect={() => s.selectProfile(s.selectedProfile === profile.name ? undefined : profile.name)}
                  onStart={() => s.startProfile(profile.name)}
                  onStop={() => s.stopProfile(profile.name)}
                  onLive={() => {
                    s.selectProfile(profile.name);
                    s.setTab("live");
                  }}
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
          <span className={s.nextctlUpdateStatus.includes("fail") ? "warn" : ""}>
            · {s.nextctlUpdateStatus}
          </span>
        )}
        {!s.nextctlSupportsSkill && <span className="warn"> · no skill cmd</span>}
        <span className="spacer" />
        <button className="sign-out-footer" title="Sign out" onClick={() => s.logout()}>
          <Icon name="rectangle.portrait.and.arrow.right" size={13} />
          Sign out
        </button>
      </div>
    </div>
  );
}

function SidebarProfileRow({
  name,
  status,
  running,
  busy,
  selected,
  country,
  city,
  ip,
  onSelect,
  onStart,
  onStop,
  onLive,
}: {
  name: string;
  status: string;
  running: boolean;
  busy: boolean;
  selected: boolean;
  country?: string | null;
  city?: string | null;
  ip?: string | null;
  onSelect: () => void;
  onStart: () => void;
  onStop: () => void;
  onLive: () => void;
}) {
  return (
    <div className={"sidebar-profile-row" + (selected ? " selected" : "")} onClick={onSelect}>
      <span className={"dot " + (running ? "green" : busy ? "orange" : "gray")} title={status} />
      <span className="sidebar-profile-main">
        <span className="sidebar-profile-name-line">
          <span className="profile-name">{name}</span>
          {country && (
            <span className="badge profile-country-badge" title={countryLabel(country, city)}>
              {countryFlag(country)} {country.toUpperCase()}
            </span>
          )}
        </span>
        <span className="profile-meta">{ip ? `${status} · ${ip}` : status}</span>
      </span>
      <span className="spacer" />
      <button
        className="plain-icon-btn plain-icon-btn-compact"
        title={running ? `Stop ${name}` : `Start ${name}`}
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          void (running ? onStop() : onStart());
        }}
      >
        <Icon name={running ? "stop.fill" : "play.fill"} size={13} />
      </button>
      {running && (
        <button
          className="plain-icon-btn plain-icon-btn-compact"
          title="Live view"
          onClick={(event) => {
            event.stopPropagation();
            onLive();
          }}
        >
          <Icon name="video.fill" size={13} />
        </button>
      )}
    </div>
  );
}
