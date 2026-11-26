import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ShieldCheck } from 'lucide-react';
import { Button, Select } from '../shared/ui';
import { invoke } from '../electronBridge';
import { useMiniAppsOwner } from '../lib/miniAppLibrary';

type Group = 'terminal' | 'android' | 'files' | 'edits' | 'setup';
type Permissions = Record<Group, string> & { preset: string; trustedCount: number; commandPreviews: boolean; folder: string; commandFolder: string; shells: string[]; preferredShell: string; defaultShell?: string; adb: string | null };
const shellNames: Record<string, string> = { bash: 'Bash', powershell: 'PowerShell' };
const labels: Record<string, string> = { ask: 'Ask every time', off: 'Off', allow: 'Allow in selected folder', review: 'Review before connecting', trusted: 'Remember approved commands', approved: 'Remembered commands only', sandbox: 'Run new commands in workspace sandbox', inspect: 'Allow device inspection', 'read-only': 'Device inspection only', catalog: 'Search catalog only' };
const presetOptions = [
  { value: 'manual', label: 'Default', description: 'Review terminal commands and file reads.' },
  { value: 'autonomous', label: 'Autonomous', description: 'Edit workspace files and ask before new commands.' },
  { value: 'autopilot', label: 'Автопилот', description: 'Run new Bash and PowerShell commands in the workspace sandbox without prompts.' },
];
const groups: { id: Group; title: string; description: string; modes: string[] }[] = [
  { id: 'files', title: 'Workspace files', description: 'List folders and send text file contents to the agent’s model.', modes: ['ask', 'allow', 'off'] },
  { id: 'edits', title: 'Workspace edits', description: 'Create directories and write text files in the selected folder.', modes: ['ask', 'allow', 'off'] },
  { id: 'terminal', title: 'Terminal', description: 'Autopilot runs project commands in the local Codex CLI workspace sandbox. Other enabled modes run approved commands as your OS user.', modes: ['ask', 'trusted', 'approved', 'sandbox', 'off'] },
  { id: 'android', title: 'Android', description: 'Inspect attached devices, install an APK or run instrumentation tests, depending on the selected mode.', modes: ['ask', 'inspect', 'read-only', 'off'] },
  { id: 'setup', title: 'MCP setup', description: 'Search the registry and prepare a server configuration. You choose Connect & save to activate it.', modes: ['review', 'catalog', 'off'] },
];
function usePermissions(workspaceId: string) {
  const owner = useMiniAppsOwner();
  const [settings, setSettings] = useState<Permissions>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  useEffect(() => {
    const generation = ++epoch.current;
    setSettings(undefined); setError(''); setBusy(false);
    let read = 0;
    if (!owner || !window.nextbrowser) return;
    const refresh = () => {
      const seq = ++read;
      const active = () => epoch.current === generation && read === seq;
      void invoke<Permissions>('stock_mcp_get', { owner, workspaceId }).then(value => {
        if (active()) { setSettings(value); setError(''); }
      }).catch(e => { if (active()) setError(String(e.message || e)); });
    };
    const unsubscribe = window.nextbrowser.on('stock-mcp:settings-changed', payload => {
      const scope = payload as { owner: string; workspaceId: string };
      if (scope.owner === owner && scope.workspaceId === workspaceId) refresh();
    });
    refresh();
    return () => { epoch.current++; unsubscribe(); };
  }, [owner, workspaceId]);
  async function change(command: string, args: Record<string, string | boolean> = {}) {
    if (!owner || busy) return;
    const generation = epoch.current;
    setBusy(true); setError('');
    try { await invoke(command, { owner, workspaceId, ...args }); }
    catch (e) { if (epoch.current === generation) setError(e instanceof Error ? e.message : 'Could not save permissions.'); }
    finally { if (epoch.current === generation) setBusy(false); }
  }
  return { settings, error, busy, change };
}
function PresetSelect({ settings, busy, change, compact = false }: ReturnType<typeof usePermissions> & { compact?: boolean }) {
  const value = settings?.preset ?? '';
  const options = value === 'custom' ? [...presetOptions, {value, label: 'Custom', description: 'Workspace-specific permissions.'}] : presetOptions;
  return <Select overlay={compact} label={compact ? 'Agent permission mode' : 'Permission preset'} value={value} disabled={!settings || busy}
    options={options} onChange={preset => { if (preset !== value) void change('stock_mcp_preset', { preset }); }}
    triggerContent={compact ? <><ShieldCheck size={14} /><span>{options.find(o => o.value === value)?.label || 'Permissions'}</span><ChevronDown size={12} /></> : undefined} />;
}
export function ComposerPermissionMode({ workspaceId }: { workspaceId: string }) {
  const state = usePermissions(workspaceId);
  return <div className="composer-permission-mode"><PresetSelect {...state} compact />
    {state.error && <span className="composer-permission-error" role="alert">{state.error}</span>}
  </div>;
}
export function StockMcpPermissions({ workspaceId }: { workspaceId: string }) {
  const state = usePermissions(workspaceId);
  const { settings, error, busy, change } = state;
  return <section className="mcp-server-list" aria-label="Nextbrowser agent permissions">
    <div><strong>Agent permissions</strong><p className="muted small">For the built-in Nextbrowser agent in this workspace. External agent CLIs use their own settings.</p></div>
    {error && <p role="alert">{error}</p>}
    {!settings && !error && <p role="status">Loading permissions…</p>}
    {settings && <>
      <div className="stock-mcp-permission"><div><strong>Permission preset</strong>
        <p className="muted small">Applies to the built-in agent in this workspace. Adjust individual tools below.</p></div>
        <PresetSelect {...state} /></div>
      <article className="mcp-card"><div className="mcp-card-head"><strong>Working folder</strong>
        <Button disabled={busy} onClick={() => void change('stock_mcp_folder')}>Choose folder</Button></div>
        <code className="stock-mcp-folder">{settings.folder}</code>
        {settings.commandFolder && settings.commandFolder !== settings.folder
          ? <p className="muted small">Autopilot runs in <code className="stock-mcp-folder">{settings.commandFolder}</code>. Choose a project folder to run and write there.</p>
          : <p className="muted small">File tools stay inside this folder. Shell commands start here.</p>}
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
      {group.id === 'terminal' && ['ask', 'trusted'].includes(settings.terminal) && <div className="stock-mcp-permission">
        <div><strong>Command notifications</strong><p className="muted small">Previews show short commands in system notifications and let you approve them there.</p></div>
        <Select label="Command notifications" value={settings.commandPreviews ? 'preview' : 'private'} disabled={busy}
          onChange={value => void change('stock_mcp_command_previews', { enabled: value === 'preview' })}
          options={[{ value: 'private', label: 'Review in chat' }, { value: 'preview', label: 'Show command preview' }]} /></div>}
      {group.id === 'terminal' && ['trusted', 'approved'].includes(settings.terminal) && <div className="stock-mcp-permission">
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
