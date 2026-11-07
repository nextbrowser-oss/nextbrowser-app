import { useState } from "react";
import { Popover, Tooltip } from "../shared/ui";
import { useStore } from "../store";
import { Icon } from "./Icon";

export function RecentProjects({ title, activeId }: { title: string; activeId?: string }) {
  const [open, setOpen] = useState(false);
  const conversations = useStore(state => state.conversations);
  const workspaces = useStore(state => state.workspaces);
  const select = useStore(state => state.selectConversation);
  const projects = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
  return <Popover label="Recent projects" open={open} onOpenChange={setOpen}
    className="recent-projects" trigger={props => <Tooltip content="Switch project"><button {...props} className="chat-project-switcher">
      <strong>{title}</strong><Icon name="chevron.down" size={12} />
    </button></Tooltip>}>
    <div className="chat-popover-heading">Recent projects</div>
    {projects.length ? projects.map(project => <button key={project.id} className="recent-project-option"
      aria-current={project.id === activeId ? "true" : undefined} onClick={() => { setOpen(false); select(project.id); }}>
      <span><strong>{project.title}</strong><small>{workspaces.find(workspace => workspace.id === project.workspaceId)?.name ?? "Personal workspace"}</small></span>
      {project.id === activeId && <Icon name="checkmark" size={14} />}
    </button>) : <p className="chat-popover-empty">No recent projects yet.</p>}
  </Popover>;
}
