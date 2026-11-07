import { useState } from "react";
import { projectFolders } from "../lib/projectTree";
import { Glyph, IconButton } from "../shared/ui";
import { useStore } from "../store";
import { Icon } from "./Icon";
import "./projectTree.css";

/** Reuses saved project conversations and independent sessions inside each folder. */
export function ProjectTree({ query = "", onSelect }: { query?: string; onSelect?: () => void }) {
  const conversations = useStore(state => state.conversations);
  const workspaceId = useStore(state => state.activeWorkspaceId);
  const activeId = useStore(state => state.activeConvId[state.agentId]);
  const select = useStore(state => state.selectConversation);
  const setTab = useStore(state => state.setTab);
  const createSession = useStore(state => state.createProjectSession);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { const value = JSON.parse(localStorage.getItem("nextbrowser.project-folders-collapsed") || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; }
  });
  const search = query.trim().toLocaleLowerCase();
  const folders = projectFolders(conversations, workspaceId).filter(folder => !search || folder.project.title.toLocaleLowerCase().includes(search) || folder.sessions.some(session => session.title.toLocaleLowerCase().includes(search)));
  return <div className="project-tree" aria-label="Project folders">
    {folders.map(({ project, sessions }) => {
      const active = sessions.some(session => session.id === activeId);
      const expanded = !!search || !(collapsed[project.id] ?? !active);
      return <section className="project-folder" key={project.id}>
        <div className="project-folder-heading">
          <button className="project-folder-toggle" aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} project ${project.title}`} onClick={() => setCollapsed(previous => {
            const next = { ...previous, [project.id]: expanded };
            try { localStorage.setItem("nextbrowser.project-folders-collapsed", JSON.stringify(next)); } catch { /* Session-local state still works. */ }
            return next;
          })}><Icon name={expanded ? "chevron.down" : "chevron.right"} size={10} /><Glyph name="folder" size={15} /><strong>{project.title}</strong><small>{sessions.length}</small></button>
          <IconButton label={`New session in ${project.title}`} appearance="plain" size="small" onClick={() => { if (createSession(project.id)) onSelect?.(); }}><Icon name="plus" size={12} /></IconButton>
        </div>
        {expanded && <div className="project-folder-sessions" role="group" aria-label={`Sessions in ${project.title}`}>
          {sessions.filter(session => !search || project.title.toLocaleLowerCase().includes(search) || session.title.toLocaleLowerCase().includes(search)).map(session => {
            const title = session.id === project.id ? "Main session" : session.title;
            return <button key={session.id} className="project-session" aria-label={`Open ${title} in ${project.title}`} aria-current={session.id === activeId ? "true" : undefined}
              onClick={() => { select(session.id); setTab("chat"); onSelect?.(); }}><Icon name="bubble.left.and.bubble.right.fill" size={12} /><span>{title}</span></button>;
          })}
        </div>}
      </section>;
    })}
    {!folders.length && <p className="chat-popover-empty">{search ? "No matching projects." : "No projects in this workspace yet."}</p>}
  </div>;
}
