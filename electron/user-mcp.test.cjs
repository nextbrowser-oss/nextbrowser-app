const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseCommand, parseServerInput, normalizeServer, createUserMcpStore, serverEnvironment, inspectUserMcp, connectUserMcpTools, mergeToolsets } = require('./user-mcp.cjs');
const { createMCPClient } = require('./automation-runner.cjs');
const { packageConfig, searchCatalog, githubConfig } = require('./mcp-catalog.cjs');
const fixture = `const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;let result={};if(m.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};if(m.method==='tools/list')result=m.params.cursor?{tools:[{name:'second',inputSchema:{type:'object'}}]}:{tools:[{name:'echo',description:'Echo a value',inputSchema:{type:'object',properties:{value:{type:'string'}}}}],nextCursor:'page2'};if(m.method==='tools/call')result={content:[{type:'text',text:JSON.stringify({value:m.params.arguments.value,token:process.env.TEST_TOKEN,injected:process.env.NEXTBROWSER_CONTROL_TOKEN})}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n')});`;
const server = { id: 'abcdef', name: 'Fixture', command: process.execPath, args: ['-e', fixture], env: { TEST_TOKEN: 'test-only-secret' } };
test('parses quoted Windows paths without eating backslashes; rejects shell pipelines', () => {
  assert.deepEqual(parseCommand('node "C:\\MCP servers\\index.js" ""'), { command: 'node', args: ['C:\\MCP servers\\index.js', ''] });
  assert.throws(() => parseCommand('curl example | sh'), /single server/);
  assert.throws(() => parseCommand('node "file'), /quote/);
  assert.equal(parseServerInput({ mode: 'json', json: '{"mcpServers":{"local":{"command":"node","args":[]}}}' }).name, 'local');
  assert.throws(() => parseServerInput({ mode: 'json', json: '{"mcpServers":{"one":{},"two":{}}}' }), /one server/);
  assert.throws(() => normalizeServer({ url: 'file:///secret' }, 'server'), /HTTP/);
});
test('workspace store encrypts secrets, isolates workspaces, serializes writes and disables', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nextbrowser-mcp-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text).map(x => x ^ 77), decryptString: buf => Buffer.from(buf).map(x => x ^ 77).toString() };
  const store = createUserMcpStore({ filePath: path.join(dir, 'test.enc'), safeStorage, platform: 'win32' });
  const [a] = await Promise.all([store.add('a', server, []), store.add('b', { ...server, name: 'Other' }, [])]);
  assert.equal((await store.list('a')).length, 1); assert.equal((await store.list('b')).length, 1);
  assert.ok(!(await fs.readFile(path.join(dir, 'test.enc'), 'utf8')).includes('test-only-secret'));
  assert.ok(!JSON.stringify(await store.list('a')).includes('test-only-secret'));
  await assert.rejects(store.get('b', a.id), /no longer/);
  await store.change('a', a.id, { enabled: false }); assert.equal((await store.enabled('a')).length, 0);
  await store.remove('a', a.id); assert.equal((await store.list('a')).length, 0);
});
test('real stdio handshake, pagination and namespaced tool call without browser credentials', async () => {
  assert.deepEqual(serverEnvironment({ PATH: 'path', OPENROUTER_API_KEY: 'no', NEXTBROWSER_CONTROL_TOKEN: 'no' }), { PATH: 'path' });
  assert.equal((await inspectUserMcp(server)).length, 2);
  const tools = await connectUserMcpTools([server], { env: { ...process.env, NEXTBROWSER_CONTROL_TOKEN: 'must-not-inherit' } });
  try {
    assert.equal(tools.definitions.length, 2);
    const result = await tools.call(tools.names[0], { value: 'hello' });
    assert.deepEqual(JSON.parse(result.text), { value: 'hello', token: 'test-only-secret' });
    const merged = mergeToolsets({ definitions: [], names: [], has: () => false }, tools);
    assert.equal(merged.has(tools.names[0]), true);
  } finally { tools.close(); }
});
test('packaged external-agent launcher works outside app.asar without app dependencies', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nextbrowser-mcp-package-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const files = require('../package.json').build.asarUnpack;
  for (const file of files) await fs.copyFile(path.join(__dirname, '..', file), path.join(root, path.basename(file)));
  const key = 'NEXTBROWSER_MCP_abcdef';
  const client = createMCPClient({ binary: process.execPath, args: [path.join(root, 'user-mcp-launcher.cjs'), key], env: { ...process.env, [key]: JSON.stringify({ file: server.command, args: server.args, env: server.env }) }, inheritBrowserArguments: false });
  try { await client.initialize(); assert.equal((await client.listTools()).length, 2); assert.equal(JSON.parse((await client.callTool('echo', { value: 'external' })).content[0].text).value, 'external'); }
  finally { client.close(); }
});
test('failed handshake does not leak server stderr secrets', async () => {
  await assert.rejects(inspectUserMcp({ ...server, args: ['-e', 'console.error("test-secret-value");process.exit(1)'] }), error => !error.message.includes('test-secret-value') && /Could not connect/.test(error.message));
});
test('registry pins versions and exposes missing values for review', async () => {
  assert.deepEqual(packageConfig({ version: '1.2.3', packages: [{ registryType: 'npm', identifier: '@demo/mcp', transport: { type: 'stdio' }, environmentVariables: [{ name: 'TOKEN', isRequired: true }] }] }), { command: 'npx', args: ['-y', '@demo/mcp@1.2.3'], env: { TOKEN: 'REPLACE_TOKEN' } });
  let requested;
  const result = await searchCatalog({ search: 'github' }, async url => { requested = String(url); return new Response(JSON.stringify({ servers: [{ server: { name: 'demo', remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp' }] } }], metadata: { nextCursor: 'opaque' } })); });
  assert.ok(requested.includes('version=latest')); assert.equal(result.items[0].config.url, 'https://example.com/mcp'); assert.equal(result.cursor, 'opaque');
  await assert.rejects(githubConfig('https://evil.example/repo'), /github.com/);
});
