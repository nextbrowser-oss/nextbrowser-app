const { userError } = require('./user-error.cjs');
const REGISTRY = 'https://registry.modelcontextprotocol.io/v0.1/servers';
async function readPublicJSON(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000), redirect: 'error' });
  if (!response.ok) throw userError(`The MCP source returned HTTP ${response.status}. Try again later.`);
  const text = await response.text();
  if (text.length > 2_000_000) throw userError('The MCP source returned too much data.');
  try { return JSON.parse(text); } catch { throw userError('The MCP source did not return JSON.'); }
}
function packageConfig(server) {
  const pkg = server.packages?.find(p => ['npm', 'pypi'].includes(p.registryType) && p.transport?.type === 'stdio');
  if (!pkg) return null;
  const version = pkg.version || server.version;
  const env = Object.fromEntries((pkg.environmentVariables || []).filter(v => v.isRequired || v.value !== undefined || v.default !== undefined).map(v => [v.name, v.value ?? v.default ?? `REPLACE_${v.name}`]));
  const args = [];
  for (const arg of pkg.packageArguments || []) {
    const value = arg.value ?? arg.default ?? (arg.isRequired ? `REPLACE_${arg.name || arg.valueHint || 'ARGUMENT'}` : undefined);
    if (value === undefined) continue;
    if (arg.type === 'named') args.push(arg.name);
    args.push(String(value));
  }
  if (pkg.runtimeArguments?.length) return null; // Do not silently drop custom runtime options.
  return { command: pkg.registryType === 'npm' ? 'npx' : 'uvx', args: pkg.registryType === 'npm'
    ? ['-y', `${pkg.identifier}${version ? `@${version}` : ''}`, ...args]
    : [`${pkg.identifier}${version ? `==${version}` : ''}`, ...args], env };
}
function catalogItem(server) {
  const remote = server.remotes?.find(r => r.type === 'streamable-http');
  const config = packageConfig(server) || (remote ? { type: 'http', url: remote.url, headers: Object.fromEntries((remote.headers || []).map(h => [h.name, h.value ?? h.default ?? `REPLACE_${h.name}`])) } : null);
  return { name: String(server.name || ''), title: String(server.title || server.name || ''), description: String(server.description || ''),
    version: String(server.version || ''), repository: /^https:\/\/github\.com\//i.test(server.repository?.url || '') ? server.repository.url : '',
    config, remote: server.remotes?.some(r => r.type === 'streamable-http') === true };
}
async function searchCatalog({ search = '', cursor = '' }, fetchImpl) {
  const url = new URL(REGISTRY); url.searchParams.set('version', 'latest'); url.searchParams.set('limit', '24');
  if (search) url.searchParams.set('search', String(search).slice(0, 200));
  if (cursor) url.searchParams.set('cursor', String(cursor).slice(0, 2000));
  const data = await readPublicJSON(url, fetchImpl);
  return { items: (data.servers || []).filter(x => x._meta?.['io.modelcontextprotocol.registry/official']?.status !== 'deleted').map(x => catalogItem(x.server)), cursor: data.metadata?.nextCursor || '' };
}
async function githubConfig(input, fetchImpl) {
  let url; try { url = new URL(input); } catch { throw userError('Paste a GitHub repository URL.'); }
  const parts = url.pathname.split('/').filter(Boolean);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || !/^[\w.-]+$/.test(parts[0] || '') || !/^[\w.-]+$/.test(parts[1] || '')) throw userError('Use an https://github.com/owner/repository URL.');
  const root = `https://api.github.com/repos/${parts[0]}/${parts[1]}/contents/`;
  for (const file of ['server.json', '.mcp.json', 'mcp.json', 'README.md']) {
    try {
      const entry = await readPublicJSON(root + file, fetchImpl);
      const text = Buffer.from(entry.content || '', 'base64').toString('utf8');
      if (file === 'README.md') {
        for (const block of text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)) {
          try {
            const example = JSON.parse(block[1]);
            if (example.mcpServers || example.command || example.url) return { name: parts[1], json: JSON.stringify(example, null, 2) };
          } catch { /* Only explicit, valid JSON is imported, never README instructions. */ }
        }
        continue;
      }
      const raw = JSON.parse(text);
      if (file === 'server.json') {
        const config = catalogItem(raw).config;
        if (config) return { name: raw.title || raw.name || parts[1], json: JSON.stringify(config, null, 2) };
      } else if (raw.mcpServers || raw.command || raw.url) return { name: parts[1], json: JSON.stringify(raw, null, 2) };
    } catch { /* Try the other standard manifests, never guess a command from README text. */ }
  }
  throw userError('No supported MCP manifest was found in this repository. Copy its documented start command or MCP JSON into the Custom tab.');
}
module.exports = { searchCatalog, githubConfig, packageConfig, catalogItem };
