import { useEffect, useState } from 'react';
import { Button, Select } from '../shared/ui';
import { invoke } from '../electronBridge';

type Group = 'terminal' | 'android' | 'files' | 'setup';
type Permissions = Record<Group, string> & { folder: string; shells: string[]; preferredShell: string; defaultShell?: string; adb: string | null };
const shellNames: Record<string, string> = { bash: 'Bash', powershell: 'PowerShell' };
const labels: Record<string, string> = { ask: 'Ask every time', off: 'Off', allow: 'Allow in selected folder', review: 'Review before connecting' };
const groups: { id: Group; title: string; description: string; modes: string[] }[] = [
  { id: 'terminal', title: 'Terminal', description: 'Run a command as your OS user. Review its shell, working folder and full command before each run.', modes: ['ask', 'off'] },
  { id: 'android', title: 'Android', description: 'List development devices, install a workspace APK, and run instrumentation tests.', modes: ['ask', 'off'] },
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
        <div><strong>{group.title}</strong><p className="muted small">{group.description}</p></div>
        <Select label={group.title + ' permission'} value={settings[group.id]} disabled={busy}
          onChange={mode => void change('stock_mcp_set', { group: group.id, mode })}
          options={group.modes.map(value => ({ value, label: labels[value] }))} />
      </div>
      {group.id === 'terminal' && <div className="stock-mcp-permission"><strong>Default shell</strong>
        <Select label="Default shell" value={settings.preferredShell} disabled={busy || settings.terminal === 'off'}
          onChange={shell => void change('stock_mcp_shell', { shell })}
          options={[{ value: 'auto', label: 'Automatic' + (settings.shells.length ? ' · ' + shellNames[settings.shells[0]] : ' · No installed shell') },
            ...settings.shells.map(value => ({ value, label: shellNames[value] })),
            ...(settings.preferredShell !== 'auto' && !settings.shells.includes(settings.preferredShell)
              ? [{ value: settings.preferredShell, label: shellNames[settings.preferredShell] + ' · Unavailable' }] : [])]} /></div>}
      {group.id === 'android' && <div className="stock-mcp-permission">
        {settings.adb ? <code className="stock-mcp-folder">{settings.adb}</code>
          : <a href="https://developer.android.com/tools/releases/platform-tools" target="_blank" rel="noreferrer">Get Android SDK Platform-Tools</a>}
        <Button disabled={busy} onClick={() => void change('stock_mcp_android_sdk')}>Choose SDK folder</Button></div>}
      </article>)}
    </>}
  </section>;
}
