import { translate } from "../shared/lib/i18n";
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ShieldCheck } from 'lucide-react';
import { Button, Select } from '../shared/ui';
import { invoke } from '../electronBridge';
import { useMiniAppsOwner } from '../lib/miniAppLibrary';

type Group = 'terminal' | 'android' | 'files' | 'edits' | 'setup';
type Permissions = Record<Group, string> & { preset: string; trustedCount: number; commandPreviews: boolean; folder: string; commandFolder: string; shells: string[]; preferredShell: string; defaultShell?: string; adb: string | null };
const shellNames: Record<string, string> = { bash: 'Bash', powershell: 'PowerShell' };
const labels: Record<string, string> = { get ask() { return translate("Ask every time"); }, get off() { return translate("Off"); }, get allow() { return translate("Allow in selected folder"); }, get review() { return translate("Review before connecting"); }, get trusted() { return translate("Remember approved commands"); }, get approved() { return translate("Remembered commands only"); }, get sandbox() { return translate("Run new commands in workspace sandbox"); }, get inspect() { return translate("Allow device inspection"); }, get 'read-only'() { return translate("Device inspection only"); }, get catalog() { return translate("Search catalog only"); } };
const presetOptions = [
  { value: 'manual', get label() { return translate("Default"); }, get description() { return translate("Review terminal commands and file reads."); } },
  { value: 'autonomous', get label() { return translate("Autonomous"); }, get description() { return translate("Edit workspace files and ask before new commands."); } },
  { value: 'autopilot', get label() { return translate("Autopilot"); }, get description() { return translate("Run new Bash and PowerShell commands in the workspace sandbox without prompts."); } },
];
const groups: { id: Group; title: string; description: string; modes: string[] }[] = [
  { id: 'files', get title() { return translate("Workspace files"); }, get description() { return translate("List folders and send text file contents to the agent’s model."); }, modes: ['ask', 'allow', 'off'] },
  { id: 'edits', get title() { return translate("Workspace edits"); }, get description() { return translate("Create directories and write text files in the selected folder."); }, modes: ['ask', 'allow', 'off'] },
  { id: 'terminal', get title() { return translate("Terminal"); }, get description() { return translate("Autopilot runs project commands in the local Codex CLI workspace sandbox. Other enabled modes run approved commands as your OS user."); }, modes: ['ask', 'trusted', 'approved', 'sandbox', 'off'] },
  { id: 'android', title: 'Android', get description() { return translate("Inspect attached devices, install an APK or run instrumentation tests, depending on the selected mode."); }, modes: ['ask', 'inspect', 'read-only', 'off'] },
  { id: 'setup', get title() { return translate("MCP setup"); }, get description() { return translate("Search the registry and prepare a server configuration. You choose Connect & save to activate it."); }, modes: ['review', 'catalog', 'off'] },
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
    catch (e) { if (epoch.current === generation) setError(e instanceof Error ? e.message : translate("Could not save permissions.")); }
    finally { if (epoch.current === generation) setBusy(false); }
  }
  return { settings, error, busy, change };
}
function PresetSelect({ settings, busy, change, compact = false }: ReturnType<typeof usePermissions> & { compact?: boolean }) {
  const value = settings?.preset ?? '';
  const options = value === 'custom' ? [...presetOptions, {value, label: translate("Custom"), description: translate("Workspace-specific permissions.")}] : presetOptions;
  return <Select overlay={compact} label={compact ? translate("Agent permission mode") : translate("Permission preset")} value={value} disabled={!settings || busy}
    options={options} onChange={preset => { if (preset !== value) void change('stock_mcp_preset', { preset }); }}
    triggerContent={compact ? <><ShieldCheck size={14} /><span>{options.find(o => o.value === value)?.label || translate("Permissions")}</span><ChevronDown size={12} /></> : undefined} />;
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
  return <section className="mcp-server-list" aria-label={translate("Nextbrowser agent permissions")}>
    <div><strong>{translate("Agent permissions")}</strong><p className="muted small">{translate("For the built-in Nextbrowser agent in this workspace. External agent CLIs use their own settings.")}</p></div>
    {error && <p role="alert">{error}</p>}
    {!settings && !error && <p role="status">{translate("Loading permissions…")}</p>}
    {settings && <>
      <div className="stock-mcp-permission"><div><strong>{translate("Permission preset")}</strong>
        <p className="muted small">{translate("Applies to the built-in agent in this workspace. Adjust individual tools below.")}</p></div>
        <PresetSelect {...state} /></div>
      <article className="mcp-card"><div className="mcp-card-head"><strong>{translate("Working folder")}</strong>
        <Button disabled={busy} onClick={() => void change('stock_mcp_folder')}>{translate("Choose folder")}</Button></div>
        <code className="stock-mcp-folder">{settings.folder}</code>
        {settings.commandFolder && settings.commandFolder !== settings.folder
          ? <p className="muted small">{translate("Autopilot runs in")} <code className="stock-mcp-folder">{settings.commandFolder}</code>{translate(". Choose a project folder to run and write there.")}</p>
          : <p className="muted small">{translate("File tools stay inside this folder. Shell commands start here.")}</p>}
      </article>
      {groups.map(group => <article className="mcp-card" key={group.id}><div className="stock-mcp-permission">
        <div><strong>{group.title}</strong><p className="muted small">{group.description}</p></div>
        <Select label={group.title + ' permission'} value={settings[group.id]} disabled={busy}
          onChange={mode => void change('stock_mcp_set', { group: group.id, mode })}
          options={group.modes.map(value => ({ value, label: labels[value] }))} />
      </div>
      {group.id === 'terminal' && <div className="stock-mcp-permission"><strong>{translate("Default shell")}</strong>
        <Select label={translate("Default shell")} value={settings.preferredShell} disabled={busy || settings.terminal === 'off'}
          onChange={shell => void change('stock_mcp_shell', { shell })}
          options={[{ value: 'auto', label: 'Automatic' + (settings.shells.length ? ' · ' + shellNames[settings.shells[0]] : ' · No installed shell') },
            ...settings.shells.map(value => ({ value, label: shellNames[value] })),
            ...(settings.preferredShell !== 'auto' && !settings.shells.includes(settings.preferredShell)
              ? [{ value: settings.preferredShell, label: shellNames[settings.preferredShell] + ' · Unavailable' }] : [])]} /></div>}
      {group.id === 'terminal' && ['ask', 'trusted'].includes(settings.terminal) && <div className="stock-mcp-permission">
        <div><strong>{translate("Command notifications")}</strong><p className="muted small">{translate("Previews show short commands in system notifications and let you approve them there.")}</p></div>
        <Select label={translate("Command notifications")} value={settings.commandPreviews ? 'preview' : 'private'} disabled={busy}
          onChange={value => void change('stock_mcp_command_previews', { enabled: value === 'preview' })}
          options={[{ value: 'private', label: translate("Review in chat") }, { value: 'preview', label: translate("Show command preview") }]} /></div>}
      {group.id === 'terminal' && ['trusted', 'approved'].includes(settings.terminal) && <div className="stock-mcp-permission">
        <span className="muted small">{translate("Clear approvals to review commands again.")}</span>
        <Button disabled={busy} onClick={() => void change('stock_mcp_forget_commands')}>{translate("Forget commands")}</Button></div>}
      {group.id === 'android' && <div className="stock-mcp-permission">
        {settings.adb ? <code className="stock-mcp-folder">{settings.adb}</code>
          : <a href="https://developer.android.com/tools/releases/platform-tools" target="_blank" rel="noreferrer">{translate("Get Android SDK Platform-Tools")}</a>}
        <Button disabled={busy} onClick={() => void change('stock_mcp_android_sdk')}>{translate("Choose SDK folder")}</Button></div>}
      </article>)}
    </>}
  </section>;
}
