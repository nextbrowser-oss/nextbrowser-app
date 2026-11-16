import type { BrowserToolset, Conversation, Profile, Workspace } from '../types';

export type StartScope = { workspaceId: string; profile: string; runtime: BrowserToolset };
export type StartPin = { id: string; name: string; url: string };
export type StartSnapshot = {
  profile: string; workspace: string; runtime: string; theme: string; agent: string;
  connection: string; country?: string; ip?: string; verified: boolean; status: string;
  sessions: { id: string; title: string; updatedAt: number; preview: string; messages: number }[];
  pins: StartPin[];
};

export function startScopeWorkspace(scope: StartScope, workspaces: Workspace[], profiles: Profile[]) {
  const workspace = workspaces.find(w => w.id === scope.workspaceId);
  if (!workspace?.profileNames.includes(scope.profile) ||
      (workspace.profileToolsets[scope.profile] || 'clawbrowser') !== scope.runtime ||
      (scope.profile !== '__default' && !profiles.some(p => p.name === scope.profile))) throw new Error('This profile is no longer available in its workspace. Reopen Profiles.');
  return workspace;
}

export function startPageConversations(scope: StartScope, conversations: Conversation[], owners: Record<string, string>) {
  return conversations.filter(c => c.workspaceId === scope.workspaceId && c.executionTarget !== 'vps' &&
    (c.profileNames?.includes(scope.profile) || owners[scope.profile] === c.id))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function webDestination(text: string): string | undefined {
  const value = text.trim();
  if (!value) return;
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^https?:/i.test(value)) return;
  const address = /^https?:\/\//i.test(value) ? value : /^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i.test(value) ? `https://${value}` : undefined;
  if (address) {
    try { const url = new URL(address); return !url.username && !url.password ? url.href : undefined; } catch { return; }
  }
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}
