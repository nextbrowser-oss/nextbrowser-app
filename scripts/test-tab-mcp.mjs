// Usage: set NBC_TEST_BROWSER and NBC_TEST_CLI to local executables. The CLI
// uses its usual authenticated configuration and only a temporary QA session.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import runner from '../electron/automation-runner.cjs';
import builtin from '../electron/builtin-agent-run.cjs';

const cli = process.env.NBC_TEST_CLI;
const executablePath = process.env.NBC_TEST_BROWSER;
assert(cli && executablePath, 'Set NBC_TEST_CLI and NBC_TEST_BROWSER.');
const qa = await mkdtemp(path.join(tmpdir(), 'nb-tab-mcp-'));
const profile = 'tab-mcp-qa';
const state = path.join(qa, 'state', profile);
const shim = fileURLToPath(new URL('../electron/tab-mcp-launcher.cjs', import.meta.url));
const form = '<form toolname="find" tooldescription="Find a book" action="/found" toolautosubmit><input required type="search" name="q"><button>Find</button></form>';
const site = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/native') res.end(`<title>Library</title><output>Ready</output><script>
    const ctx=document.modelContext ?? navigator.modelContext;
    if (ctx) ctx.registerTool({name:'find_book',description:'Find a book by title',inputSchema:{type:'object',properties:{title:{type:'string'}},required:['title']},
      execute(input){document.querySelector('output').textContent=input.title;return 'Found '+input.title;}});
    </script>`);
  else if (url.pathname === '/form') res.end(form);
  else res.end('<title>Library catalogue</title><h1>Books available</h1><a href="/form">Search catalogue</a>');
});
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + site.address().port;
const env = { ...process.env, NBC_AUTO_UPDATE: '0', CLAWBROWSER_STATE_ROOT: path.dirname(state),
  CLAWBROWSER_SESSION_ROOT: path.join(qa, 'sessions'), NBC_PROFILE_ROOT: path.join(qa, 'profiles'),
  NEXTBROWSER_ALLOWED_PROFILES_JSON: JSON.stringify({ [profile]: 'clawbrowser' }) };
delete env.NEXTBROWSER_PROFILE_SCOPE_FILE;
const clients = [];
const makeClient = async prefer => {
  const args = ['--verify-on-start-only', 'mcp'];
  const client = runner.createMCPClient(prefer
    ? { binary: createRequire(import.meta.url)('electron'), args: [shim, cli, ...args], env: { ...env, ELECTRON_RUN_AS_NODE: '1' } }
    : { binary: cli, args, env });
  clients.push(client);
  await client.initialize();
  return client;
};
const call = async (client, name, args = {}) => {
  const result = await client.callTool(name, { profile, ...args }, 35000);
  assert(!result.isError, result.content?.[0]?.text);
  return JSON.parse(result.content[0].text);
};
let context;
async function openFixture(flags, dir) {
  const userData = path.join(qa, dir);
  context = await chromium.launchPersistentContext(userData, { executablePath, headless: true, args: ['--remote-debugging-port=0', ...flags] });
  const [port] = (await readFile(path.join(userData, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
  assert.match(port, /^\d+$/);
  await writeFile(path.join(state, 'state.env'), 'host_port=' + port + '\nsession_name=' + profile + '\nruntime=clawbrowser\n');
}
try {
  await mkdir(state, { recursive: true });
  await openFixture([], 'ordinary');
  const legacy = await makeClient(false);
  assert(!(await legacy.listTools()).some(t => t.name === 'tab_tools_list'));
  await call(legacy, 'open', { url: base + '/' });
  assert.match(JSON.stringify(await call(legacy, 'state')), /Books available/);
  const client = await makeClient(true);
  assert((await client.listTools()).some(t => t.name === 'tab_tool_call'));
  const list = () => call(client, 'tab_tools_list');
  const invoke = (page, tool, input) => call(client, 'tab_tool_call', { document_id: page.document_id, tool, input_json: JSON.stringify(input) });
  const plain = await list();
  assert.deepEqual(plain.tools.map(t => t.name), ['page/read', 'page/follow_link']);
  assert.match((await invoke(plain, 'page/read', {})).output, /Books available/);
  await invoke(plain, 'page/follow_link', { label: 'Search catalogue' });
  await context.pages()[0].waitForURL(base + '/form');
  const stale = await client.callTool('tab_tool_call', { profile, document_id: plain.document_id, tool: 'page/read', input_json: '{}' });
  assert.equal(stale.isError, true);
  const foreign = await client.callTool('tab_tools_list', { profile: 'other-profile' });
  assert.equal(foreign.isError, true);
  const previous = await list();
  await context.pages()[0].reload();
  const reloaded = await client.callTool('tab_tool_call', { profile, document_id: previous.document_id, tool: 'page/read', input_json: '{}' });
  assert.equal(reloaded.isError, true);
  const annotated = await list();
  const name = annotated.tools.find(tool => tool.name.endsWith('/find'))?.name;
  assert(name, 'Annotated form was not discovered');
  await invoke(annotated, name, { q: 'Orbits' });
  await context.pages()[0].waitForURL(base + '/found?q=Orbits');
  console.log('PASS: standard MCP, plain page, stale document, workspace scope and annotated form');
  await context.close();
  await openFixture(['--enable-features=WebMCPTesting', '--enable-blink-features=WebMCPTesting'], 'native');
  await call(client, 'open', { url: base + '/native' });
  const available = await list();
  assert.equal(available.native_webmcp, true, 'This runtime does not expose native WebMCP with its test flag.');
  assert(available.tools.some(t => t.name === 'site/find_book'));
  const selected = await invoke(available, 'site/find_book', { title: 'Orbits' });
  assert.match(selected.output, /Found Orbits/);
  assert.equal(await context.pages()[0].locator('output').innerText(), 'Orbits');
  // Exercise the real agent loop, provider adapter and MCP process. Only the
  // model responses are scripted, so QA is reproducible without a paid model.
  let turn = 0;
  const outcome = await builtin.runBuiltinAgentTurn({
    settings: { provider: 'custom', baseURL: 'http://127.0.0.1:1/v1', model: 'fixture' },
    loadKey: async () => '', prompt: 'Look up Voyager in this tab.', defaultProfile: profile,
    mcp: { binary: createRequire(import.meta.url)('electron'), args: [shim, cli, '--verify-on-start-only', 'mcp'], env: { ...env, ELECTRON_RUN_AS_NODE: '1' } },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      const names = body.tools.map(tool => tool.function.name);
      assert(names.includes('tab_tool_call') && !names.includes('evaluate'));
      const previous = body.messages.at(-1);
      let message;
      const action = (name, args) => ({ role: 'assistant', content: null, tool_calls: [{ id: 'qa' + turn, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
      if (turn++ === 0) message = action('tab_tools_list', {});
      else if (turn === 2) {
        const discovery = JSON.parse(previous.content);
        assert(discovery.tools.some(tool => tool.name === 'site/find_book'));
        message = action('tab_tool_call', { document_id: discovery.document_id, tool: 'site/find_book', input_json: '{"title":"Voyager"}' });
      } else {
        assert.match(previous.content, /Found Voyager/);
        message = { role: 'assistant', content: 'Found Voyager' };
      }
      return Response.json({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] });
    },
  });
  assert.equal(outcome.status, 'completed', outcome.reason);
  assert.equal(outcome.stdout, 'Found Voyager');
  assert.equal(await context.pages()[0].locator('output').innerText(), 'Voyager');
  console.log('PASS: native registered tool executed in tab, browser ' + context.browser()?.version());
} finally {
  clients.forEach(client => client.close());
  await context?.close();
  await new Promise(resolve => site.close(resolve));
  await rm(qa, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
}
