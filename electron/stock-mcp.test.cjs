const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createStockMcp } = require('./stock-mcp.cjs');
const { readEntry, runShell, shells } = require('./stock-mcp-operations.cjs');
const { createHttpMcpClient } = require('./mcp-http-client.cjs');

async function fixture(t, confirm = async () => ({ response: 0 }), options = {}) {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nb-stock-test-'));
  const scope = { owner: 'test', workspaceId: 'work', shellId: 42, window: { webContents: { send() {} } } };
  let current = scope;
  const host = createStockMcp({ dataRoot, dialog: { showMessageBox: confirm, showOpenDialog: async () => ({filePaths: [dataRoot]}) }, isCurrent: candidate => current === candidate, ...options });
  const server = http.createServer((req, res) => host.serve(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const controller = new AbortController();
  const session = host.open(scope, 'http://127.0.0.1:' + server.address().port, controller.signal);
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
  const { scope, host, client } = await fixture(t, (_window, options) => {
    assert.equal(options.defaultId, 0);
    shown();
    return new Promise(resolve => { decide = resolve; });
  });
  const call = client.callTool('list_directory', { path: '.' });
  await waiting;
  await host.settings(scope, 'stock_mcp_set', { group: 'files', mode: 'off' });
  decide({ response: 1 });
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
  let prompts = 0, response = 2;
  const { scope, client, host, dataRoot } = await fixture(t, (_win, options) => {
    prompts++;
    assert.deepEqual(options.buttons, ['Deny', 'Allow once', 'Remember this exact command']);
    return { response };
  });
  const { defaultShell } = await host.settings(scope, 'stock_mcp_preset', { preset: 'autonomous' });
  assert.ok(defaultShell);
  const command = defaultShell === 'bash' ? 'echo test' : 'Write-Output test';
  const run = line => client.callTool('run_command', { command: line });
  assert.equal(JSON.parse((await run(command)).content[0].text).output.trim(), 'test');
  response = 0;
  assert.equal(JSON.parse((await run(command)).content[0].text).output.trim(), 'test');
  assert.equal(prompts, 1);
  const reopened = createStockMcp({ dataRoot, isCurrent: () => true });
  assert.equal((await reopened.settings(scope, 'stock_mcp_get')).trustedCount, 1);
  assert.equal((await reopened.settings({ ...scope, workspaceId: 'other' }, 'stock_mcp_get')).trustedCount, 0);
  assert.equal((await run(command + '2')).isError, true);
  assert.equal(prompts, 2);
  await host.settings(scope, 'stock_mcp_forget_commands');
  assert.equal((await run(command)).isError, true);
  response = 2;
  assert.equal(JSON.parse((await run(command)).content[0].text).exitCode, 0);
  assert.equal((await host.settings(scope, 'stock_mcp_folder')).trustedCount, 0);
  response = 0;
  assert.equal((await run(command)).isError, true);
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
  const { host, scope, client } = await fixture(t, async () => ({ response: 1 }));
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
test('Android uses the selected SDK and explicit device, and honours workspace permissions', async t => {
  const calls = [];
  let approve = true;
  const { host, scope, client, dataRoot } = await fixture(t, async () => ({ response: approve ? 1 : 0 }), {
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
