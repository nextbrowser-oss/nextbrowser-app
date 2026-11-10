import type { Conversation } from "../types";

/** Folder presentation of the existing project/chat records; no separate folder entity. */
export function projectRoot(conversation: Conversation, conversations: readonly Conversation[]): Conversation {
  const seen = new Set([conversation.id]);
  let current = conversation;
  while (current.projectId) {
    const parent = conversations.find(item => item.id === current.projectId && item.workspaceId === conversation.workspaceId);
    if (!parent) return current;
    if (seen.has(parent.id)) return conversation;
    seen.add(parent.id);
    current = parent;
  }
  return current;
}

export function projectFolders(conversations: readonly Conversation[], workspaceId?: string) {
  const scoped = conversations.filter(item => item.workspaceId === workspaceId);
  const folders = new Map<string, { project: Conversation; sessions: Conversation[] }>();
  for (const session of scoped) {
    const project = projectRoot(session, scoped);
    const folder = folders.get(project.id) ?? { project, sessions: [] };
    folder.sessions.push(session);
    folders.set(project.id, folder);
  }
  return [...folders.values()].map(folder => ({ ...folder, sessions: folder.sessions.sort((a, b) => Number(b.id === folder.project.id) - Number(a.id === folder.project.id) || order(a.sessionOrder) - order(b.sessionOrder) || b.updatedAt - a.updatedAt) }))
    .sort((a, b) => order(a.project.projectOrder) - order(b.project.projectOrder) || Math.max(...b.sessions.map(item => item.updatedAt)) - Math.max(...a.sessions.map(item => item.updatedAt)));
}

function order(value?: number) { return typeof value === "number" && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER; }
export interface ProjectTreeDrop { dragId: string; targetId: string; position: "before" | "inside" | "after" }

function resolveDrop(conversations: readonly Conversation[], workspaceId: string | undefined, event: ProjectTreeDrop) {
  if (event.dragId === event.targetId) return;
  const folders = projectFolders(conversations, workspaceId);
  const folder = (id: string) => folders.find(item => `folder:${item.project.id}` === id);
  const session = (id: string) => conversations.find(item => `session:${item.id}` === id && item.workspaceId === workspaceId);
  const sourceFolder = folder(event.dragId), targetFolder = folder(event.targetId);
  if (sourceFolder) return targetFolder && event.position !== "inside" ? { folders, sourceFolder, targetFolder } : undefined;
  const source = session(event.dragId);
  if (!source || projectRoot(source, conversations).id === source.id) return;
  const target = session(event.targetId);
  if (targetFolder) return event.position === "inside" ? { folders, source, targetFolder } : undefined;
  if (!target || event.position === "inside") return;
  const parent = folders.find(item => item.project.id === projectRoot(target, conversations).id);
  if (!parent || (target.id === parent.project.id && event.position === "before")) return;
  return { folders, source, target, targetFolder: parent };
}

export function canDropProject(conversations: readonly Conversation[], workspaceId: string | undefined, event: ProjectTreeDrop) {
  return !!resolveDrop(conversations, workspaceId, event);
}

/** Move/reorder records atomically. IDs, history, agent and workspace never change. */
export function applyProjectDrop(conversations: Conversation[], workspaceId: string | undefined, event: ProjectTreeDrop, when = Date.now()) {
  const drop = resolveDrop(conversations, workspaceId, event);
  if (!drop) throw new Error("This item cannot be moved here.");
  const patches = new Map<string, Partial<Conversation>>();
  if (drop.sourceFolder) {
    const roots = drop.folders.map(item => item.project.id).filter(id => id !== drop.sourceFolder!.project.id);
    const at = roots.indexOf(drop.targetFolder.project.id) + (event.position === "after" ? 1 : 0);
    roots.splice(at, 0, drop.sourceFolder.project.id);
    roots.forEach((id, projectOrder) => patches.set(id, { projectOrder }));
  } else if (drop.source) {
    const siblings = drop.targetFolder.sessions.filter(item => item.id !== drop.targetFolder.project.id && item.id !== drop.source.id).map(item => item.id);
    const at = !drop.target ? siblings.length : drop.target.id === drop.targetFolder.project.id ? 0 : siblings.indexOf(drop.target.id) + (event.position === "after" ? 1 : 0);
    siblings.splice(at, 0, drop.source.id);
    siblings.forEach((id, sessionOrder) => patches.set(id, { sessionOrder, ...(id === drop.source.id ? { projectId: drop.targetFolder.project.id } : {}) }));
  }
  return conversations.map(item => {
    const patch = patches.get(item.id);
    if (!patch || Object.entries(patch).every(([key, value]) => item[key as keyof Conversation] === value)) return item;
    return { ...item, ...patch, updatedAt: Math.max(when, item.updatedAt + 1) };
  });
}
