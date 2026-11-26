const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createStockMcp } = require('./stock-mcp.cjs');
const { readEntry, runShell, shells } = require('./stock-mcp-operations.cjs');
const { createHttpMcpClient } = require('./mcp-http-client.cjs');
const { runBuiltinAgentTurn } = require('./builtin-agent-run.cjs');

test('finds code and applies a unique patch while preserving unrelated bytes and permissions', async t => {
  const { host, scope, client } = await fixture(t);
  const prefs = await host.settings(scope, 'stock_mcp_preset', { preset: 'autonomous' });
  await fs.mkdir(prefs.folder, { recursive: true });
  const file = path.join(prefs.folder, 'math.js');
  const original = '\uFEFF// header\r\nconst oldValue = 2;\r\n// preserved\r\n' + 'x'.repeat(70000);
  await fs.writeFile(file, original);
  const call = async (name, args) => {
    const result = await client.callTool(name, args);
    assert.ok(!result.isError, result.content[0].text);
    return JSON.parse(result.content[0].text);
  };
  const found = await call('search_files', { path: '.', query: 'oldValue' });
  assert.deepEqual(found.matches, [{ path: 'math.js', line: 2, text: 'const oldValue = 2;' }]);
  const { sha256 } = await call('read_text_file', { path: 'math.js' });
  const args = { path: 'math.js', expected_sha256: sha256, old_text: found.matches[0].text, new_text: 'const value = 1;\nconst doubled = value * 2;' };
  const patched = await call('patch_file', args);
  assert.match(patched.diff, /@@ -2,1 \+2,2 @@/);
  assert.equal(await fs.readFile(file, 'utf8'), original.replace(args.old_text, args.new_text.replace('\n', '\r\n')));
  assert.equal((await client.callTool('patch_file', args)).isError, true);
  await fs.writeFile(file, 'a\na\n');
  const current = await call('read_text_file', { path: 'math.js' });
  assert.equal((await client.callTool('patch_file', { ...args, expected_sha256: current.sha256, old_text: 'a' })).isError, true);
  await host.settings(scope, 'stock_mcp_set', { group: 'edits', mode: 'off' });
  assert.equal((await client.callTool('patch_file', args)).isError, true);
  await host.settings(scope, 'stock_mcp_set', { group: 'files', mode: 'off' });
  assert.equal((await client.callTool('search_files', { path: '.', query: 'value' })).isError, true);
});

test('background execution uses the approved sandbox and the owning MCP session; revocation interrupts it', async t => {
  let stop;
  const stopped = new Promise(resolve => { stop = resolve; });
  const { host, scope, client, session } = await fixture(t, undefined, {
    sandboxShell: (_file, _shell, _cmd, _cwd, signal, timeout, onOutput) => new Promise(resolve => {
      assert.equal(timeout, 600000);
      onOutput('building');
      signal.addEventListener('abort', () => { stop(); resolve({ exitCode: null }); }, { once: true });
    }),
  });
  await host.settings(scope, 'stock_mcp_preset', { preset: 'autopilot' });
  const args = { command: 'npm test', background: true };
  const start = await client.callTool('run_command', args);
  const { job_id } = JSON.parse(start.content[0].text);
  const status = { job_id, wait_ms: 0 };
  assert.equal(JSON.parse((await client.callTool('command_status', status)).content[0].text).output, 'building');
  const other = host.open(scope, new URL(session.server.url).origin, new AbortController().signal, 'other-chat');
  const otherClient = createHttpMcpClient(other.server);
  t.after(() => { otherClient.close(); other.close(); });
  assert.equal((await otherClient.callTool('command_status', status)).isError, true);
  assert.equal((await client.callTool('run_command', args)).isError, true);
  await host.settings(scope, 'stock_mcp_set', { group: 'terminal', mode: 'off' });
  await stopped;
  assert.equal((await client.callTool('command_status', status)).isError, true);
});

