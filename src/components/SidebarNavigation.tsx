import { Tooltip } from "../shared/ui";
import type { AppTab } from "../types";
import { Icon } from "./Icon";

const destinations: Array<{ id: AppTab; label: string; compact: string; icon: string }> = [
  { id: "skills", label: "Skills", compact: "Skills", icon: "square.grid.2x2.fill" },
  { id: "connectors", label: "Connectors", compact: "Connect", icon: "network" },
  { id: "scheduled", label: "Scheduled", compact: "Schedule", icon: "clock.arrow.circlepath" },
  { id: "guide", label: "Guide", compact: "Guide", icon: "book.fill" },
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
            aria-label={`Open ${item.label}${badge != null && badge !== "" ? `, ${badge}` : ""}`}
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => onSelect(item.id)}>
            <Icon name={item.icon} size={18} />
            <span className="sidebar-destination-label">{collapsed ? item.compact : item.label}</span>
            {badge != null && badge !== "" && <span className="sidebar-destination-count" aria-hidden="true">{badge}</span>}
          </button></Tooltip>
        );
      })}
    </nav>
  );
}
