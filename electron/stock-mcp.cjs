const { translate } = require("./interface-messages.cjs");
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { mkdirSync, realpathSync } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const { createAppSettings } = require('./app-settings.cjs');
const { serveLocalMcp } = require('./local-mcp-transport.cjs');
const { normalizeServer } = require('./user-mcp.cjs');
const { patchFile, searchFiles } = require('./workspace-code-tools.cjs');
const { createCommandJobs } = require('./workspace-command-jobs.cjs');
const { shells, adbExecutable, safeText, readEntry, editEntry, resolveEntry, runShell, runWorkspaceShell, runProgram } = require('./stock-mcp-operations.cjs');

const endpoint = '/stock/mcp';
function toolInstructions(prefix = '') {
  return `For local computer tasks check ${prefix}get_permissions before reporting that you lack access. Use workspace file tools for paths inside the selected folder. For coding tasks, use ${prefix}search_files to locate code, read the file, then use ${prefix}patch_file with its current hash. Run requested tests after the final edit. Use background=true for long commands and ${prefix}command_status until an exit code is available. For a requested OS path such as the Desktop, use ${prefix}run_command if available and follow its commandAccess and commandFolder. The desktop handles approvals. Ask for a missing name or destination when needed. Check the tool result before reporting success. A denial is final for that action. Check permissions again on a new user request because the user can change modes between turns. For Android development use ${prefix}android_devices before selecting a device. To connect another MCP use ${prefix}propose_mcp_server and wait for Connect & save. Its tools become available on the next turn.`;
}
const modes = { files: ['ask', 'allow', 'off'], edits: ['ask', 'allow', 'off'], terminal: ['ask', 'trusted', 'approved', 'sandbox', 'off'], android: ['ask', 'inspect', 'read-only', 'off'], setup: ['review', 'catalog', 'off'] };
const defaults = { files: 'ask', edits: 'off', terminal: 'ask', android: 'ask', setup: 'review' };
const presets = {
  manual: defaults,
  autonomous: { files: 'allow', edits: 'allow', terminal: 'trusted', android: 'inspect', setup: 'review' },
  autopilot: { files: 'allow', edits: 'allow', terminal: 'sandbox', android: 'read-only', setup: 'catalog' },
};
const legacyAutopilot = { ...presets.autopilot, terminal: 'approved' };

