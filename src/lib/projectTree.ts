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
  return [...folders.values()].map(folder => ({ ...folder, sessions: folder.sessions.sort((a, b) => Number(b.id === folder.project.id) - Number(a.id === folder.project.id) || b.updatedAt - a.updatedAt) }))
    .sort((a, b) => Math.max(...b.sessions.map(item => item.updatedAt)) - Math.max(...a.sessions.map(item => item.updatedAt)));
}
