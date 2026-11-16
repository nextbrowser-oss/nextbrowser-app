import { beforeEach, expect, it, vi } from 'vitest';
import { handleStartPageRequest } from './startPageBridge';
import { stageStartPageDraft } from './startPageDraft';
const mocked = vi.hoisted(() => ({ state: {} as any }));
vi.mock('../store', () => ({ useStore: { getState: () => mocked.state } }));
vi.mock('./startPageDraft', () => ({ stageStartPageDraft: vi.fn() }));
const scope = { workspaceId: 'one', profile: 'browser', runtime: 'clawbrowser' } as const;
beforeEach(() => {
  vi.clearAllMocks();
  const conversation = { id: 'chat', agent: 'codex', workspaceId: 'one', profileNames: ['browser'], title: 'Research', updatedAt: 1, messages: [{ role: 'user', text: 'Research task' }] };
  mocked.state = { authed: true, agentId: 'codex', workspaces: [{ id: 'one', name: 'Work', profileNames: ['browser'], profileToolsets: { browser: 'clawbrowser' } }],
    profiles: [{ name: 'browser', country: 'US' }], conversations: [conversation, { ...conversation, id: 'private', workspaceId: 'two', title: 'Other workspace secret' }],
    profileChatOwners: {}, profileIdentities: {}, profileSessions: {}, statuses: { browser: 'running' },
    activeConversation: () => conversation, selectConversation: vi.fn(), selectProfile: vi.fn(), setTerminalChat: vi.fn(), setTab: vi.fn(),
    selectWorkspace: vi.fn(), createProject: vi.fn(() => { mocked.state.conversations.push({ ...conversation, id: 'new' }); return 'new'; }), rememberConversationProfile: vi.fn(),
  };
});
it('opens a draft in the owning chat without enqueuing or moving the browser', async () => {
  await handleStartPageRequest(scope, { type: 'draft', text: ' Compare products ' });
  expect(mocked.state.selectConversation).toHaveBeenCalledWith('chat');
  expect(stageStartPageDraft).toHaveBeenCalledWith('chat', 'Compare products');
  expect(mocked.state.createProject).not.toHaveBeenCalled();
});
it('rejects resume outside this profile and workspace', async () => {
  await expect(handleStartPageRequest(scope, { type: 'resume', id: 'private' })).rejects.toThrow();
  expect(mocked.state.selectConversation).not.toHaveBeenCalled();
});
it('creates and remembers a new local chat when no associated session exists', async () => {
  mocked.state.conversations = [];
  await handleStartPageRequest(scope, { type: 'draft', text: 'A new task' });
  expect(mocked.state.selectWorkspace).toHaveBeenCalledWith('one');
  expect(mocked.state.rememberConversationProfile).toHaveBeenCalledWith('new', 'browser', 'clawbrowser');
  expect(stageStartPageDraft).toHaveBeenCalledWith('new', 'A new task');
});
it('revokes access when signed out or the runtime changes', async () => {
  mocked.state.authed = false;
  await expect(handleStartPageRequest(scope, { type: 'authorize' })).rejects.toThrow();
  mocked.state.authed = true;
  await expect(handleStartPageRequest({ ...scope, runtime: 'camoufox' }, { type: 'authorize' })).rejects.toThrow();
});
