// User-added stdio servers. Credentials stay in the main process and are
// encrypted at rest; this never edits an external agent's global config.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createMCPClient } = require('./automation-runner.cjs');
const { createHttpMcpClient } = require('./mcp-http-client.cjs');
const { serverEnvironment } = require('./mcp-environment.cjs');
const { secureStorageAvailable } = require('./multilogin-credential.cjs');
const { userError } = require('./user-error.cjs');
const { toOpenAIParameters, coerceArguments, toolResultForModel } = require('./builtin-agent-tools.cjs');

function parseCommand(input) {
  const text = String(input || '').trim();
  if (!text || text.length > 8192) throw userError('Enter the command that starts the MCP server.');
  const words = []; let word = '', quote = '', started = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = '';
      else word += ch;
    } else if (ch === '"' || ch === "'") { quote = ch; started = true; }
    else if (/\s/.test(ch)) { if (started) { words.push(word); word = ''; started = false; } }
    else if (/[|&;<>`]/.test(ch) || (ch === '$' && text[i + 1] === '(')) {
      throw userError('Use a single server command, without pipes or shell operators. Put arguments and environment variables in JSON if needed.');
    } else { word += ch; started = true; }
  }
  if (quote) throw userError('Close the quote in the server command.');
  if (started) words.push(word);
  return { command: words[0], args: words.slice(1) };
}

function normalizeServer(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw userError('Enter an MCP server configuration.');
  const label = String(name || value.name || '').trim();
  if (!label || label.length > 80) throw userError('Give this server a name (up to 80 characters).');
  if (value.url) {
    let url; try { url = new URL(value.url); } catch { throw userError('Enter a valid MCP endpoint URL.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw userError('Use an HTTP(S) endpoint without embedded credentials.');
    const headers = value.headers || {};
    if (Object.keys(headers).length > 30 || Object.entries(headers).some(([key, val]) => !/^[A-Za-z0-9-]+$/.test(key) || typeof val !== 'string' || /[\r\n]/.test(val))) throw userError('Invalid MCP HTTP headers.');
    if (value.type && !['http', 'streamable-http'].includes(value.type)) throw userError('Use a Streamable HTTP endpoint, not legacy SSE.');
    return { name: label, url: url.href, headers, type: 'http', env: {} };
  }
  if (value.type && value.type !== 'stdio') throw userError('Use a stdio command or a Streamable HTTP URL.');
  const command = String(value.command || '').trim();
  if (!command || command.length > 4096 || /[\r\n\0]/.test(command)) throw userError('A server executable is required.');
  const args = value.args ?? [];
  if (!Array.isArray(args) || args.length > 100 || args.some(arg => typeof arg !== 'string' || arg.length > 8192 || arg.includes('\0'))) throw userError('Server args must be an array of strings.');
  const env = value.env ?? {};
  if (!env || typeof env !== 'object' || Array.isArray(env) || Object.keys(env).length > 100 || Object.entries(env).some(([key, val]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof val !== 'string' || val.length > 8192 || val.includes('\0'))) throw userError('Server env must contain named text values.');
  return { name: label, command, args: [...args], env: { ...env } };
}

function parseServerInput(input) {
  if (input.mode === 'command') return normalizeServer(parseCommand(input.commandLine), input.name);
  let config;
  try { config = JSON.parse(input.json); } catch { throw userError('The MCP configuration is not valid JSON.'); }
  if (config?.mcpServers) {
    const entries = Object.entries(config.mcpServers);
    if (entries.length !== 1) throw userError('Add one server at a time. Paste a configuration with one mcpServers entry.');
    return normalizeServer(entries[0][1], String(input.name || '').trim() || entries[0][0]);
  }
  return normalizeServer(config, input.name);
}

function serverSummary(server) {
  return { id: server.id, name: server.name, executable: server.url ? 'Streamable HTTP' : path.win32.basename(path.basename(server.command)), enabled: server.enabled,
    tools: server.tools || [], checkedAt: server.checkedAt || '', environmentNames: Object.keys(server.env || {}) };
}

function createUserMcpStore({ filePath, safeStorage, platform = process.platform }) {
  let queue = Promise.resolve();
  async function secure() {
    if (!await secureStorageAvailable(safeStorage, platform)) throw userError('Secure storage is unavailable. Unlock your system keychain and try again.');
  }
  async function read() {
    let payload;
    try { payload = await fs.readFile(filePath); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    await secure();
    const data = JSON.parse(safeStorage.decryptString(payload));
    if (data.version !== 1 || !Array.isArray(data.servers)) throw userError('The saved MCP configuration could not be read.');
    return data.servers;
  }
  function update(change) {
    const action = queue.then(async () => {
      await secure();
      const servers = await change(await read());
      const payload = safeStorage.encryptString(JSON.stringify({ version: 1, servers }));
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.${randomUUID()}.tmp`;
      try { await fs.writeFile(temp, payload, { mode: 0o600 }); await fs.rename(temp, filePath); }
      finally { await fs.rm(temp, { force: true }); }
    });
    queue = action.catch(() => {});
    return action;
  }
  const scope = workspaceId => {
    if (typeof workspaceId !== 'string' || !workspaceId.trim() || workspaceId.length > 200) throw userError('Choose a workspace first.');
    return workspaceId;
  };
  return {
    available: () => secureStorageAvailable(safeStorage, platform),
    async list(workspaceId) { scope(workspaceId); return (await read()).filter(s => s.workspaceId === workspaceId).map(serverSummary); },
    async enabled(workspaceId) { scope(workspaceId); return (await read()).filter(s => s.workspaceId === workspaceId && s.enabled); },
    async get(workspaceId, id) {
      scope(workspaceId); const server = (await read()).find(s => s.workspaceId === workspaceId && s.id === id);
      if (!server) throw userError('This MCP server is no longer available in this workspace.');
      return server;
    },
    async add(workspaceId, config, tools) {
      scope(workspaceId);
      const server = { ...config, workspaceId, id: randomUUID(), enabled: true, tools, checkedAt: new Date().toISOString() };
      await update(servers => {
        if (servers.filter(s => s.workspaceId === workspaceId).length >= 20) throw userError('A workspace can contain up to 20 MCP servers.');
        if (servers.some(s => s.workspaceId === workspaceId && s.name.toLowerCase() === config.name.toLowerCase())) throw userError('A server with this name already exists.');
        return [...servers, server];
      });
      return serverSummary(server);
    },
    async change(workspaceId, id, patch) {
      scope(workspaceId);
      await update(servers => {
        if (!servers.some(s => s.workspaceId === workspaceId && s.id === id)) throw userError('MCP server not found.');
        return servers.map(s => s.workspaceId === workspaceId && s.id === id ? { ...s, ...patch } : s);
      });
    },
    async remove(workspaceId, id) { scope(workspaceId); await update(servers => servers.filter(s => s.workspaceId !== workspaceId || s.id !== id)); },
  };
}

