const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createStockMcp } = require('./stock-mcp.cjs');
const { readEntry, runShell, shells } = require('./stock-mcp-operations.cjs');
const { createHttpMcpClient } = require('./mcp-http-client.cjs');

async function fixture(t, confirm = async () => ({ response: 0 })) {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nb-stock-test-'));
  const scope = { owner: 'test', workspaceId: 'work', shellId: 42, window: { webContents: { send() {} } } };
  let current = scope;
  const host = createStockMcp({ dataRoot, dialog: { showMessageBox: confirm }, isCurrent: candidate => current === candidate });
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
test('permission choices persist only for the selected account and workspace', async t => {
  const { scope, host, dataRoot } = await fixture(t);
  await host.settings(scope, 'stock_mcp_set', { group: 'terminal', mode: 'off' });
  const reopened = createStockMcp({ dataRoot, isCurrent: () => true });
  assert.equal((await reopened.settings(scope, 'stock_mcp_get')).terminal, 'off');
  for (const foreign of [{ ...scope, owner: 'other-account' }, { ...scope, workspaceId: 'other-workspace' }]) {
    const separate = await reopened.settings(foreign, 'stock_mcp_get');
    assert.equal(separate.terminal, 'ask');
    assert.notEqual(separate.folder, (await reopened.settings(scope, 'stock_mcp_get')).folder);
  }
});
test('workspace file tools stay inside the selected folder and page UTF-8 text', async t => {
  const { scope, host, client, dataRoot } = await fixture(t);
  const prefs = await host.settings(scope, 'stock_mcp_set', { group: 'files', mode: 'allow' });
  await fs.mkdir(prefs.folder, { recursive: true });
  await fs.writeFile(path.join(prefs.folder, 'note.txt'), 'a'.repeat(4000) + 'дальше');
  const second = await client.callTool('read_text_file', { path: 'note.txt', offset: 4000 });
  assert.deepEqual(JSON.parse(second.content[0].text), { text: 'дальше', nextOffset: null });
  await assert.rejects(readEntry(prefs.folder, '../outside.txt', false));
  await fs.symlink(dataRoot, path.join(prefs.folder, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(readEntry(prefs.folder, 'outside', true), /outside/);
});