test('a coding chat verifies test exit codes after its last patch and rejects an unsupported success claim', async t => {
  const command = 'node --test price.test.cjs';
  const { host, scope, session } = await fixture(t, async (_scope, _chat, prompt) =>
    prompt.detail.startsWith(command) ? 'once' : 'deny');
  const policy = await host.settings(scope, 'stock_mcp_preset', { preset: 'autonomous' });
  await fs.mkdir(policy.folder, { recursive: true });
  const broken = 'module.exports = (p, d) => p * (1 + d / 100);';
  const fixed = broken.replace('+', '-');
  await fs.writeFile(path.join(policy.folder, 'price.test.cjs'), "require('node:assert/strict').equal(require('./price.cjs')(100,20),80);");
  for (const variant of ['repair', 'premature', 'stale', 'missing']) {
    await fs.writeFile(path.join(policy.folder, 'price.cjs'), variant === 'stale' ? fixed : broken);
    let turn = 0;
    const exits = [];
    const request = 'Исправь расчёт скидки и проверь тестами.';
    const fetchImpl = async (_url, options) => {
      const body = JSON.parse(options.body);
      const last = body.messages.at(-1);
      const data = last.role === 'tool' ? JSON.parse(last.content) : {};
      if (Number.isInteger(data.exitCode)) exits.push(data.exitCode);
      const call = (name, args) => ({ role: 'assistant', tool_calls: [{id: 'c' + turn, type: 'function', function: {name: 'workspace_' + name, arguments: JSON.stringify(args)}}] });
      let answer = {role: 'assistant', content: 'Готово, все тесты прошли.'};
      turn++;
      if (variant !== 'missing' && turn === 1) answer = call('run_command', { command, shell: policy.defaultShell });
      if (variant !== 'premature' && variant !== 'missing') {
        if (turn === 2) answer = call('read_text_file', { path: 'price.cjs' });
        if (turn === 3) answer = call('patch_file', {path:'price.cjs', expected_sha256:data.sha256, old_text:data.text, new_text:variant === 'repair' ? fixed : broken});
        if (turn === 4 && variant === 'repair') answer = call('run_command', { command, shell: policy.defaultShell, background:true });
        if (turn === 5 && variant === 'repair') answer = call('command_status', { job_id:data.job_id, wait_ms:20000 });
      }
      return Response.json({choices:[{message:answer, finish_reason:answer.tool_calls ? 'tool_calls' : 'stop'}]});
    };
    const result = await runBuiltinAgentTurn({ settings:{provider:'custom',baseURL:'http://127.0.0.1:1/v1',model:'fixture'},
      loadKey:async()=>'', userMcpServers:[session.server], prompt:request, chatTurn:{request}, fetchImpl });
    assert.equal(result.status, variant === 'repair' ? 'completed' : 'verification_pending', JSON.stringify(result));
    if (variant === 'repair') { assert.deepEqual(exits,[1,0]); assert.match(result.stdout,/price\.cjs/); }
    else assert.doesNotMatch(result.stdout,/все тесты прошли/);
    if (variant === 'premature') assert.match(result.stdout,/код выхода 1/);
    if (variant === 'stale') assert.match(result.stdout,/до последнего изменения/);
  }
});

