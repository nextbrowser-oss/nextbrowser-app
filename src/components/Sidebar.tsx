import { useStore } from "../store";
import { agentById } from "../agents";
import { BrandHeader, BrandLogo } from "./BrandLogo";
import { Icon, Spinner } from "./Icon";
import { withLocalScripts } from "../skillsCatalog";
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
