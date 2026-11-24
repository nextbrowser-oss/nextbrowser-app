const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash, randomUUID } = require('node:crypto');
const { createAppSettings } = require('./app-settings.cjs');
const { serveLocalMcp } = require('./local-mcp-transport.cjs');
const { normalizeServer } = require('./user-mcp.cjs');
const { shells, safeText, readEntry, resolveEntry, runShell } = require('./stock-mcp-operations.cjs');

const endpoint = '/stock/mcp';
const instructions = 'Use Workspace tools for user-requested local work. Check permissions and installed shells with get_permissions. A terminal command needs a separate desktop approval. A denial is final for that action. To add an MCP, use propose_mcp_server to open an editable proposal for the user, then wait for Connect & save. The new tools are available next turn.';
const modes = { files: ['ask', 'allow', 'off'], terminal: ['ask', 'off'], setup: ['review', 'off'] };
const defaults = { files: 'ask', terminal: 'ask', setup: 'review' };
const string = description => ({ type: 'string', description });
const relativePath = string('Path relative to the selected folder. Use "." for its root.');
const offset = { type: 'integer', minimum: 0, description: 'Continuation offset from a previous result.' };
function tool(name, group, description, properties, required = []) {
  return { group, definition: { name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } } };
}
const catalog = [
  tool('get_permissions', null, 'Read workspace permissions, working directory and available shell names.', {}),
  tool('list_directory', 'files', 'List entries in the workspace folder.', { path: relativePath, offset }, ['path']),
  tool('read_text_file', 'files', 'Read a page of a UTF-8 file in the workspace folder.', { path: relativePath, offset }, ['path']),
  tool('run_command', 'terminal', 'Ask the user to execute one foreground command under their OS account. Returns output and exit code.', {
    shell: { type: 'string', enum: ['bash', 'powershell'] }, command: string('The exact command to display and execute.'),
  }, ['shell', 'command']),
  tool('propose_mcp_server', 'setup', 'Open a setup form in Nextbrowser for the user to review and connect an MCP server. Leave credentials for the user to enter.', {
    name: string('A display name for the server.'), config_json: string('JSON object with command and args, or an HTTP(S) url.'),
  }, ['name', 'config_json']),
  tool('search_mcp_catalog', 'setup', 'Search the public MCP registry for a server by name or purpose. Review returned configurations before proposing them.', { search: string('Public search terms only.') }, ['search']),
];
function createStockMcp({ dataRoot, dialog, isCurrent, searchCatalog }) {
  const store = createAppSettings({ file: path.join(dataRoot, 'stock-mcp-permissions.json') });
  const sessions = new Map(), pending = new Set();
  const scopeKey = scope => createHash('sha256').update(JSON.stringify([scope.owner, scope.workspaceId])).digest('hex');
  function policy(scope) {
    const key = scopeKey(scope);
    const stored = store.snapshot().values[key];
    const saved = stored ? JSON.parse(stored) : {};
    const effective = {};
    for (const [group, options] of Object.entries(modes)) effective[group] = options.includes(saved[group]) ? saved[group] : group in saved ? 'off' : defaults[group];
    return { ...effective, folder: saved.folder || path.join(dataRoot, 'workspace-files', key), customFolder: Boolean(saved.folder),
      revision: saved.revision || '', shells: Object.keys(shells()) };
  }
  function assertCurrent(scope) {
    if (!scope || !isCurrent(scope)) throw Error('The active account or workspace changed.');
  }
  async function settings(scope, command, args) {
    assertCurrent(scope);
    if (command === 'stock_mcp_get') return policy(scope);
    let patch;
    if (command === 'stock_mcp_set') {
      if (!Object.hasOwn(modes, args.group) || !modes[args.group].includes(args.mode)) throw Error('Invalid permission.');
      patch = { [args.group]: args.mode };
    } else if (command === 'stock_mcp_folder') {
      const result = await dialog.showOpenDialog(scope.window, { title: 'Choose the agent working folder', properties: ['openDirectory'] });
      if (result.canceled || !result.filePaths[0]) return policy(scope);
      patch = { folder: await fs.realpath(result.filePaths[0]) };
    } else throw Error('Unknown permission setting.');
    assertCurrent(scope);
    const key = scopeKey(scope);
    const saved = JSON.parse(store.snapshot().values[key] || '{}');
    await store.update({ values: { [key]: JSON.stringify({ ...saved, ...patch, revision: randomUUID() }) } });
    return policy(scope);
  }
  async function execute(scope, name, args, signal) {
    assertCurrent(scope);
    signal.throwIfAborted();
    const prefs = policy(scope);
    const key = scopeKey(scope);
    const policyAtStart = store.snapshot().values[key];
    const group = catalog.find(t => t.definition.name === name)?.group;
    function check() {
      signal.throwIfAborted();
      assertCurrent(scope);
      if (policyAtStart !== store.snapshot().values[key]) throw Error('Permissions or working folder changed. Inspect the new settings.');
      if (group && prefs[group] === 'off') throw Error('This tool is disabled for this workspace.');
    }
    check();
    if (name === 'get_permissions') {
      const { files, terminal, setup, folder, shells } = prefs;
      return { files, terminal, setup, folder, shells };
    }
    if (name === 'search_mcp_catalog') {
      if (!safeText(args.search, 100) || args.search.includes('\n')) throw Error('Enter a short public search term.');
      const results = await searchCatalog(args.search);
      check();
      return results.items.slice(0, 6).map(({ name, title, description, config }) => ({ name, title, description: description.slice(0, 220),
        config: config && JSON.stringify(config).length < 700 ? config : null }));
    }
    if (name === 'propose_mcp_server') {
      if (!safeText(args.name, 80) || args.name.includes('\n') || typeof args.config_json !== 'string' || args.config_json.length > 8192) throw Error('Invalid MCP proposal.');
      const parsed = JSON.parse(args.config_json);
      if (!parsed || Object.keys(parsed).some(k => !['command', 'args', 'url', 'type', 'env', 'headers'].includes(k)) ||
          [parsed.env, parsed.headers].some(map => map && Object.values(map).some(value => typeof value !== 'string' || !value.startsWith('REPLACE_')))) throw Error('Use command/args or url. Leave credential placeholders for the user to fill in.');
      const config = normalizeServer(parsed, args.name);
      scope.window.webContents.send('stock-mcp:proposal', { owner: scope.owner, workspaceId: scope.workspaceId, name: args.name, config });
      return { status: 'awaiting_user_review', next: 'The user can edit the configuration and select Connect & save. Start a new turn after connecting.' };
    }
    if (!['run_command', 'list_directory', 'read_text_file'].includes(name)) throw Error('Unknown workspace tool.');
    const terminal = name === 'run_command';
    const command = typeof args.command === 'string' ? args.command.replace(/\r\n/g, '\n') : '';
    const available = shells();
    if (terminal && (!Object.hasOwn(available, args.shell) || !safeText(command, 1800) || command.split('\n').length > 12)) throw Error('Choose an installed shell and a short, displayable command.');
    if (!terminal && (!safeText(args.path, 600) || args.path.includes('\n'))) throw Error('Enter a relative file path.');
    if (pending.has(scope.shellId)) throw Error('A local tool is already awaiting approval or running in this window.');
    pending.add(scope.shellId);
    const controller = new AbortController();
    const operation = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(95_000)]);
    const poll = setInterval(() => { try { check(); } catch { controller.abort(); } }, 150);
    try {
      if (prefs[group] === 'ask') {
        const action = terminal ? 'Run a terminal command as your OS user?' : name === 'list_directory' ? 'Share a directory listing with the agent?' : 'Share this file’s text with the agent?';
        const detail = terminal ? `Shell: ${available[args.shell]}\nWorking folder: ${prefs.folder}\n\n${command}` : `Working folder: ${prefs.folder}\nRelative path: ${args.path}`;
        const answer = await dialog.showMessageBox(scope.window, { type: 'question', title: 'Nextbrowser agent permission', message: action, detail,
          buttons: ['Deny', 'Allow once'], defaultId: 0, cancelId: 0, noLink: true, signal: operation });
        if (answer.response !== 1) throw Error('The user denied this request. Do not retry it.');
      }
      operation.throwIfAborted();
      check();
      if (!prefs.customFolder) await fs.mkdir(prefs.folder, { recursive: true, mode: 0o700 });
      let result;
      if (terminal) {
        const cwd = await resolveEntry(prefs.folder, '.');
        check();
        result = await runShell(available[args.shell], args.shell, command, cwd, operation);
      } else {
        result = await readEntry(prefs.folder, args.path, name === 'list_directory', args.offset ?? 0);
      }
      operation.throwIfAborted();
      check();
      return result;
    } finally { clearInterval(poll); pending.delete(scope.shellId); }
  }
  function open(scope, baseURL, signal) {
    assertCurrent(scope);
    const token = randomUUID();
    const lease = new AbortController();
    sessions.set(token, { scope, signal: AbortSignal.any([signal, lease.signal]) });
    return { server: { id: 'stock', name: 'Workspace tools', url: baseURL + endpoint, headers: { Authorization: 'Bearer ' + token } },
      close: () => { lease.abort(); sessions.delete(token); } };
  }
  async function serve(request, response) {
    const token = /^Bearer (.+)$/i.exec(request.headers.authorization || '')?.[1];
    const session = sessions.get(token);
    const client = new AbortController();
    const disconnect = () => client.abort();
    response.once('close', disconnect);
    try {
      const valid = session && !session.signal.aborted && isCurrent(session.scope);
      const prefs = valid && policy(session.scope);
      const tools = valid ? catalog.filter(t => !t.group || prefs[t.group] !== 'off').map(t => t.definition) : [];
      return await serveLocalMcp(request, response, valid && ((name, args) => execute(session.scope, name, args, AbortSignal.any([session.signal, client.signal]))),
        { serverInfo: { name: 'nextbrowser-workspace-tools', version: '1.0.0' }, instructions, tools });
    } finally { response.off('close', disconnect); }
  }
  return { open, serve, settings };
}
module.exports = { createStockMcp, endpoint, instructions };
