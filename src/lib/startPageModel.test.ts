import { describe, it, expect } from 'vitest';
import { startPageConversations, startScopeWorkspace, webDestination } from './startPageModel';
import type { Conversation, Workspace } from '../types';
const scope = { workspaceId: 'work', profile: 'work-profile', runtime: 'camoufox' } as const;
const workspace: Workspace = { id: 'work', name: 'Work', profileNames: ['work-profile'], profileToolsets: { 'work-profile': 'camoufox' }, createdAt: 1, updatedAt: 1 };
describe('start page context', () => {
  it('rejects deleted, wrong-workspace and wrong-runtime profiles', () => {
    expect(startScopeWorkspace(scope, [workspace], [{ name: 'work-profile' }])).toBe(workspace);
    expect(() => startScopeWorkspace(scope, [], [{ name: 'work-profile' }])).toThrow();
    expect(() => startScopeWorkspace(scope, [workspace], [])).toThrow();
    expect(() => startScopeWorkspace({ ...scope, runtime: 'clawbrowser' }, [workspace], [{ name: 'work-profile' }])).toThrow();
  });
  it('only returns this profile’s local sessions, sorted newest first', () => {
    const c: Conversation = { id: 'one', agent: 'codex', title: 'Research', messages: [], createdAt: 1, updatedAt: 1, workspaceId: 'work', profileNames: ['work-profile'] };
    expect(startPageConversations(scope, [c, { ...c, id: 'other', profileNames: ['other'] }, { ...c, id: 'foreign', workspaceId: 'other' }, { ...c, id: 'remote', executionTarget: 'vps' }, { ...c, id: 'owned', profileNames: [], updatedAt: 2 }], { 'work-profile': 'owned' }).map(c => c.id)).toEqual(['owned', 'one']);
  });
  it('distinguishes website addresses from searches and blocks active schemes and credentials', () => {
    expect(webDestination('example.com/docs')).toBe('https://example.com/docs');
    expect(webDestination('http://localhost:8181/')).toBe('http://localhost:8181/');
    expect(webDestination('best coffee in Hanoi')).toBe('https://www.google.com/search?q=best%20coffee%20in%20Hanoi');
    for (const value of ['javascript:alert(1)', 'file:///secret', 'data:text/html,hi', 'https://a:b@example.com', '']) expect(webDestination(value)).toBeUndefined();
  });
});
