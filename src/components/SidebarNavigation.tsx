import { Glyph, Tooltip, type GlyphName } from "../shared/ui";
import type { AppTab } from "../types";
import "./navigation.css";

const destinations: Array<{ id: AppTab; label: string; compact: string; icon: GlyphName }> = [
  { id: "skills", label: "Skills", compact: "Skills", icon: "sparkles" },
  { id: "connectors", label: "Connectors", compact: "Connect", icon: "plug" },
  { id: "scheduled", label: "Scheduled", compact: "Schedule", icon: "clock" },
  { id: "guide", label: "Guide", compact: "Guide", icon: "book-open" },
  { id: "live", label: "Live", compact: "Live", icon: "monitor" },
];

export function SidebarNavigation({ collapsed = false, tab, badgeFor, onSelect }: {
  collapsed?: boolean;
  tab: AppTab;
  badgeFor: (tab: AppTab) => string | number | undefined;
  onSelect: (tab: AppTab) => void;
}) {
  return (
    <nav className={"sidebar-destinations" + (collapsed ? " is-compact" : "")} aria-label="Sidebar pages">
      {destinations.map((item) => {
        const badge = badgeFor(item.id);
        return (
          <Tooltip key={item.id} content={item.label} side="right"><button type="button"
            className={"sidebar-destination" + (tab === item.id ? " active" : "")}
            aria-label={`Open ${item.label}${item.id === "live" ? " profiles" : ""}${badge != null && badge !== "" ? `, ${badge}` : ""}`}
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => onSelect(item.id)}>
            <Glyph name={item.icon} />
            <span className="sidebar-destination-label">{collapsed ? item.compact : item.label}</span>
            {badge != null && badge !== "" && <span className="sidebar-destination-count" aria-hidden="true">{badge}</span>}
          </button></Tooltip>
        );
      })}
    </nav>
  );
}

export function SidebarSettingsButton({ collapsed = false, attention = false, onClick }: { collapsed?: boolean; attention?: boolean; onClick: () => void }) {
  return <Tooltip content={attention ? "Settings — update available" : "Settings"} side="right">
    <button type="button" className={"sidebar-settings-button" + (collapsed ? " is-compact" : "")} onClick={onClick} aria-label={attention ? "Settings, update available" : "Settings"}>
      <Glyph name="sliders" /><span>Settings</span>{attention && <span className="sidebar-settings-dot" aria-hidden="true" />}
    </button>
  </Tooltip>;
}
