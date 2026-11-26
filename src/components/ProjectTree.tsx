import { translate } from "../shared/lib/i18n";
import { useState } from "react";
import { canDropProject, projectFolders, type ProjectSort } from "../lib/projectTree";
import { Glyph, IconButton, Tree, type TreeNode } from "../shared/ui";
import { useStore } from "../store";
import { Icon } from "./Icon";
import { sessionName } from "../lib/sessionTitle";
import "./projectTree.css";

/** Product adapter over the FractalUI tree; saved records remain the source of truth. */
export function ProjectTree({ query, sort, onSelect }: { query: string; sort: ProjectSort; onSelect?: () => void }) {
  const conversations = useStore(state => state.conversations);
  const workspaceId = useStore(state => state.activeWorkspaceId);
  const activeId = useStore(state => state.activeConvId[state.agentId]);
  const select = useStore(state => state.selectConversation);
  const createSession = useStore(state => state.createProjectSession);
  const move = useStore(state => state.moveProjectTreeItem);
  const [error, setError] = useState<string>();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { const value = JSON.parse(localStorage.getItem("nextbrowser.project-folders-collapsed") || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; }
  });
  const folders = projectFolders(conversations, workspaceId, sort);
  const expanded = folders.filter(folder => !(collapsed[folder.project.id] ?? !folder.sessions.some(session => session.id === activeId))).map(folder => `folder:${folder.project.id}`);
  const nodes: TreeNode[] = folders.map(({ project, sessions }) => ({
    id: `folder:${project.id}`, label: project.title, ariaLabel: `project ${project.title}`, icon: <Glyph name="folder" size={15} />,
    meta: <><small>{sessions.length}</small><IconButton label={translate("New session in %1", project.title)} appearance="plain" size="small" onClick={event => { event.stopPropagation(); if (createSession(project.id)) onSelect?.(); }}><Icon name="plus" size={12} /></IconButton></>,
    children: sessions.map(session => ({ id: `session:${session.id}`, label: sessionName(session),
      ariaLabel: `Open ${sessionName(session)} in ${project.title}`, icon: <Icon name="bubble.left.and.bubble.right.fill" size={12} />,
      data: { kind: "session", id: session.id, main: session.id === project.id },
    })), data: { kind: "folder", id: project.id },
  }));
  const expand = (ids: string[]) => setCollapsed(previous => {
    const next = { ...previous };
    for (const folder of folders) next[folder.project.id] = !ids.includes(`folder:${folder.project.id}`);
    try { localStorage.setItem("nextbrowser.project-folders-collapsed", JSON.stringify(next)); } catch { /* Session-local state still works. */ }
    return next;
  });
  return <div className="project-tree">
    <Tree label={translate("Project folders")} nodes={nodes} selectedId={activeId ? `session:${activeId}` : undefined} expandedIds={expanded} onExpandedChange={expand}
      query={query} emptyText={translate("No matching projects.")}
      renderSwitcher={open => <Icon name={open ? "chevron.down" : "chevron.right"} size={10} />}
      onSelect={node => {
        const data = node.data as { kind: string; id: string };
        if (data.kind === "folder") { expand(expanded.includes(node.id) ? expanded.filter(id => id !== node.id) : [...expanded, node.id]); return; }
        select(data.id); onSelect?.();
      }}
      canDrag={node => {
        const data = node.data as { kind: string; main?: boolean };
        return data.kind === "folder" ? sort === "manual" : !data.main;
      }}
      canDrop={event => canDropProject(conversations, workspaceId, event)}
      onDrop={event => {
        try {
          move(event); setError(undefined);
          const target = folders.find(folder => `folder:${folder.project.id}` === event.targetId || folder.sessions.some(session => `session:${session.id}` === event.targetId));
          if (target) expand([...new Set([...expanded, `folder:${target.project.id}`])]);
        } catch (failure) { setError(failure instanceof Error ? failure.message : translate("Could not move this item.")); }
      }} />
    {error && <p className="error small" role="alert">{error}</p>}
  </div>;
}
