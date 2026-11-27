import { translate } from "../shared/lib/i18n";
import { useState, type ReactNode } from "react";
import { Glyph, Popover, Tooltip, type GlyphName } from "../shared/ui";
import { isUtilityDialogTab, type UtilityDialogTab } from "../lib/appNavigation";
import type { AppTab } from "../types";
import "./navigation.css";

const extensions: Array<{ id: AppTab; label: string; compact: string; icon: GlyphName }> = [
  { id: "mini-apps", get label() { return translate("Mini Apps"); }, get compact() { return translate("Mini Apps"); }, icon: "layout-grid" },
  { id: "skills", get label() { return translate("Skills"); }, get compact() { return translate("Skills"); }, icon: "sparkles" },
  { id: "connectors", get label() { return translate("Connectors"); }, get compact() { return translate("Connect"); }, icon: "plug" },
  { id: "mcp", label: "MCP", compact: "MCP", icon: "unplug" },
];
const destinations: typeof extensions = [
  { id: "scheduled", get label() { return translate("Scheduled"); }, get compact() { return translate("Schedule"); }, icon: "clock" },
  { id: "guide", get label() { return translate("Guide"); }, get compact() { return translate("Guide"); }, icon: "book-open" },
  { id: "live", get label() { return translate("Processes"); }, get compact() { return translate("Processes"); }, icon: "activity" },
];

export function SidebarNavigation({ collapsed = false, tab, modal, badgeFor, onSelect, liveDestination, pinnedApps }: {
  collapsed?: boolean;
  tab: AppTab;
  modal?: UtilityDialogTab;
  badgeFor: (tab: AppTab) => string | number | undefined;
  onSelect: (tab: AppTab) => void;
  liveDestination?: ReactNode;
  pinnedApps?: ReactNode;
}) {
  const [extensionsOpen, setExtensionsOpen] = useState(false);
  const renderDestination = (item: typeof extensions[number], grouped = false) => {
    const badge = badgeFor(item.id);
    const opensDialog = isUtilityDialogTab(item.id);
    const button = <button type="button"
      className={"sidebar-destination" + ((opensDialog ? modal === item.id : tab === item.id) ? " active" : "")}
      aria-label={translate("Open %1%2", item.label, badge != null && badge !== "" ? `, ${badge}` : "")}
      aria-current={!opensDialog && tab === item.id ? "page" : undefined}
      aria-haspopup={opensDialog ? "dialog" : undefined}
      aria-expanded={opensDialog ? modal === item.id : undefined}
      onClick={() => { setExtensionsOpen(false); onSelect(item.id); }}>
      <Glyph name={item.icon} />
      {(grouped || !collapsed) && <span className="sidebar-destination-label">{item.label}</span>}
      {badge != null && badge !== "" && <span className="sidebar-destination-count" aria-hidden="true">{badge}</span>}
    </button>;
    return grouped ? <div key={item.id}>{button}</div> : <Tooltip key={item.id} content={collapsed ? item.compact : item.label} side="right">{button}</Tooltip>;
  };
  return (
    <nav className={"sidebar-destinations" + (collapsed ? " is-compact" : "")} aria-label={translate("Sidebar pages")}>
      <Popover label={translate("Extensions")} open={extensionsOpen} onOpenChange={setExtensionsOpen} openOnHover side="right" align="start"
        className="sidebar-extensions shared-scrollbarless" trigger={props => <button {...props}
          className={"sidebar-destination" + (extensionsOpen || extensions.some(item => item.id === (modal ?? tab)) ? " active" : "")}
          aria-label={translate("Open Extensions")}>
          <Glyph name="puzzle" />{!collapsed && <span className="sidebar-destination-label">{translate("Extensions")}</span>}
        </button>}>
        <div className="rail-popover-heading">{translate("Extensions")}</div>
        {extensions.map(item => renderDestination(item, true))}
      </Popover>
      {destinations.map(item => item.id === "live" && liveDestination ? null : renderDestination(item))}
      {liveDestination}
      {pinnedApps}
    </nav>
  );
}

export function SidebarSettingsButton({ collapsed = false, attention = false, onClick }: { collapsed?: boolean; attention?: boolean; onClick: () => void }) {
  return <Tooltip content={attention ? translate("Settings — update available") : translate("Settings")} side="right">
    <button type="button" className={"sidebar-settings-button" + (collapsed ? " is-compact" : "")} onClick={onClick} aria-label={attention ? translate("Settings, update available") : translate("Settings")}>
      <Glyph name="sliders" />{!collapsed && <span>{translate("Settings")}</span>}{attention && <span className="sidebar-settings-dot" aria-hidden="true" />}
    </button>
  </Tooltip>;
}
