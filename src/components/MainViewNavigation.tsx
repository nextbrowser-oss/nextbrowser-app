import { glassSurfaceClassName, Glyph, Tooltip } from "../shared/ui";
import { useStore } from "../store";
import "./mainViewNavigation.css";

const views = [
  { id: "chat", label: "Project", icon: "folder" },
  { id: "live", label: "Live", icon: "video" },
  { id: "automation", label: "Automation", icon: "branch" },
] as const;

export function MainViewNavigation() {
  const tab = useStore(state => state.tab);
  const select = useStore(state => state.setTab);
  return <div className={`${glassSurfaceClassName} main-view-navigation`} role="tablist" aria-label="Main views">
    {views.map(view => <Tooltip key={view.id} content={view.label}><button type="button" role="tab"
      aria-label={`Open ${view.label}`} aria-selected={tab === view.id} onClick={() => select(view.id)}>
      <Glyph name={view.icon} size={14} /><span>{view.label}</span>
    </button></Tooltip>)}
  </div>;
}
