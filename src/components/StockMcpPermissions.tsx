import { useEffect, useState } from 'react';
import { Button, Select } from '../shared/ui';
import { invoke } from '../electronBridge';

type Group = 'terminal' | 'files' | 'setup';
type Permissions = Record<Group, string> & { folder: string; shells: string[] };
const labels: Record<string, string> = { ask: 'Ask every time', off: 'Off', allow: 'Allow in selected folder', review: 'Review before connecting' };
const groups: { id: Group; title: string; description: string; modes: string[] }[] = [
  { id: 'terminal', title: 'Terminal', description: 'Run a command as your OS user. Review its shell, working folder and full command before each run.', modes: ['ask', 'off'] },
  { id: 'files', title: 'Workspace files', description: 'List folders and send text file contents to the agent’s model.', modes: ['ask', 'allow', 'off'] },
  { id: 'setup', title: 'MCP setup', description: 'Search the registry and prepare a server configuration. You choose Connect & save to activate it.', modes: ['review', 'off'] },
];
export function StockMcpPermissions({ workspaceId }: { workspaceId: string }) {
  const [settings, setSettings] = useState<Permissions>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    invoke<Permissions>('stock_mcp_get', { workspaceId }).then(value => { if (current) setSettings(value); })
      .catch(e => { if (current) setError(String(e.message || e)); });
    return () => { current = false; };
  }, [workspaceId]);
  async function change(command: string, args: Record<string, string> = {}) {
    setBusy(true); setError('');
    try { setSettings(await invoke<Permissions>(command, { workspaceId, ...args })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save permissions.'); }
    finally { setBusy(false); }
  }
  return <section className="mcp-server-list" aria-label="Nextbrowser agent permissions">
    <p className="muted small">Local tools for the built-in Nextbrowser agent in this workspace.</p>
    {error && <p role="alert">{error}</p>}
    {!settings && !error && <p role="status">Loading permissions…</p>}
    {settings && <>
      <article className="mcp-card"><div className="mcp-card-head"><strong>Working folder</strong>
        <Button disabled={busy} onClick={() => void change('stock_mcp_folder')}>Choose folder</Button></div>
        <code className="stock-mcp-folder">{settings.folder}</code>
        <p className="muted small">File reads stay inside this folder. Approved shell commands start here and have your OS account’s access.</p>
      </article>
      {groups.map(group => <article className="mcp-card" key={group.id}><div className="stock-mcp-permission">
        <div><strong>{group.title}</strong><p className="muted small">{group.description}</p>
          {group.id === 'terminal' && <small>{settings.shells.join(' · ') || 'No supported shell installed'}</small>}</div>
        <Select label={group.title + ' permission'} value={settings[group.id]} disabled={busy}
          onChange={mode => void change('stock_mcp_set', { group: group.id, mode })}
          options={group.modes.map(value => ({ value, label: labels[value] }))} />
      </div></article>)}
    </>}
  </section>;
}
