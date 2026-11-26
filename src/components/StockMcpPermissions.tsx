import { useEffect, useState } from 'react';
import { Button, Select } from '../shared/ui';
import { invoke } from '../electronBridge';

type Group = 'terminal' | 'android' | 'files' | 'edits' | 'setup';
type Permissions = Record<Group, string> & { preset: string; trustedCount: number; commandPreviews: boolean; folder: string; shells: string[]; preferredShell: string; defaultShell?: string; adb: string | null };
const shellNames: Record<string, string> = { bash: 'Bash', powershell: 'PowerShell' };
const labels: Record<string, string> = { ask: 'Ask every time', off: 'Off', allow: 'Allow in selected folder', review: 'Review before connecting', trusted: 'Remember approved commands', inspect: 'Allow device inspection' };
const groups: { id: Group; title: string; description: string; modes: string[] }[] = [
  { id: 'files', title: 'Workspace files', description: 'List folders and send text file contents to the agent’s model.', modes: ['ask', 'allow', 'off'] },
  { id: 'edits', title: 'Workspace edits', description: 'Create directories and write text files in the selected folder.', modes: ['ask', 'allow', 'off'] },
  { id: 'terminal', title: 'Terminal', description: 'Commands run with your OS permissions. You can remember an exact command for this folder and shell, including commands that run project scripts.', modes: ['ask', 'trusted', 'off'] },
  { id: 'android', title: 'Android', description: 'Allow device inspection to list devices and read SDK versions automatically. APK installs and test runs still ask.', modes: ['ask', 'inspect', 'off'] },
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
  async function change(command: string, args: Record<string, string | boolean> = {}) {
    setBusy(true); setError('');
    try { setSettings(await invoke<Permissions>(command, { workspaceId, ...args })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save permissions.'); }
    finally { setBusy(false); }
  }
  return <section className="mcp-server-list" aria-label="Nextbrowser agent permissions">
    <div><strong>Agent permissions</strong><p className="muted small">For the built-in Nextbrowser agent in this workspace. External agent CLIs use their own settings.</p></div>
    {error && <p role="alert">{error}</p>}
    {!settings && !error && <p role="status">Loading permissions…</p>}
    {settings && <>
      <div className="stock-mcp-permission"><div><strong>Permission preset</strong>
        <p className="muted small">Autonomous allows workspace reads and edits, remembered terminal commands and device inspection. Adjust each permission below.</p></div>
        <Select label="Permission preset" value={settings.preset} disabled={busy}
          onChange={preset => { if (preset !== settings.preset) void change('stock_mcp_preset', { preset }); }}
          options={[{ value: 'manual', label: 'Default' }, { value: 'autonomous', label: 'Autonomous' },
            ...(settings.preset === 'custom' ? [{ value: 'custom', label: 'Custom' }] : [])]} /></div>
      <article className="mcp-card"><div className="mcp-card-head"><strong>Working folder</strong>
        <Button disabled={busy} onClick={() => void change('stock_mcp_folder')}>Choose folder</Button></div>
        <code className="stock-mcp-folder">{settings.folder}</code>
        <p className="muted small">File tools stay inside this folder. Shell commands start here and can access other paths.</p>
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
      {group.id === 'terminal' && settings.terminal !== 'off' && <div className="stock-mcp-permission">
        <div><strong>Command notifications</strong><p className="muted small">Previews show short commands in system notifications and let you approve them there.</p></div>
        <Select label="Command notifications" value={settings.commandPreviews ? 'preview' : 'private'} disabled={busy}
          onChange={value => void change('stock_mcp_command_previews', { enabled: value === 'preview' })}
          options={[{ value: 'private', label: 'Review in chat' }, { value: 'preview', label: 'Show command preview' }]} /></div>}
      {group.id === 'terminal' && settings.terminal === 'trusted' && <div className="stock-mcp-permission">
        <span className="muted small">Clear approvals to review commands again.</span>
        <Button disabled={busy} onClick={() => void change('stock_mcp_forget_commands')}>Forget commands</Button></div>}
      {group.id === 'android' && <div className="stock-mcp-permission">
        {settings.adb ? <code className="stock-mcp-folder">{settings.adb}</code>
          : <a href="https://developer.android.com/tools/releases/platform-tools" target="_blank" rel="noreferrer">Get Android SDK Platform-Tools</a>}
        <Button disabled={busy} onClick={() => void change('stock_mcp_android_sdk')}>Choose SDK folder</Button></div>}
      </article>)}
    </>}
  </section>;
}
