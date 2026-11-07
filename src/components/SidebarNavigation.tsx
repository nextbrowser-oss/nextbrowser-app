import { useState } from "react";
import { Glyph, Popover, Tooltip, type GlyphName } from "../shared/ui";
import { isUtilityDialogTab, type UtilityDialogTab } from "../lib/appNavigation";
import type { AppTab } from "../types";
import "./navigation.css";

const extensions: Array<{ id: AppTab; label: string; compact: string; icon: GlyphName }> = [
  { id: "skills", label: "Skills", compact: "Skills", icon: "sparkles" },
  { id: "connectors", label: "Connectors", compact: "Connect", icon: "plug" },
  { id: "mcp", label: "MCP", compact: "MCP", icon: "unplug" },
];
const destinations: typeof extensions = [
  { id: "scheduled", label: "Scheduled", compact: "Schedule", icon: "clock" },
  { id: "guide", label: "Guide", compact: "Guide", icon: "book-open" },
  { id: "live", label: "Live", compact: "Live", icon: "monitor" },
];

export function SidebarNavigation({ collapsed = false, tab, modal, badgeFor, onSelect }: {
  collapsed?: boolean;
  tab: AppTab;
  modal?: UtilityDialogTab;
  badgeFor: (tab: AppTab) => string | number | undefined;
  onSelect: (tab: AppTab) => void;
}) {
  const [extensionsOpen, setExtensionsOpen] = useState(false);
  const renderDestination = (item: typeof extensions[number], grouped = false) => {
    const badge = badgeFor(item.id);
    const opensDialog = isUtilityDialogTab(item.id);
    const button = <button type="button"
      className={"sidebar-destination" + ((opensDialog ? modal === item.id : tab === item.id) ? " active" : "")}
      aria-label={`Open ${item.label}${item.id === "live" ? " profiles" : ""}${badge != null && badge !== "" ? `, ${badge}` : ""}`}
      aria-current={!opensDialog && tab === item.id ? "page" : undefined}
      aria-haspopup={opensDialog ? "dialog" : undefined}
      aria-expanded={opensDialog ? modal === item.id : undefined}
      onClick={() => { setExtensionsOpen(false); onSelect(item.id); }}>
      <Glyph name={item.icon} />
      <span className="sidebar-destination-label">{collapsed && !grouped ? item.compact : item.label}</span>
      {badge != null && badge !== "" && <span className="sidebar-destination-count" aria-hidden="true">{badge}</span>}
    </button>;
    return grouped ? <div key={item.id}>{button}</div> : <Tooltip key={item.id} content={item.label} side="right">{button}</Tooltip>;
  };
  return (
    <nav className={"sidebar-destinations" + (collapsed ? " is-compact" : "")} aria-label="Sidebar pages">
      <Popover label="Extensions" open={extensionsOpen} onOpenChange={setExtensionsOpen} openOnHover side="right" align="start"
        className="sidebar-extensions shared-scrollbarless" trigger={props => <button {...props}
          className={"sidebar-destination" + (extensionsOpen || (modal ? extensions.some(item => item.id === modal) : tab === "skills") ? " active" : "")}
          aria-label="Open Extensions">
          <Glyph name="blocks" /><span className="sidebar-destination-label">Extensions</span>
        </button>}>
        <div className="sidebar-extensions-heading">Extensions</div>
        {extensions.map(item => renderDestination(item, true))}
      </Popover>
      {destinations.map(item => renderDestination(item))}
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