function savedPolicy(raw) {
  const saved = JSON.parse(raw || '{}');
  // This exact combination was displayed as Autopilot by the previous build.
  if (!saved.version && Object.entries(legacyAutopilot).every(([group, mode]) => saved[group] === mode)) {
    saved.terminal = 'sandbox';
  }
  return saved;
}
function availableTool(prefs, group, name) {
  if (group && prefs[group] === 'off') return false;
  if (group === 'android' && prefs.android === 'read-only') return name === 'android_devices' || name === 'android_device_info';
  return !(group === 'setup' && prefs.setup === 'catalog' && name !== 'search_mcp_catalog');
}
const keepsCommandGrants = mode => mode === 'trusted' || mode === 'approved';
const string = description => ({ type: 'string', description });
const relativePath = string('Path relative to the selected folder. Use "." for its root.');
const offset = { type: 'integer', minimum: 0, description: 'Continuation offset from a previous result.' };
const device = string('Exact serial from android_devices for the intended development device or emulator.');
function tool(name, group, description, properties, required = []) {
  return { group, definition: { name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } } };
}
const catalog = [
  tool('get_permissions', null, 'Read workspace permissions, working directory and available shell names.', {}),
  tool('list_directory', 'files', 'List entries in the workspace folder.', { path: relativePath, offset }, ['path']),
  tool('read_text_file', 'files', 'Read a page of a UTF-8 file in the workspace folder.', { path: relativePath, offset }, ['path']),
  tool('search_files', 'files', 'Search source files recursively for literal text. Returns paths, line numbers and excerpts. Narrow the directory if truncated. Skips hidden and generated directories.', {
    path: relativePath, query: string('Case-sensitive literal text on one line.'),
  }, ['path', 'query']),
  tool('create_directory', 'edits', 'Create a directory inside an existing workspace directory.', { path: relativePath }, ['path']),
  tool('write_text_file', 'edits', 'Create a UTF-8 file (up to 64 KiB). To replace an existing file, first read it and supply its sha256.', {
    path: relativePath, content: string('Full new file contents.'), expected_sha256: string('Current file hash for replacement. Omit to create a new file.'),
  }, ['path', 'content']),
  tool('patch_file', 'edits', 'Replace one unique block of complete lines in a previously read UTF-8 file. Returns the applied diff. Use an empty new_text to delete the block.', {
    path: relativePath, old_text: string('Exact complete lines to replace.'), new_text: string('Replacement lines.'), expected_sha256: string('Hash from read_text_file.'),
  }, ['path', 'old_text', 'new_text', 'expected_sha256']),
  tool('run_command', 'terminal', 'Run a command in the current terminal mode and folder. For long builds or tests use background=true, then poll command_status until you get the exit code.', {
    shell: { type: 'string', enum: ['bash', 'powershell'] }, command: string('The exact command to display and execute.'),
    background: { type: 'boolean', description: 'Run for up to 10 minutes during this turn and return a job_id immediately after approval.' },
  }, ['command']),
  tool('command_status', 'terminal', 'Wait for an already approved background command. Returns current output and the exit code when finished. Keep using the same job_id.', {
    job_id: string('The job_id returned by run_command.'), wait_ms: { type: 'integer', minimum: 0, maximum: 20000 },
  }, ['job_id']),
  tool('android_devices', 'android', 'List attached Android devices and emulators and their authorization status.', {}),
  tool('android_device_info', 'android', 'Read the Android SDK level of the selected device.', { device }, ['device']),
  tool('android_install_apk', 'android', 'Install or update a development APK from the selected workspace on a device.', { device, path: relativePath }, ['device', 'path']),
  tool('android_run_tests', 'android', 'Run installed instrumentation tests and return the Android test runner output.', { device, runner: string('Instrumentation component, e.g. com.example.test/androidx.test.runner.AndroidJUnitRunner') }, ['device', 'runner']),
  tool('propose_mcp_server', 'setup', 'Open a setup form in Nextbrowser for the user to review and connect an MCP server. Leave credentials for the user to enter.', {
    name: string('A display name for the server.'), config_json: string('JSON object with command and args, or an HTTP(S) url.'),
  }, ['name', 'config_json']),
  tool('search_mcp_catalog', 'setup', 'Search the public MCP registry for a server by name or purpose. Review returned configurations before proposing them.', { search: string('Public search terms only.') }, ['search']),
];
async function androidArgs(name, args, folder) {
  if (name === 'android_devices') return ['devices', '-l'];
  if (typeof args.device !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,254}$/.test(args.device)) throw Error('Select a device serial from android_devices.');
  const target = ['-s', args.device];
  if (name === 'android_device_info') return [...target, 'shell', 'getprop', 'ro.build.version.sdk'];
  if (name === 'android_install_apk') {
    const file = await resolveEntry(folder, args.path);
    if (!file.toLowerCase().endsWith('.apk') || !(await fs.stat(file)).isFile()) throw Error('Select an APK file inside the workspace.');
    return [...target, 'install', '-r', file];
  }
  if (name !== 'android_run_tests' || typeof args.runner !== 'string' || !/^[A-Za-z][\w.]*\/[A-Za-z.][\w.]*$/.test(args.runner)) throw Error('Enter a package/runner instrumentation component.');
  return [...target, 'shell', 'am', 'instrument', '-w', '-r', args.runner];
}
function createStockMcp({ dataRoot, dialog, requestApproval, isCurrent, searchCatalog, runAndroid = runProgram, sandboxShell = runWorkspaceShell }) {
  const store = createAppSettings({ file: path.join(dataRoot, 'stock-mcp-permissions.json') });
  const sessions = new Map(), pending = new Set();
  const scopeKey = scope => createHash('sha256').update(JSON.stringify([scope.owner, scope.workspaceId])).digest('hex');
  let canonicalDataRoot;
  function defaultFolder(key) {
    if (!canonicalDataRoot) {
      mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
      // Match fs.promises.realpath, including Windows short names in TEMP.
      canonicalDataRoot = realpathSync.native(dataRoot);
    }
    return path.join(canonicalDataRoot, 'workspace-files', key);
  }
  function policy(scope) {
    const key = scopeKey(scope);
    const stored = store.snapshot().values[key];
    const saved = savedPolicy(stored);
    const effective = {};
    for (const [group, options] of Object.entries(modes)) effective[group] = options.includes(saved[group]) ? saved[group] : group in saved ? 'off' : defaults[group];
    const available = Object.keys(shells());
    const preferredShell = saved.preferredShell || 'auto';
    const preset = Object.keys(presets).find(name => Object.keys(modes).every(group => effective[group] === presets[name][group])) || 'custom';
    const trustedCount = JSON.parse(store.snapshot().values[key + '.trusted'] || '[]').length;
    const folder = saved.folder || defaultFolder(key);
    const homeRelative = path.relative(folder, os.homedir());
    const containsHome = !homeRelative || (!path.isAbsolute(homeRelative) && homeRelative.split(path.sep)[0] !== '..');
    const needsProjectFolder = effective.terminal === 'sandbox' && (path.parse(folder).root === folder || containsHome);
    const commandFolder = needsProjectFolder ? defaultFolder(key) : folder;
    return { ...effective, preset, trustedCount, commandPreviews: saved.commandPreviews === true, folder, commandFolder, customFolder: Boolean(saved.folder),
      revision: saved.revision || '', shells: available, preferredShell,
      defaultShell: preferredShell === 'auto' ? available[0] : available.find(shell => shell === preferredShell),
      adb: adbExecutable(saved.androidSdkFolder) || null };
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
    } else if (command === 'stock_mcp_preset') {
      if (!Object.hasOwn(presets, args.preset)) throw Error('Unknown permissions preset.');
      patch = presets[args.preset];
    } else if (command === 'stock_mcp_command_previews') {
      if (typeof args.enabled !== 'boolean') throw Error('Invalid command preview setting.');
      patch = { commandPreviews: args.enabled };
    } else if (command === 'stock_mcp_forget_commands') {
      patch = {};
    } else if (command === 'stock_mcp_shell') {
      if (!['auto', ...Object.keys(shells())].includes(args.shell)) throw Error('Choose an installed shell.');
      patch = { preferredShell: args.shell };
    } else if (command === 'stock_mcp_android_sdk') {
      const result = await dialog.showOpenDialog(scope.window, { title: translate("Choose Android SDK or platform-tools folder"), properties: ['openDirectory'] });
      if (result.canceled || !result.filePaths[0]) return policy(scope);
      const dir = await fs.realpath(result.filePaths[0]);
      if (!adbExecutable(dir)) throw Error('This folder does not contain Android SDK Platform-Tools (adb).');
      patch = { androidSdkFolder: dir };
    } else if (command === 'stock_mcp_folder') {
      const result = await dialog.showOpenDialog(scope.window, { title: translate("Choose the agent working folder"), properties: ['openDirectory'] });
      if (result.canceled || !result.filePaths[0]) return policy(scope);
      patch = { folder: await fs.realpath(result.filePaths[0]) };
    } else throw Error('Unknown permission setting.');
    assertCurrent(scope);
    const key = scopeKey(scope);
    const saved = savedPolicy(store.snapshot().values[key]);
    const values = { [key]: JSON.stringify({ ...saved, ...patch, version: 2, revision: randomUUID() }) };
    if ((patch.folder && saved.folder !== patch.folder) || (patch.terminal && patch.terminal !== 'sandbox' && !keepsCommandGrants(patch.terminal)) || command === 'stock_mcp_forget_commands') values[key + '.trusted'] = null;
    await store.update({ values });
    return policy(scope);
  }
  async function execute(scope, conversationId, name, args, signal, jobs) {
    assertCurrent(scope);
    signal.throwIfAborted();
    const prefs = policy(scope);
    const key = scopeKey(scope);
    const policyAtStart = store.snapshot().values[key];
    const group = catalog.find(t => t.definition.name === name)?.group;
    function checkPolicy() {
      assertCurrent(scope);
      if (policyAtStart !== store.snapshot().values[key]) throw Error('Permissions or working folder changed. Inspect the new settings.');
      if (!availableTool(prefs, group, name)) throw Error('This tool is disabled for this workspace.');
    }
    function check() { signal.throwIfAborted(); checkPolicy(); }
    check();
    if (name === 'command_status') return jobs.read(args.job_id, args.wait_ms ?? 10000, signal);
    if (name === 'get_permissions') {
      const { files, edits, terminal, android, setup, folder, commandFolder, shells, defaultShell } = prefs;
      return { preset: prefs.preset, files, edits, terminal, android, setup, folder, commandFolder, platform: process.platform, shells, defaultShell, adbAvailable: Boolean(prefs.adb),
        fileToolScope: 'Read and edit permissions apply only inside the selected workspace folder. Edits cover directory creation and writing text files.',
        commandAccess: terminal === 'off' ? 'Terminal disabled.' : !shells.length ? 'No supported shell installed.'
          : terminal === 'sandbox' ? 'Autopilot: run new Bash or PowerShell commands immediately. The shell starts in commandFolder. To run an existing project elsewhere, change directory to its path in the command before starting the script. Writes are limited to the sandbox workspace and temporary files.'
          : terminal === 'approved' ? 'Only exact commands previously remembered for this folder and shell can run. Other commands are declined immediately. Use the workspace file tools for local files and directories.'
          : 'Terminal commands can use OS-accessible paths, including the Desktop. ' + (terminal === 'trusted' ? 'Previously approved exact commands run automatically. Other commands prompt.' : 'Each command prompts for approval.') };
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
    const android = group === 'android';
    const edit = group === 'edits';
    if (!android && !edit && !['run_command', 'list_directory', 'read_text_file', 'search_files'].includes(name)) throw Error('Unknown workspace tool.');
    const terminal = name === 'run_command';
    const command = typeof args.command === 'string' ? args.command.replace(/\r\n/g, '\n') : '';
    const available = shells();
    const shell = args.shell ?? prefs.defaultShell;
    if (terminal && (!Object.hasOwn(available, shell) || !safeText(command, 1800) || command.split('\n').length > 12)) throw Error('Choose an installed shell and a short, displayable command.');
    if (android && !prefs.adb) throw Error('Install Android SDK Platform-Tools or choose the SDK folder in Extensions → MCP → Permissions.');
    if (!terminal && !android && (!safeText(args.path, 600) || args.path.includes('\n'))) throw Error('Enter a relative file path.');
    if (pending.has(scope.shellId)) throw Error('A local tool is already awaiting approval or running in this window.');
    pending.add(scope.shellId);
    const controller = new AbortController();
    const operation = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(95_000)]);
    const poll = setInterval(() => { try { check(); } catch { controller.abort(); } }, 150);
    try {
      const argv = android && await androidArgs(name, args, prefs.folder);
      const trustKey = key + '.trusted';
      const trustedCommands = () => JSON.parse(store.snapshot().values[trustKey] || '[]');
      const fingerprint = terminal && keepsCommandGrants(prefs.terminal) && createHash('sha256').update(JSON.stringify([prefs.folder, available[shell], shell, command, ...(args.background === true ? ['background'] : [])])).digest('hex');
      const needsCommandGrant = fingerprint && !trustedCommands().includes(fingerprint);
      if (needsCommandGrant && prefs.terminal === 'approved') throw Error('This exact command has no saved approval for this shell and folder. Use a permitted workspace tool or report the limitation.');
      const androidWrite = name === 'android_install_apk' || name === 'android_run_tests';
      if (prefs[group] === 'ask' || needsCommandGrant || (prefs.android === 'inspect' && androidWrite)) {
        const action = android ? 'Run this Android development command?' : terminal ? 'Run a terminal command as your OS user?' : edit ? 'Allow this workspace edit?' : name === 'search_files' ? 'Search this folder and share matching lines?' : name === 'list_directory' ? 'Share a directory listing with the agent?' : 'Share this file’s text with the agent?';
        let detail = android ? [prefs.adb, ...argv].map(arg => JSON.stringify(arg)).join(' ') : terminal ? command : args.path;
        if (name === 'patch_file') detail += '\nReplace matching lines:\n' + String(args.old_text).slice(0, 1200) + '\nWith:\n' + String(args.new_text).slice(0, 1200);
        else if (edit) detail += name === 'create_directory' ? '\nCreate directory' : (args.expected_sha256 ? '\nReplace file' : '\nCreate file') + '\n\n' + String(args.content ?? '').slice(0, 1500) + (args.content?.length > 1500 ? '\n… (preview truncated)' : '');
        if (name === 'search_files') detail = 'Search files under ' + args.path + ' for ' + String(args.query).slice(0, 300);
        if (terminal && args.background === true) detail += '\nRun in the background for up to 10 minutes.';
        let preview;
        if (terminal) {
          if (prefs.commandPreviews && !command.includes('\n')) preview = `${available[shell]} · ${prefs.folder}\n${command}`;
        } else if (!edit) {
          preview = android ? detail : path.resolve(prefs.folder, args.path);
        }
        const notificationDetail = preview && preview.length <= 100 ? preview : undefined;
        const answer = await requestApproval(scope, conversationId, { title: action, detail, folder: prefs.folder,
          shell: terminal ? available[shell] : undefined, canRemember: Boolean(fingerprint), notificationDetail }, operation);
        if (answer === 'remember' && fingerprint) {
          operation.throwIfAborted();
          check();
          await store.update({ values: { [trustKey]: JSON.stringify([...new Set([...trustedCommands(), fingerprint])].slice(-256)) } });
        } else if (answer !== 'once') throw Error('The user denied this request. Do not retry it.');
      }
      operation.throwIfAborted();
      check();
      if (!prefs.customFolder) await fs.mkdir(prefs.folder, { recursive: true, mode: 0o700 });
      let result;
      if (android) {
        const confirmedArgs = await androidArgs(name, args, prefs.folder);
        if (JSON.stringify(confirmedArgs) !== JSON.stringify(argv)) throw Error('The Android command changed. Try again.');
        const cwd = await resolveEntry(prefs.folder, '.');
        check();
        result = await runAndroid(prefs.adb, confirmedArgs, cwd, operation, 90_000);
      } else if (terminal) {
        if (prefs.commandFolder !== prefs.folder) await fs.mkdir(prefs.commandFolder, { recursive: true, mode: 0o700 });
        const cwd = await resolveEntry(prefs.commandFolder, '.');
        check();
        const run = prefs.terminal === 'sandbox' ? sandboxShell : runShell;
        result = args.background === true
          ? jobs.start((jobSignal, output) => run(available[shell], shell, command, cwd, jobSignal, 600000, output), checkPolicy)
          : await run(available[shell], shell, command, cwd, operation);
      } else if (name === 'patch_file') {
        result = await patchFile(prefs.folder, args, check);
      } else if (name === 'search_files') {
        result = await searchFiles(prefs.folder, args.path, args.query, operation);
      } else if (edit) {
        result = await editEntry(prefs.folder, args.path, name === 'create_directory', args.content, args.expected_sha256, check);
      } else {
        result = await readEntry(prefs.folder, args.path, name === 'list_directory', args.offset ?? 0);
      }
      operation.throwIfAborted();
      check();
      return result;
    } finally { clearInterval(poll); pending.delete(scope.shellId); }
  }
  function open(scope, baseURL, signal, conversationId) {
    assertCurrent(scope);
    const token = randomUUID();
    const lease = new AbortController();
    const sessionSignal = AbortSignal.any([signal, lease.signal]);
    sessions.set(token, { scope, conversationId, signal: sessionSignal, jobs: createCommandJobs(sessionSignal) });
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
      const tools = valid ? catalog.filter(t => availableTool(prefs, t.group, t.definition.name)).map(t => t.definition) : [];
      return await serveLocalMcp(request, response, valid && ((name, args) => execute(session.scope, session.conversationId, name, args, AbortSignal.any([session.signal, client.signal]), session.jobs)),
        { serverInfo: { name: 'nextbrowser-workspace-tools', version: '1.0.0' }, instructions: toolInstructions(), tools });
    } finally { response.off('close', disconnect); }
  }
  return { open, serve, settings };
}
module.exports = { createStockMcp, endpoint, toolInstructions };
