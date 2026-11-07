import { useEffect, useState, type RefObject } from "react";
import { Glyph, IconButton, Popover } from "../shared/ui";
import { useStore } from "../store";
import { Icon } from "./Icon";
import { ProjectTree } from "./ProjectTree";
import { projectRoot } from "../lib/projectTree";

export function RecentProjects({ activeId, open: controlledOpen, onOpenChange, boundaryRef }: { title?: string; activeId?: string; open?: boolean; onOpenChange?: (open: boolean) => void; boundaryRef?: RefObject<HTMLElement> }) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const [query, setQuery] = useState("");
  useEffect(() => { if (!open) setQuery(""); }, [open]);
  const conversations = useStore(state => state.conversations);
  const agentId = useStore(state => state.agentId);
  const activeConvId = useStore(state => state.activeConvId);
  const createSession = useStore(state => state.createProjectSession);
  const setTab = useStore(state => state.setTab);
  const current = conversations.find(item => item.id === (activeId ?? activeConvId[agentId]));
  const root = current && projectRoot(current, conversations);
  return <Popover label="Projects" open={open} onOpenChange={setOpen} align="start" side="right" boundaryRef={boundaryRef}
    className="recent-projects shared-scrollbarless" trigger={props => <button {...props} className="sidebar-destination" aria-label="Open Projects">
      <Glyph name="folder" /><span className="sidebar-destination-label">Projects</span>
    </button>}>
    <div className="project-popover-toolbar">
      <label className="project-search"><Icon name="magnifyingglass" size={13} /><input type="search" aria-label="Search projects" placeholder="Search projects" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <IconButton label="Create project" appearance="plain" size="small" className="project-new-session" onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent("nextbrowser:create-project")); }}><Glyph name="folder" size={14} /></IconButton>
      <IconButton label="New session" disabled={!root} appearance="plain" size="small" className="project-new-session" onClick={() => { if (root && createSession(root.id)) { setOpen(false); setTab("chat"); } }}><Icon name="plus" size={14} /></IconButton>
    </div>
    <div className="recent-project-list shared-scrollbarless">
      <ProjectTree query={query} onSelect={() => setOpen(false)} />
    </div>
  </Popover>;
}