async function fixture(t, requestApproval = async () => 'deny', options = {}) {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nb-stock-test-'));
  const scope = { owner: 'test', workspaceId: 'work', shellId: 42, window: { webContents: { send() {} } } };
  let current = scope;
  const host = createStockMcp({ dataRoot, requestApproval, dialog: { showOpenDialog: async () => ({filePaths: [dataRoot]}) }, isCurrent: candidate => current === candidate, ...options });
  const server = http.createServer((req, res) => host.serve(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const controller = new AbortController();
  const session = host.open(scope, 'http://127.0.0.1:' + server.address().port, controller.signal, 'chat-1');
  const client = createHttpMcpClient(session.server);
  t.after(async () => {
    controller.abort(); client.close(); session.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve)); await fs.rm(dataRoot, { recursive: true, force: true });
  });
  return { host, scope, session, client, dataRoot, changeScope() { current = null; } };
}
test('each installed shell reports output and the real exit code', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'nb-shell-test-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  for (const [name, file] of Object.entries(shells())) {
    const result = await runShell(file, name, name === 'bash' ? 'printf shell-ok; exit 7' : "Write-Output 'shell-ok'; exit 7", folder, new AbortController().signal);
    assert.equal(result.exitCode, 7);
    assert.equal(result.output.trim(), 'shell-ok');
  }
});
test('the default workspace works through an OS alias to the app data directory', async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'nb-appdata-alias-'));
  const alias = path.join(parent, 'alias');
  const appData = path.join(parent, 'real');
  await fs.mkdir(appData);
  await fs.symlink(appData, alias, process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const { host, scope, client } = await fixture(t, undefined, { dataRoot: path.join(alias, 'new-user') });
  await host.settings(scope, 'stock_mcp_set', { group: 'files', mode: 'allow' });
  const result = await client.callTool('list_directory', { path: '.' });
  assert.ok(!result.isError, result.content[0].text);
  assert.deepEqual(JSON.parse(result.content[0].text).entries, []);
});
test('only the current authenticated agent session can discover stock tools; disabled tools cannot execute', async t => {
  const { host, scope, session, client, changeScope } = await fixture(t);
  for (const headers of [{}, { ...session.server.headers, Origin: 'https://example.org' }]) {
    assert.equal((await fetch(session.server.url, { method: 'POST', headers })).status, 403);
  }
  await client.initialize();
  assert((await client.listTools()).some(t => t.name === 'run_command'));
  await host.settings(scope, 'stock_mcp_set', { group: 'terminal', mode: 'off' });
  assert(!(await client.listTools()).some(t => t.name === 'run_command'));
  assert.equal((await client.callTool('run_command', { shell: 'bash', command: 'pwd' })).isError, true);
  await assert.rejects(host.settings(scope, 'stock_mcp_set', { group: 'terminal', mode: 'allow' }));
  changeScope();
  await assert.rejects(client.listTools(), /403/);
});
test('a pending approval becomes unusable when the user changes permissions', async t => {
  let shown, decide;
  const waiting = new Promise(resolve => { shown = resolve; });
  const { scope, host, client } = await fixture(t, (_scope, conversationId, prompt) => {
    assert.equal(conversationId, 'chat-1');
    assert.equal(prompt.canRemember, false);
    shown();
    return new Promise(resolve => { decide = resolve; });
  });
  const call = client.callTool('list_directory', { path: '.' });
  await waiting;
  await host.settings(scope, 'stock_mcp_set', { group: 'files', mode: 'off' });
  decide('once');
  assert.equal((await call).isError, true);
});
test('Autonomous edits create a folder and version-checked files without prompting, only inside the workspace', async t => {
  const { host, scope, client, dataRoot } = await fixture(t, () => { throw Error('Unexpected approval'); });
  const edit = (name, args) => client.callTool(name, args);
  assert.equal((await edit('create_directory', { path: 'example' })).isError, true);
  const { folder, preset } = await host.settings(scope, 'stock_mcp_preset', { preset: 'autonomous' });
  assert.equal(preset, 'autonomous');
  assert.equal(JSON.parse((await edit('get_permissions', {})).content[0].text).edits, 'allow');
  assert.ok(!(await edit('create_directory', { path: 'example' })).isError);
  const file = { path: 'example/demo.txt', content: 'first' };
  assert.ok(!(await edit('write_text_file', file)).isError);
  assert.equal((await edit('write_text_file', { ...file, content: 'replace' })).isError, true);
  const read = JSON.parse((await edit('read_text_file', { path: file.path })).content[0].text);
  assert.ok(!(await edit('write_text_file', { ...file, content: 'second', expected_sha256: read.sha256 })).isError);
  assert.equal((await edit('write_text_file', { ...file, expected_sha256: read.sha256 })).isError, true);
  assert.equal(await fs.readFile(path.join(folder, file.path), 'utf8'), 'second');
  await fs.symlink(dataRoot, path.join(folder, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const input of ['../escape', 'outside/escape', '/escape']) {
    assert.equal((await edit('create_directory', { path: input })).isError, true);
    assert.equal((await edit('write_text_file', { path: input, content: 'blocked' })).isError, true);
  }
  assert.equal((await edit('stock_mcp_preset', { preset: 'manual' })).isError, true);
  await host.settings(scope, 'stock_mcp_preset', { preset: 'manual' });
  assert.equal((await edit('write_text_file', file)).isError, true);
});
test('remembering an exact shell command survives restart, respects changes and can be revoked', async t => {
  let prompts = 0, response = 'remember';
  const { scope, client, host, dataRoot } = await fixture(t, (_scope, _conversationId, prompt) => {
    prompts++;
    assert.equal(prompt.canRemember, true);
    return response;
  });
  const { defaultShell } = await host.settings(scope, 'stock_mcp_preset', { preset: 'autonomous' });
  assert.ok(defaultShell);
  const command = defaultShell === 'bash' ? 'echo test' : 'Write-Output test';
  const run = line => client.callTool('run_command', { command: line });
  assert.equal(JSON.parse((await run(command)).content[0].text).output.trim(), 'test');
  response = 'deny';
  assert.equal(JSON.parse((await run(command)).content[0].text).output.trim(), 'test');
  assert.equal(prompts, 1);
  const reopened = createStockMcp({ dataRoot, isCurrent: () => true });
  assert.equal((await reopened.settings(scope, 'stock_mcp_get')).trustedCount, 1);
  assert.equal((await reopened.settings({ ...scope, workspaceId: 'other' }, 'stock_mcp_get')).trustedCount, 0);
  assert.equal((await run(command + '2')).isError, true);
  assert.equal(prompts, 2);
  await host.settings(scope, 'stock_mcp_forget_commands');
  assert.equal((await run(command)).isError, true);
  response = 'remember';
  assert.equal(JSON.parse((await run(command)).content[0].text).exitCode, 0);
  assert.equal((await host.settings(scope, 'stock_mcp_folder')).trustedCount, 0);
  response = 'deny';
  assert.equal((await run(command)).isError, true);
});
test('Autopilot routes previously unseen commands to the workspace sandbox without asking', async t => {
  let prompts = 0;
  const runs = [];
  const { host, scope, client, dataRoot } = await fixture(t, () => { prompts++; return 'deny'; }, {
    sandboxShell: async (file, shell, command, cwd) => { runs.push({ file, shell, command, cwd }); return { exitCode: 0, output: 'sandbox' }; },
  });
  const command = { command: 'echo autopilot-ok' };

  const settings = await host.settings(scope, 'stock_mcp_preset', { preset: 'autopilot' });
  assert.equal(settings.trustedCount, 0);
  const reopened = createStockMcp({ dataRoot, isCurrent: () => true });
  assert.equal((await reopened.settings(scope, 'stock_mcp_get')).preset, 'autopilot');
  assert.equal((await reopened.settings({ ...scope, owner: 'other' }, 'stock_mcp_get')).preset, 'manual');
  assert.equal(JSON.parse((await client.callTool('get_permissions', {})).content[0].text).preset, 'autopilot');
  for (const [shell, file] of Object.entries(shells())) {
    assert.equal(JSON.parse((await client.callTool('run_command', { ...command, shell })).content[0].text).output, 'sandbox');
    assert.deepEqual(runs.at(-1), { file, shell, command: command.command, cwd: settings.folder });
  }
  assert.equal(JSON.parse((await client.callTool('create_directory', { path: 'sample' })).content[0].text).created, 'sample');
  assert.ok(!(await client.callTool('write_text_file', { path: 'sample/test.txt', content: 'written' })).isError);
  assert.equal(JSON.parse((await client.callTool('read_text_file', { path: 'sample/test.txt' })).content[0].text).text, 'written');
  const tools = (await client.listTools()).map(tool => tool.name);
  assert.ok(tools.includes('search_mcp_catalog'));
  for (const name of ['android_run_tests', 'android_install_apk', 'propose_mcp_server']) {
    assert.ok(!tools.includes(name));
    assert.equal((await client.callTool(name, {})).isError, true);
  }
  await host.settings(scope, 'stock_mcp_set', { group: 'terminal', mode: 'approved' });
  assert.equal((await client.callTool('run_command', command)).isError, true);
  assert.equal(prompts, 0);
});
test('Autopilot uses a project sandbox when the user selected a whole drive', async t => {
  const drive = path.parse(os.homedir()).root;
  const { host, scope, client } = await fixture(t, () => { throw Error('Unexpected approval'); }, {
    dialog: { showOpenDialog: async () => ({ filePaths: [drive] }) },
    sandboxShell: async (_file, _shell, _command, cwd) => ({ exitCode: 0, output: cwd }),
  });
  const initial = await host.settings(scope, 'stock_mcp_get');
  await host.settings(scope, 'stock_mcp_folder', {});
  await host.settings(scope, 'stock_mcp_preset', { preset: 'autopilot' });
  const {folder, commandFolder} = JSON.parse((await client.callTool('get_permissions', {})).content[0].text);
  assert.equal(folder, await fs.realpath(drive));
  assert.equal(commandFolder, initial.folder);
  assert.equal(JSON.parse((await client.callTool('run_command', { command: 'echo ready' })).content[0].text).output, commandFolder);
});
test('the previous Autopilot selection upgrades and an explicitly customised remembered-only policy stays restricted', async t => {
  const { host, scope, dataRoot } = await fixture(t);
  await host.settings(scope, 'stock_mcp_preset', { preset: 'autopilot' });
  const file = path.join(dataRoot, 'stock-mcp-permissions.json');
  const state = JSON.parse(await fs.readFile(file, 'utf8'));
  const key = Object.keys(state.values).find(key => !key.includes('.'));
  const saved = JSON.parse(state.values[key]);
  delete saved.version;
  saved.terminal = 'approved';
  state.values[key] = JSON.stringify(saved);
  await fs.writeFile(file, JSON.stringify(state));
  const reopen = () => createStockMcp({ dataRoot, isCurrent: () => true });
  const migrated = reopen();
  assert.equal((await migrated.settings(scope, 'stock_mcp_get')).preset, 'autopilot');
  await migrated.settings(scope, 'stock_mcp_shell', { shell: 'auto' });
  assert.equal((await reopen().settings(scope, 'stock_mcp_get')).terminal, 'sandbox');
  await migrated.settings(scope, 'stock_mcp_set', { group: 'terminal', mode: 'approved' });
  assert.equal((await reopen().settings(scope, 'stock_mcp_get')).preset, 'custom');
});
test('permission choices persist only for the selected account and workspace', async t => {
  const { scope, host, dataRoot } = await fixture(t);
  await host.settings(scope, 'stock_mcp_set', { group: 'terminal', mode: 'off' });
  const reopened = createStockMcp({ dataRoot, isCurrent: () => true });
  assert.equal((await reopened.settings(scope, 'stock_mcp_get')).terminal, 'off');
  assert.equal((await reopened.settings(scope, 'stock_mcp_get')).android, 'ask');
  for (const foreign of [{ ...scope, owner: 'other-account' }, { ...scope, workspaceId: 'other-workspace' }]) {
    const separate = await reopened.settings(foreign, 'stock_mcp_get');
    assert.equal(separate.terminal, 'ask');
    assert.notEqual(separate.folder, (await reopened.settings(scope, 'stock_mcp_get')).folder);
  }
});
test('a workspace can run a command using the default shell and change its preference', async t => {
  const { host, scope, client } = await fixture(t, async () => 'once');
  const available = Object.keys(shells());
  const prefs = await host.settings(scope, 'stock_mcp_get');
  assert.equal(prefs.defaultShell, available.includes('bash') ? 'bash' : available[0]);
  for (const shell of available) {
    const next = await host.settings(scope, 'stock_mcp_shell', { shell });
    assert.equal(next.defaultShell, shell);
    const result = await client.callTool('run_command', { command: shell === 'bash' ? 'printf bash-ok' : 'Write-Output powershell-ok' });
    assert.equal(JSON.parse(result.content[0].text).output.trim(), shell + '-ok');
  }
});
test('notification command previews are opt-in per workspace and multiline commands require review', async t => {
  const prompts = [];
  const { host, scope, client } = await fixture(t, (_scope, _chat, prompt) => { prompts.push(prompt); return 'deny'; });
  const run = command => client.callTool('run_command', { command });
  await run('echo hello');
  assert.equal(prompts.at(-1).notificationDetail, undefined);
  await host.settings(scope, 'stock_mcp_folder', {});
  await host.settings(scope, 'stock_mcp_command_previews', { enabled: true });
  await run('echo test');
  const { shell, folder, detail, notificationDetail } = prompts.at(-1);
  const summary = shell + ' · ' + folder + '\n' + detail;
  assert.equal(notificationDetail, summary.length <= 100 ? summary : undefined);
  await run('echo one\necho two');
  assert.equal(prompts.at(-1).notificationDetail, undefined);
  await host.settings(scope, 'stock_mcp_command_previews', { enabled: false });
  await run('echo test');
  assert.equal(prompts.at(-1).notificationDetail, undefined);
});
test('Android uses the selected SDK and explicit device, and honours workspace permissions', async t => {
  const calls = [];
  let approve = true;
  const { host, scope, client, dataRoot } = await fixture(t, async () => approve ? 'once' : 'deny', {
    runAndroid: async (file, argv) => { calls.push({file, argv}); return { exitCode: 0, output: 'fixture', truncated: false }; },
  });
  const adb = path.join(dataRoot, process.platform === 'win32' ? 'adb.exe' : 'adb');
  await fs.writeFile(adb, '', { mode: 0o755 });
  const { folder } = await host.settings(scope, 'stock_mcp_android_sdk');
  const device = 'emulator-5554';
  await client.initialize();
  await client.callTool('android_devices', {});
  await client.callTool('android_device_info', {device});
  await fs.writeFile(path.join(folder, 'demo.apk'), '');
  await client.callTool('android_install_apk', {device, path:'demo.apk'});
  await client.callTool('android_run_tests', {device, runner:'org.demo.test/.Runner'});
  assert.deepEqual(calls.map(call => call.argv), [['devices','-l'], ['-s',device,'shell','getprop','ro.build.version.sdk'],
    ['-s',device,'install','-r',path.join(folder,'demo.apk')], ['-s',device,'shell','am','instrument','-w','-r','org.demo.test/.Runner']]);
  const canonicalAdb = await fs.realpath(adb);
  assert.ok(calls.every(call => call.file === canonicalAdb));
  assert.equal((await client.callTool('android_run_tests', {device, runner:'bad;command'})).isError, true);
  assert.equal((await client.callTool('android_install_apk', {device, path:'../demo.apk'})).isError, true);
  approve = false;
  assert.equal((await client.callTool('android_devices', {})).isError, true);
  await host.settings(scope, 'stock_mcp_set', {group:'android', mode:'inspect'});
  assert.ok(!(await client.callTool('android_devices', {})).isError);
  assert.equal((await client.callTool('android_install_apk', {device, path:'demo.apk'})).isError, true);
  await host.settings(scope, 'stock_mcp_set', {group:'android', mode:'off'});
  assert.ok(!(await client.listTools()).some(tool => tool.name.startsWith('android_')));
  assert.equal(calls.length, 5);
});
test('workspace file tools stay inside the selected folder and page UTF-8 text', async t => {
  const { scope, host, client, dataRoot } = await fixture(t);
  const prefs = await host.settings(scope, 'stock_mcp_set', { group: 'files', mode: 'allow' });
  await fs.mkdir(prefs.folder, { recursive: true });
  await fs.writeFile(path.join(prefs.folder, 'note.txt'), 'a'.repeat(4000) + 'дальше');
  const second = await client.callTool('read_text_file', { path: 'note.txt', offset: 4000 });
  const page = JSON.parse(second.content[0].text);
  assert.equal(page.text, 'дальше');
  assert.equal(page.nextOffset, null);
  assert.match(page.sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(readEntry(prefs.folder, '../outside.txt', false));
  await fs.symlink(dataRoot, path.join(prefs.folder, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(readEntry(prefs.folder, 'outside', true), /outside/);
});
