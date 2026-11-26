import { translate } from "../shared/lib/i18n";
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Pin } from "lucide-react";
import { Glyph, IconButton, Popover, Select, Tooltip } from "../shared/ui";
import { useStore } from "../store";
import { Icon } from "./Icon";
import { ProjectTree } from "./ProjectTree";
import { ProjectsDock } from "./ProjectsDock";
import { projectRoot, projectSortMode, projectSortOptions } from "../lib/projectTree";
import { settingsStorage } from "../lib/settingsStorage";
import { setProjectsPinned, useProjectsPinned } from "../lib/projectsPinned";

export interface LiveProjectsPanel { slot: HTMLElement | null; showChat: () => void }

export function RecentProjects({ activeId, open: controlledOpen, onOpenChange, boundaryRef, dock, livePanel }: { activeId?: string; open?: boolean; onOpenChange?: (open: boolean) => void; boundaryRef?: RefObject<HTMLElement>; dock?: HTMLElement | null; livePanel?: LiveProjectsPanel }) {
  const [localOpen, setLocalOpen] = useState(false);
  const pinned = useProjectsPinned();
  const [sort, setSort] = useState(() => projectSortMode(settingsStorage.getItem("nextbrowser.projectSort")));
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const docked = Boolean(dock && pinned);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  useEffect(() => {
    if (docked && open) {
      search.current?.focus();
      setOpen(false);
    }
  }, [docked, open, setOpen]);
  useEffect(() => { if (!open && !docked && !livePanel) setQuery(""); }, [open, docked, livePanel]);
  const closeAfterSelect = () => { if (!docked) setOpen(false); };
  const conversations = useStore(state => state.conversations);
  const agentId = useStore(state => state.agentId);
  const activeConvId = useStore(state => state.activeConvId);
  const createSession = useStore(state => state.createProjectSession);
  const setTab = useStore(state => state.setTab);
  const showChat = () => {
    closeAfterSelect();
    if (livePanel) livePanel.showChat();
    else setTab("chat");
  };
  const current = conversations.find(item => item.id === (activeId ?? activeConvId[agentId]));
  const root = current && projectRoot(current, conversations);
  const contents = <>
    <div className="project-popover-toolbar">
      <div className="rail-popover-heading">{translate("Projects")}</div>
      <IconButton label={docked ? translate("Unpin Projects") : translate("Pin Projects")} text={docked ? "Unpin" : "Pin"} aria-pressed={docked} disabled={!dock}
        appearance="embedded" size="small" className="project-pin" onClick={() => {
          if (docked) livePanel?.showChat();
          setProjectsPinned(!docked);
          setOpen(true);
        }}><Pin size={14} aria-hidden="true" /></IconButton>
      <IconButton label={translate("Create project")} appearance="plain" size="small" className="project-new-session" onClick={() => { closeAfterSelect(); livePanel?.showChat(); window.dispatchEvent(new CustomEvent("nextbrowser:create-project")); }}><Glyph name="folder" size={14} /></IconButton>
      <IconButton label={translate("New session")} disabled={!root} appearance="plain" size="small" className="project-new-session" onClick={() => { if (current && createSession(current.id)) showChat(); }}><Icon name="plus" size={14} /></IconButton>
    </div>
    <div className="profile-list-tools project-list-tools">
      <label className="project-search"><input ref={docked ? search : undefined} type="search" data-autofocus aria-label={translate("Search projects")}
        placeholder={translate("Search projects")} value={query} onChange={event => setQuery(event.target.value)} /></label>
      <Select label={translate("Sort projects")} triggerContent={<><Glyph name="arrow-down" size={12} /><span>{translate("Sort")}</span></>}
        value={sort} options={projectSortOptions} onChange={value => {
          const next = projectSortMode(value);
          setSort(next);
          settingsStorage.setItem("nextbrowser.projectSort", next);
        }} />
    </div>
    <div className="recent-project-list shared-scrollbarless">
      <ProjectTree query={query} sort={sort} onSelect={showChat} />
    </div>
  </>;
  if (dock && docked) return <>
    <Tooltip content={translate("Projects")} side="right"><button type="button" className="sidebar-destination active" aria-label={translate("Open Projects")}
      aria-expanded="true" aria-controls="pinned-projects" onClick={() => search.current?.focus()}><Glyph name="folder" /></button></Tooltip>
    {createPortal(<ProjectsDock>{contents}</ProjectsDock>, dock)}
  </>;
  return <><Popover label={translate("Projects")} open={open} onOpenChange={setOpen} openOnHover align="start" side="right" boundaryRef={boundaryRef}
    className="recent-projects shared-scrollbarless" trigger={props => <button {...props} className="sidebar-destination" aria-label={translate("Open Projects")}>
      <Glyph name="folder" />
    </button>}>{contents}</Popover>
    {livePanel?.slot && createPortal(contents, livePanel.slot)}
  </>;
}
