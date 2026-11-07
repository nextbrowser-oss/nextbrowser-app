import { useEffect, useState, type RefObject } from "react";
import { glassSurfaceClassName, Popover, Tooltip } from "../shared/ui";
import { useStore } from "../store";
import { Icon } from "./Icon";

export function RecentProjects({ title, activeId, open: controlledOpen, onOpenChange, boundaryRef }: { title: string; activeId?: string; open?: boolean; onOpenChange?: (open: boolean) => void; boundaryRef?: RefObject<HTMLElement> }) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const [query, setQuery] = useState("");
  useEffect(() => { if (!open) setQuery(""); }, [open]);
  const conversations = useStore(state => state.conversations);
  const workspaces = useStore(state => state.workspaces);
  const select = useStore(state => state.selectConversation);
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  const search = query.trim().toLocaleLowerCase();
  const projects = search ? sorted.filter(project => project.title.toLocaleLowerCase().includes(search)) : sorted.slice(0, 8);
  return <Popover label="Recent projects" open={open} onOpenChange={setOpen} align="start" boundaryRef={boundaryRef}
    className="recent-projects" trigger={props => <Tooltip content="Switch project"><button {...props} className={`${glassSurfaceClassName} chat-project-switcher`}>
      <strong>{title}</strong><Icon name="chevron.down" size={12} />
    </button></Tooltip>}>
    <label className="project-search"><Icon name="magnifyingglass" size={13} /><input type="search" aria-label="Search projects" placeholder="Search projects" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <div className="recent-project-list shared-scrollbarless">
    {projects.length ? projects.map(project => <button key={project.id} className="recent-project-option"
      aria-current={project.id === activeId ? "true" : undefined} onClick={() => { setOpen(false); select(project.id); }}>
      <span><strong>{project.title}</strong><small>{workspaces.find(workspace => workspace.id === project.workspaceId)?.name ?? "Personal workspace"}</small></span>
      {project.id === activeId && <Icon name="checkmark" size={14} />}
    </button>) : <p className="chat-popover-empty">{search ? "No matching projects." : "No recent projects yet."}</p>}
    </div>
  </Popover>;
}
