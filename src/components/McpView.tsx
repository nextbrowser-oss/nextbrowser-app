import { useEffect, useRef, useState } from 'react';
import { agentById, isBuiltinAgent } from '../agents';
import { invoke } from '../electronBridge';
import { OPEN_AGENT_SETTINGS_EVENT } from '../lib/appNavigation';
import { Button, Dialog, Glyph, IconButton, Select } from '../shared/ui';
import { useStore } from '../store';
import { BuiltinAgentSetup } from './BuiltinAgentSetup';
import './mcp-view.css';

type Server = { id: string; name: string; executable: string; enabled: boolean; checkedAt: string; tools: { name: string; description: string }[] };
type CatalogItem = { name: string; title: string; version: string; description: string; repository: string; config: Record<string, unknown> | null; remote: boolean };
type Catalog = { items: CatalogItem[]; cursor: string };
type Tab = 'installed' | 'catalog' | 'custom';
const errorMessage = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

export function McpView() {
  const workspaceId = useStore(s => s.activeWorkspaceId);
  return <McpWorkspace key={workspaceId} workspaceId={workspaceId} />;
}
function McpWorkspace({ workspaceId }: { workspaceId?: string }) {
  const available = useStore(s => s.nextctlAvailable), version = useStore(s => s.nextctlVersion);
  const agentId = useStore(s => s.agentId), close = useStore(s => s.closeUtilityDialog);
  const [tab, setTab] = useState<Tab>('installed');
  const [servers, setServers] = useState<Server[]>([]), [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(''), [catalog, setCatalog] = useState<Catalog>({ items: [], cursor: '' });
  const [catalogLoading, setCatalogLoading] = useState(false), [catalogError, setCatalogError] = useState('');
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [mode, setMode] = useState('command'), [name, setName] = useState('');
  const [commandLine, setCommandLine] = useState(''), [json, setJSON] = useState(''), [github, setGithub] = useState('');
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [remove, setRemove] = useState<Server>(), [freeSetup, setFreeSetup] = useState(false);
  const alive = useRef(true), catalogSequence = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const reload = async () => {
    if (!workspaceId) return;
    const result = await invoke<Server[]>('user_mcp_list', { workspaceId });
    if (alive.current) setServers(result);
  };
  useEffect(() => { void reload().catch(e => setError(errorMessage(e))).finally(() => setLoading(false)); }, [workspaceId]);
  useEffect(() => {
    if (tab !== 'catalog') return;
    const sequence = ++catalogSequence.current;
    setCatalogLoading(true); setCatalogError(''); setCatalog({ items: [], cursor: '' });
    const timer = window.setTimeout(() => {
      void invoke<Catalog>('user_mcp_catalog', { search: query }).then(result => {
        if (alive.current && sequence === catalogSequence.current) setCatalog(result);
      }).catch(e => { if (alive.current && sequence === catalogSequence.current) setCatalogError(errorMessage(e)); })
        .finally(() => { if (alive.current && sequence === catalogSequence.current) setCatalogLoading(false); });
    }, 300);
    return () => { window.clearTimeout(timer); catalogSequence.current++; };
  }, [tab, query, catalogAttempt]);
  const run = async (key: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(key); setError(''); setNotice('');
    try { await work(); } catch (e) { if (alive.current) setError(errorMessage(e)); }
    finally { if (alive.current) setBusy(''); }
  };
  const prepare = (title: string, config: unknown) => { setName(title); setJSON(JSON.stringify(config, null, 2)); setMode('json'); setTab('custom'); setError(''); setNotice('Review the configuration and fill in required values before connecting.'); };
  const add = () => run('add', async () => {
    const added = await invoke<Server>('user_mcp_add', { workspaceId, mode, name, commandLine, json });
    if (!alive.current) return;
    setJSON(''); setCommandLine(''); setName(''); setTab('installed');
    setNotice(`${added.name} connected. ${added.tools.length} tools available for the next agent turn.`);
    await reload();
  });
  return <section className="mcp-setup" aria-label="MCP servers">
    <div className="mcp-intro"><div className="mcp-intro-icon"><Glyph name="blocks" size={26} /></div><div><h3>More tools for your agent</h3><p>Connect services, local tools, and your own MCP servers.</p></div></div>
    <div className="mcp-agent-choice"><div><span className="muted small">Use with</span><strong>{agentById(agentId).name}</strong><span className="muted small">Your current agent settings</span></div>
      <Button type="button" onClick={() => setFreeSetup(true)}><Glyph name="sparkles" size={15} />Use a free model</Button>
      <IconButton label="Agent settings" appearance="plain" size="small" onClick={() => { close(); window.dispatchEvent(new CustomEvent(OPEN_AGENT_SETTINGS_EVENT)); }}><Glyph name="sliders" size={16} /></IconButton>
    </div>
    {!isBuiltinAgent(agentId) && agentId !== 'codex' && <p className="mcp-info">Custom servers currently work with the Nextbrowser agent and Codex. Choose a free model or switch agents to use them in chat.</p>}
    <div className="mcp-tabs" role="group" aria-label="MCP sections">{(['installed', 'catalog', 'custom'] as Tab[]).map(value => <Button key={value} type="button" aria-pressed={tab === value} onClick={() => { setTab(value); setError(''); }} disabled={!!busy}>
      {value === 'installed' ? `Installed · ${servers.length + 1}` : value === 'catalog' ? 'Discover' : 'Add custom'}
    </Button>)}</div>
    {error && <p className="error mcp-message" role="alert">{error}</p>}
    {notice && <p className="mcp-message" role="status">{notice}</p>}
    {!workspaceId ? <p>Select a workspace to add MCP servers.</p> : tab === 'installed' ? <div className="mcp-server-list">
      <article className="mcp-card"><div className="mcp-card-head"><Glyph name="unplug" /><div><strong>Nextbrowser</strong><span className="muted small">Browser tools · built in</span></div><span className="mcp-badge">Managed</span></div><p className="muted small">{available ? `CLI ${version || 'available'}` : 'CLI unavailable'} · Connected when a browser task starts.</p></article>
      {loading && <p role="status">Loading servers…</p>}
      {servers.map(server => <article className="mcp-card" key={server.id}>
        <div className="mcp-card-head"><Glyph name="plug" /><div><strong>{server.name}</strong><span className="muted small">{server.executable} · {server.tools.length} tools</span></div><Button type="button" className="mcp-badge" aria-pressed={server.enabled} disabled={!!busy} onClick={() => void run(server.id, async () => { await invoke('user_mcp_toggle', { workspaceId, id: server.id, enabled: !server.enabled }); await reload(); })}>{server.enabled ? 'Enabled' : 'Disabled'}</Button></div>
        <details><summary>Available tools</summary><ul className="mcp-tools shared-scrollbarless">{server.tools.map(tool => <li key={tool.name}><strong>{tool.name}</strong><span>{tool.description}</span></li>)}</ul></details>
        <div className="mcp-card-foot"><span className="muted small">Checked {new Date(server.checkedAt).toLocaleString()}</span><Button type="button" disabled={!!busy} onClick={() => void run(server.id, async () => { await invoke('user_mcp_test', { workspaceId, id: server.id }); await reload(); setNotice(`${server.name}: connection checked.`); })}>{busy === server.id ? 'Checking…' : 'Test connection'}</Button><IconButton label={`Remove ${server.name}`} appearance="plain" size="small" disabled={!!busy} onClick={() => setRemove(server)}><Glyph name="x" size={16} /></IconButton></div>
      </article>)}
      {!loading && !servers.length && <div className="mcp-empty"><Glyph name="plug" size={28} /><strong>Add your first MCP server</strong><p>Browse the registry or paste a command from a repository.</p><Button type="button" className="primary" onClick={() => setTab('catalog')}>Discover servers</Button></div>}
      <p className="muted small">Saved on this device for the current workspace. Changes apply to the next agent turn.</p>
    </div> : tab === 'catalog' ? <>
      <label className="mcp-search"><Glyph name="search" size={17} /><input aria-label="Search MCP catalog" placeholder="Search the MCP Registry…" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <p className="muted small">Live results from the official MCP Registry. A listing does not guarantee that the service is free.</p>
      {catalogLoading && <p role="status">Loading servers…</p>}
      {catalogError && <div role="alert"><p>{catalogError}</p><Button type="button" onClick={() => setCatalogAttempt(x => x + 1)}>Retry catalog</Button></div>}
      <div className="mcp-catalog-grid">{catalog.items.map(item => <article key={item.name} className="mcp-card"><div className="mcp-card-head"><Glyph name="plug" size={18} /><strong>{item.title}</strong></div><p>{item.description}</p><span className="muted small">{item.version}</span><div className="mcp-card-foot">{item.repository && <a href={item.repository} target="_blank" rel="noreferrer">GitHub ↗</a>}<Button type="button" disabled={!item.config} onClick={() => prepare(item.title, item.config)}>{item.config ? 'Configure' : 'Manual setup'}</Button></div>{!item.config && <span className="muted small">Copy the documented launch configuration into Add custom.</span>}</article>)}</div>
      {!catalogLoading && !catalogError && !catalog.items.length && <p>No servers found. Try another name or add your own.</p>}
      {catalog.cursor && <Button type="button" disabled={catalogLoading || !!busy} onClick={() => void run('more', async () => { const sequence = catalogSequence.current; const result = await invoke<Catalog>('user_mcp_catalog', { search: query, cursor: catalog.cursor }); if (sequence === catalogSequence.current) setCatalog(previous => ({ items: [...previous.items, ...result.items.filter(item => !previous.items.some(old => old.name === item.name))], cursor: result.cursor })); })}>{busy === 'more' ? 'Loading…' : 'Load more'}</Button>}
    </> : <form className="mcp-custom" onSubmit={e => { e.preventDefault(); void add(); }}>
      <div className="mcp-github"><label>Import from GitHub<input value={github} onChange={e => setGithub(e.target.value)} placeholder="https://github.com/owner/mcp-server" disabled={!!busy} /></label><Button type="button" disabled={!!busy || !github.trim()} onClick={() => void run('github', async () => { const result = await invoke<{ name: string; json: string }>('user_mcp_github', { url: github }); setName(result.name); setJSON(result.json); setMode('json'); setNotice('Manifest imported. Review it before connecting.'); })}>{busy === 'github' ? 'Reading…' : 'Read manifest'}</Button></div>
      <div className="mcp-form-row"><label>Server name<input value={name} onChange={e => setName(e.target.value)} placeholder="My MCP server" maxLength={80} disabled={!!busy} /></label><label>Setup method<Select label="MCP setup method" value={mode} onChange={setMode} disabled={!!busy} options={[{ value: 'command', label: 'Launch command' }, { value: 'json', label: 'JSON configuration' }]} /></label></div>
      {mode === 'command' ? <label>Command<input className="mcp-code" aria-label="MCP command" value={commandLine} onChange={e => setCommandLine(e.target.value)} placeholder="npx -y @scope/mcp-server" spellCheck={false} disabled={!!busy} /><small>Use the documented server start command: npx, uvx, or an installed executable.</small></label> : <label>MCP configuration<textarea className="mcp-code shared-scrollbarless" aria-label="MCP JSON configuration" value={json} onChange={e => setJSON(e.target.value)} placeholder={'{\n  "command": "node",\n  "args": ["/path/to/server.js"],\n  "env": {}\n}'} rows={9} spellCheck={false} disabled={!!busy} /><small>Accepts command/args/env, a Streamable HTTP url/headers object, or one mcpServers entry. Saved configuration is encrypted.</small></label>}
      <p className="mcp-info">Connect starts the configured command or connects to the HTTP endpoint, then checks its tools before saving. Use servers you trust.</p>
      <div className="mcp-form-actions"><span className="muted small">stdio · Streamable HTTP via JSON</span><Button className="primary" type="submit" disabled={!!busy || (mode === 'command' ? !name.trim() || !commandLine.trim() : !json.trim())}>{busy === 'add' ? 'Connecting…' : 'Connect & save'}</Button></div>
    </form>}
    {freeSetup && <Dialog title="Use a free model" onClose={() => setFreeSetup(false)}><BuiltinAgentSetup initialProvider="openrouter" onReady={() => { setFreeSetup(false); setNotice('The Nextbrowser agent will use your selected model and enabled MCP servers.'); }} /></Dialog>}
    {remove && <Dialog title={`Remove ${remove.name}?`} onClose={() => setRemove(undefined)}><p>Remove this server and its saved configuration from this workspace? Its software will stay installed.</p><div className="mcp-form-actions"><Button type="button" disabled={!!busy} onClick={() => setRemove(undefined)}>Cancel</Button><Button type="button" disabled={!!busy} onClick={() => void run('remove', async () => { await invoke('user_mcp_remove', { workspaceId, id: remove.id }); setRemove(undefined); await reload(); })}>Remove server</Button></div></Dialog>}
  </section>;
}