function startUserMcp(server, { env, resolveCommand, spawnImpl } = {}) {
  if (server.url) return createHttpMcpClient(server);
  const spec = resolveCommand ? resolveCommand(server.command, server.args) : { file: server.command, args: server.args };
  return createMCPClient({ binary: spec.file, args: spec.args, env: serverEnvironment(env || process.env, server.env), inheritBrowserArguments: false, ...(spawnImpl ? { spawnImpl } : {}) });
}

async function inspectUserMcp(server, deps) {
  let client;
  try {
    client = startUserMcp(server, deps);
    await client.initialize(30_000);
    const tools = await client.listTools(30_000);
    return tools.map(t => ({ name: String(t.name), description: String(t.description || '').slice(0, 300) }));
  } catch {
    // stderr may echo tokens. Never forward it to the renderer or telemetry.
    throw userError(server.url ? 'Could not connect to this MCP endpoint. Check its URL and authentication headers. OAuth sign-in must be completed with the service separately.' : 'Could not connect to this MCP server. Check the executable, its arguments, required environment variables, and whether Node.js or Python is installed.');
  } finally { client?.close(); }
}

async function connectUserMcpTools(servers, { signal, onStep = () => {}, strict = false, vision = false, ...deps } = {}) {
  const clients = [], routes = new Map(), definitions = [];
  const close = () => { clients.forEach(c => c.close()); signal?.removeEventListener('abort', close); };
  signal?.addEventListener('abort', close, { once: true });
  try {
    for (const server of servers) {
      if (signal?.aborted) throw new Error('Stopped.');
      onStep(`Connecting MCP: ${server.name}`);
      const client = startUserMcp(server, deps); clients.push(client);
      await client.initialize(30_000);
      const tools = await client.listTools(30_000);
      for (const tool of tools) {
        // The desktop owns the stock catalog. Its instructions and the model must
        // refer to the same stable names even when a permission hides a tool.
        const name = server.id === 'stock' ? `workspace_${tool.name}` : `mcp_${server.id.replace(/-/g, '')}_${routes.size}`;
        routes.set(name, { client, tool });
        definitions.push({ type: 'function', function: { name, description: `[${server.name}] ${tool.name}: ${String(tool.description || '').slice(0, 600)}`, parameters: toOpenAIParameters(tool.inputSchema, { strict }) } });
      }
    }
    return { close, definitions, names: [...routes.keys()], has: name => routes.has(name),
      prepare: (name, args) => coerceArguments(args, routes.get(name)?.tool.inputSchema),
      async call(name, args) {
        const route = routes.get(name);
        if (!route) throw new Error('Unknown MCP tool.');
        try {
          const raw = await route.client.callTool(route.tool.name, args);
          const result = toolResultForModel(raw, { vision, limit: 8000 });
          if (name.startsWith('workspace_') && !result.isError) {
            // Preserve the trusted exit status even if long stdout was clipped for the model.
            const body = raw.content?.find(item => item.type === 'text');
            try {
              const { exitCode, status, job_id } = JSON.parse(body.text);
              result.workspaceReceipt = { exitCode, status, job_id };
            } catch { /* A missing receipt cannot verify a check. */ }
          }
          return result;
        }
        catch { throw new Error('The MCP tool failed or timed out. Check its connection in Extensions → MCP before retrying.'); }
      },
    };
  } catch { close(); throw userError('An enabled MCP server could not start. Check its connection or disable it in Extensions → MCP.'); }
}

function mergeToolsets(browser, extra) {
  return { definitions: [...browser.definitions, ...extra.definitions], names: [...browser.names, ...extra.names],
    has: name => browser.has(name) || extra.has(name),
    prepare: (name, args) => (extra.has(name) ? extra : browser).prepare(name, args),
    call: (name, args) => (extra.has(name) ? extra : browser).call(name, args) };
}

module.exports = { parseCommand, parseServerInput, normalizeServer, createUserMcpStore, serverEnvironment, inspectUserMcp, connectUserMcpTools, mergeToolsets };
