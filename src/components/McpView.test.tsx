// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { McpView } from './McpView';
import { TooltipProvider } from '../shared/ui';
import { invoke } from '../electronBridge';
const state = vi.hoisted(() => ({ activeWorkspaceId: 'work', agentId: 'codex', nextctlAvailable: true, nextctlVersion: '1.2.40', closeUtilityDialog: vi.fn() }));
vi.mock('../store', () => ({ useStore: (select: (s: typeof state) => unknown) => select(state) }));
vi.mock('../electronBridge', () => ({ invoke: vi.fn() }));
vi.mock('./BuiltinAgentSetup', () => ({ BuiltinAgentSetup: ({ initialProvider }: { initialProvider: string }) => <div>Setup {initialProvider}</div> }));
const added = { id: 'test', name: 'My server', executable: 'node', enabled: true, checkedAt: new Date().toISOString(), tools: [{ name: 'echo', description: 'Echo' }] };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockImplementation(async command => command === 'user_mcp_list' ? [] : command === 'user_mcp_add' ? added : command === 'user_mcp_catalog' ? { items: [], cursor: '' } : {});
});
afterEach(cleanup);
const mount = () => render(<TooltipProvider><McpView /></TooltipProvider>);
it('keeps the default agent; free setup uses the existing OpenRouter flow', async () => {
  mount(); await screen.findByText('Add your first MCP server');
  expect(screen.getByText('Codex')).toBeTruthy();
  expect(vi.mocked(invoke).mock.calls.some(([name]) => name === 'builtin_agent_settings_save')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Use a free model' }));
  expect(screen.getByText('Setup openrouter')).toBeTruthy();
});
it('only runs the entered command on connect; clears drafts after a successful handshake', async () => {
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Add custom' }));
  fireEvent.change(screen.getByLabelText('Server name'), { target: { value: 'My server' } });
  fireEvent.change(screen.getByLabelText('MCP command'), { target: { value: 'node server.js' } });
  expect(invoke).not.toHaveBeenCalledWith('user_mcp_add', expect.anything());
  fireEvent.click(screen.getByRole('button', { name: 'Connect & save' }));
  await screen.findByText(/My server connected/);
  expect(invoke).toHaveBeenCalledWith('user_mcp_add', expect.objectContaining({ workspaceId: 'work', commandLine: 'node server.js' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add custom' }));
  expect((screen.getByLabelText('MCP command') as HTMLInputElement).value).toBe('');
});
it('shows an installation error and preserves the configuration for correction', async () => {
  vi.mocked(invoke).mockImplementation(async command => { if (command === 'user_mcp_add') throw new Error('Could not connect'); return []; });
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Add custom' }));
  fireEvent.change(screen.getByLabelText('Server name'), { target: { value: 'Broken' } });
  fireEvent.change(screen.getByLabelText('MCP command'), { target: { value: 'missing-server' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect & save' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not connect');
  expect((screen.getByLabelText('MCP command') as HTMLInputElement).value).toBe('missing-server');
});
it('catalog configuration is reviewable and does not execute on selection', async () => {
  vi.mocked(invoke).mockImplementation(async command => command === 'user_mcp_catalog' ? { items: [{ name: 'sample', title: 'Sample', description: 'Example', version: '1', config: { command: 'npx', args: ['-y', '@sample/mcp@1'] } }], cursor: '' } : []);
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Discover' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Configure' }));
  await waitFor(() => expect(screen.getByLabelText('MCP JSON configuration')).toBeTruthy());
  expect(invoke).not.toHaveBeenCalledWith('user_mcp_add', expect.anything());
});
