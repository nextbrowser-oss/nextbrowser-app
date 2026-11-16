import { useStore } from '../store';
import { invoke } from '../electronBridge';
import { agentById } from '../agents';
import { stageStartPageDraft } from './startPageDraft';
import { startPageConversations, startScopeWorkspace, type StartScope } from './startPageModel';

export async function handleStartPageRequest(scope: StartScope, action: { type: string; text?: string; id?: string }) {
  let state = useStore.getState();
  const workspace = startScopeWorkspace(scope, state.workspaces, state.profiles);
  if (!state.authed) throw new Error('Sign in to Nextbrowser to use this profile.');
  if (action.type === 'authorize') return {};
  if (action.type === 'refresh') await state.refreshProfileStatuses();
  state = useStore.getState();
  if (!state.authed) throw new Error('Sign in to Nextbrowser to use this profile.');
  startScopeWorkspace(scope, state.workspaces, state.profiles);
  const conversations = startPageConversations(scope, state.conversations, state.profileChatOwners);
  if (action.type === 'draft' || action.type === 'resume') {
    const text = action.text?.trim();
    if (action.type === 'draft' && (!text || text.length > 12000)) throw new Error('Enter a task of up to 12,000 characters.');
    const active = state.activeConversation();
    let conversation = action.type === 'resume' ? conversations.find(c => c.id === action.id)
      : conversations.find(c => c.id === state.profileChatOwners[scope.profile]) ?? conversations.find(c => c.id === active?.id) ?? conversations[0];
    if (action.type === 'resume' && !conversation) throw new Error('This session no longer belongs to the profile.');
    if (!conversation) {
      state.selectWorkspace(scope.workspaceId);
      const id = useStore.getState().createProject('Browser task', 'chat');
      if (!id) throw new Error('Could not create a chat. Open Projects and try again.');
      useStore.getState().rememberConversationProfile(id, scope.profile, scope.runtime);
      conversation = useStore.getState().conversations.find(c => c.id === id);
    }
    if (!conversation) throw new Error('Could not open the chat.');
    useStore.getState().selectConversation(conversation.id);
    useStore.getState().selectProfile(scope.profile === '__default' ? undefined : scope.profile);
    useStore.getState().setTerminalChat(false);
    if (action.type === 'draft') stageStartPageDraft(conversation.id, text!);
    useStore.getState().setTab('chat');
    return { opened: true };
  }
  if (!['state', 'refresh'].includes(action.type)) throw new Error('Unknown start page action.');
  const profile = state.profiles.find(p => p.name === scope.profile);
  const identity = state.profileIdentities[scope.profile];
  return {
    profile: profile?.display_name || profile?.name || 'Default browser', workspace: workspace.name,
    runtime: { clawbrowser: 'ClawBrowser', camoufox: 'Camoufox', dasbrowser: 'DasBrowser' }[scope.runtime],
    theme: document.documentElement.dataset.theme || 'dark', agent: agentById(conversations[0]?.agent || state.agentId).name,
    connection: profile?.proxy_mode === 'direct' ? 'Direct connection' : profile?.proxy_mode === 'manual' ? 'Personal proxy' : 'Managed proxy',
    country: identity?.country || profile?.country || undefined, ip: identity?.ip,
    verified: !!identity?.ip && !identity.unverified,
    status: state.statuses[scope.profile] || state.profileSessions[scope.profile]?.status || (scope.profile === '__default' ? state.defaultSession?.status : undefined) || 'unknown',
    sessions: conversations.filter(c => c.messages.length).slice(0, 3).map(c => ({ id: c.id, title: c.title, updatedAt: c.updatedAt,
      preview: [...c.messages].reverse().find(m => m.role === 'user' && m.text)?.text.slice(0, 180) || '', messages: c.messages.length })),
  };
}

export function installStartPageBridge() {
  return window.nextbrowser?.on('start-page:request', payload => {
    const request = payload as { id: string; scope: StartScope; action: { type: string; text?: string; id?: string } };
    void handleStartPageRequest(request.scope, request.action).then(data => invoke('start_page_response', { id: request.id, data }),
      () => invoke('start_page_response', { id: request.id, error: 'This profile or session is unavailable. Return to Nextbrowser and reopen Live.' })).catch(() => undefined);
  });
}
