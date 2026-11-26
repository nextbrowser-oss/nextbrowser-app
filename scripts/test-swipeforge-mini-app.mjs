// End-to-end check of the bundled SwipeForge mini app against an offline
// SwipeForge stack (alter-ego-backend scripts/mcp-local.sh: mock sign-in,
// fixture models, a fixture account that can never publish). Consent and
// approvals, the human steps, are given through that stack's own browser API.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { _electron } from 'playwright-core';

const studio = process.env.SWIPEFORGE_TEST_URL || 'http://127.0.0.1:8381';
const backend = process.env.SWIPEFORGE_TEST_API || 'http://127.0.0.1:8380';
const user = { authorization: 'Bearer mock-owner@alterego.local' };
const runtime = await fetch(backend + '/api/runtime', { headers: user }).then(r => r.json());
assert.ok(runtime.authMode === 'mock' && runtime.aiProvider === 'fixture', 'Run this only against the offline SwipeForge fixture stack.');

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const manifest = JSON.parse(await readFile(path.join(root, 'electron/mini-apps/catalog/swipeforge/manifest.json'), 'utf8'));
const profile = await mkdtemp(path.join(tmpdir(), 'nb-swipeforge-qa-'));
const env = { ...process.env, NEXTBROWSER_DEV_DATA_ROOT: profile, NEXTBROWSER_SWIPEFORGE_URL: studio, NBC_AUTO_UPDATE: '0', NEXTBROWSER_ERROR_REPORTING: '0', NEXTBROWSER_DEVICE_REPORTING: '0' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ args: [root, '--user-data-dir=' + path.join(profile, 'app')], executablePath: createRequire(import.meta.url)('electron'), env });
const page = await app.firstWindow();

async function until(check, ms = 20000, what = 'the SwipeForge guest') {
  const deadline = Date.now() + ms;
  let last;
  do {
    try { const value = await check(); if (value) return value; } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 150));
  } while (Date.now() < deadline);
  throw Error('Timed out waiting for ' + what + (last ? ': ' + last.message : ''));
}
const guest = fn => page.locator('webview.mini-apps-guest').evaluate((view, script) => view.executeJavaScript(script), '(' + fn.toString() + ')()');
// Runs a registered tool exactly like the desktop MCP host does.
async function tool(name, input = {}) {
  const script = `(async () => { const api = document.modelContext ?? navigator.modelContext; const t = (await api.getTools()).find(t => t.name === ${JSON.stringify(name)});
    const major = Number(navigator.userAgent.match(/Chrome\\/(\\d+)/)[1]); const out = await api.executeTool(t, major < 155 ? ${JSON.stringify(JSON.stringify(input))} : ${JSON.stringify(input)});
    return typeof out === 'string' ? JSON.parse(out) : out; })()`;
  return page.locator('webview.mini-apps-guest').evaluate((view, code) => view.executeJavaScript(code), script);
}
const ok = async (name, input) => { const out = await tool(name, input); assert.equal(out.ok, true, name + ': ' + out.error); return out.value; };
// The person in the browser: grant consent or approve an action through the stack's session API.
async function consent(consentUrl) {
  const request = new URL(consentUrl).searchParams.get('request');
  const info = await fetch(backend + '/api/mcp/consent/' + request, { headers: user }).then(r => r.json());
  assert.equal(info.client, 'Nextbrowser');
  const granted = await fetch(backend + '/api/mcp/consent/' + request, { method: 'POST', headers: { ...user, 'content-type': 'application/json' },
    body: JSON.stringify({ allow: true, budgetUsd: 2, scopes: info.scopes }) }).then(r => r.json());
  const page = await fetch(granted.redirectUrl).then(r => r.text());
  assert.match(page, /SwipeForge is connected/);
}
const approve = actionId => fetch(backend + '/api/mcp/actions/' + actionId, { method: 'POST', headers: { ...user, 'content-type': 'application/json' }, body: '{"approve":true}' }).then(r => r.json());
const opened = () => app.evaluate(() => globalThis.__opened.splice(0));
const nextOpened = () => until(async () => { const urls = await opened(); return urls.length && urls; }, 10000, 'the browser page');
const tokenDir = () => path.join(profile, 'app', 'mini-apps-v1', 'swipeforge');
const sealedFiles = async () => (await readdir(tokenDir())).filter(name => !name.startsWith('client-'));

try {
  await app.evaluate(({ shell }) => { globalThis.__opened = []; shell.openExternal = async url => { globalThis.__opened.push(url); }; });
  const url = new URL('dist/index.html', new URL('../', import.meta.url));
  url.searchParams.set('preview', 'main');
  await page.goto(url.href);
  await page.getByRole('button', { name: 'Open Extensions', exact: true }).click();
  await page.getByRole('dialog', { name: 'Extensions' }).getByRole('button', { name: 'Open Mini Apps', exact: true }).click();
  const card = page.locator('.mini-apps-catalog article').filter({ has: page.getByRole('heading', { name: 'SwipeForge', exact: true }) });
  await card.getByRole('button', { name: 'Install', exact: true }).click();
  await page.getByRole('button', { name: 'Install mini app', exact: true }).click();
  await until(() => guest(() => document.body.dataset.view === 'app' && !document.getElementById('connect-card').hidden));
  const registered = await guest(async () => (await (document.modelContext ?? navigator.modelContext).getTools()).map(t => t.name).sort());
  assert.deepEqual(registered, [...manifest.tools].sort());
  assert.equal(await guest(() => typeof window.nextbrowser), 'undefined');
  console.log('Installed; all', registered.length, 'declared WebMCP tools are registered in the full app.');

  // Invalid arguments never reach SwipeForge.
  assert.match((await tool('generate', { type: 'video' })).error, /required/);
  assert.match((await tool('get_creation', { id: '../x' })).error, /invalid format/);
  assert.match((await tool('list_models', { surprise: true })).error, /Unknown argument/);
  assert.equal((await ok('get_connection')).connected, false);

  // Connect from the UI: the browser opens the SwipeForge consent, the user approves.
  await guest(() => document.getElementById('connect').click());
  const [authorize] = await nextOpened();
  assert.match(authorize, /\/mcp\/consent\?request=/);
  assert.equal((await ok('get_connection')).pending, true);
  await consent(authorize);
  await until(() => guest(() => !document.getElementById('workspace').hidden && document.getElementById('identity').textContent.includes('owner@alterego.local')), 8000, 'the connected workspace');
  const connection = await ok('get_connection');
  assert.equal(connection.connected, true);
  assert.equal(connection.budget.total_usd, 2);
  const tokens = await sealedFiles();
  assert.equal(tokens.length, 1);
  assert.doesNotMatch(await readFile(path.join(tokenDir(), tokens[0]), 'utf8'), /"access"|refresh_token/);
  console.log('Connected through the browser consent; tokens are sealed in the main process.');

  // Agent path: model, estimate, generate, poll.
  const { models } = await ok('list_models', { type: 'video' });
  const fixture = models.find(m => m.provider_id === 'fixture');
  assert.ok(fixture, 'fixture video model');
  const request = { type: 'video', prompt: 'A paper boat drifting down a rainy neon street', provider_id: 'fixture', model: 'fixture', duration_seconds: 5, resolution: '720p', aspect_ratio: '9:16' };
  const estimate = await ok('estimate_generation', request);
  assert.equal(estimate.price_known, true);
  const requestId = 'agent-video-' + Date.now();
  const started = await ok('generate', { ...request, max_estimated_usd: 0.5, request_id: requestId });
  assert.equal(started.executed, true);
  const retried = await ok('generate', { ...request, max_estimated_usd: 0.5, request_id: requestId });
  assert.equal(retried.content_id, started.content_id, 'a retried request_id must not start a second generation');
  const done = await until(async () => { const c = await ok('get_creation', { id: started.content_id }); return c.status === 'success' && c; }, 60000, 'the fixture video');
  assert.ok(done.media.length >= 1);
  await until(() => guest(() => [...document.querySelectorAll(':is(#recent, #items) .item')].some(li => li.textContent.includes('A paper boat') && li.textContent.includes('Ready') && li.querySelector('.thumb img'))));
  console.log('Agent generated a video; the app shows it as Ready with its thumbnail.');

  // UI path: the same operation from the form.
  const uiPrompt = 'Morning coffee steam ' + Date.now();
  await page.locator('webview.mini-apps-guest').evaluate((view, text) => view.executeJavaScript(`(() => {
    const prompt = document.getElementById('prompt');
    prompt.value = ${JSON.stringify(text)};
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
  })()`), uiPrompt);
  await until(() => guest(() => /no charge|About \$/.test(document.getElementById('estimate').textContent)), 15000, 'the estimate');
  await guest(() => document.getElementById('create').requestSubmit());
  const fromUi = await until(async () => (await ok('list_creations', { search: uiPrompt })).items[0], 15000, 'the UI generation');
  await until(async () => (await ok('get_creation', { id: fromUi.id })).status === 'success', 60000, 'the UI video');
  console.log('A generation started from the UI is visible to the agent.');

  // Publishing: prepare, human approval in the browser, commit.
  const { accounts } = await ok('list_accounts');
  const account = accounts.find(a => a.platform === 'x');
  assert.ok(account, 'seeded fixture X account');
  const prepared = await ok('prepare_post', { content_id: started.content_id, account_id: account.id, mode: 'publish', platform_settings: { kind: 'video' } });
  assert.ok(prepared.action_id);
  assert.deepEqual(await nextOpened(), [prepared.approval_url]);
  assert.equal((await ok('get_post_approval', { action_id: prepared.action_id })).status, 'awaiting_approval');
  await approve(prepared.action_id);
  assert.equal((await ok('get_post_approval', { action_id: prepared.action_id })).status, 'approved');
  const post = await ok('publish_approved', { action_id: prepared.action_id });
  assert.ok(post.post_id);
  const posts = await ok('list_posts', {});
  assert.ok(posts.items.some(p => p.id === post.post_id));
  console.log('Post prepared, approved in the browser and committed (the fixture account never publishes).');

  // Everything else through the generic bridge; changes need confirmation.
  const catalog = await ok('list_swipeforge_tools', { search: 'folder' });
  assert.ok(catalog.tools.some(t => t.name === 'create_folder'));
  assert.ok(await ok('call_swipeforge_tool', { tool: 'get_dashboard_summary' }));
  assert.match((await tool('call_swipeforge_tool', { tool: 'create_folder', arguments: { body: { name: 'From Nextbrowser' } } })).error, /confirm=true/);
  await ok('call_swipeforge_tool', { tool: 'create_folder', arguments: { body: { name: 'From Nextbrowser ' + Date.now() }, idempotencyKey: 'nb-folder-' + Date.now() }, confirm: true });
  assert.match((await tool('delete_creation', { id: fromUi.id })).error, /required|confirm/);
  await ok('delete_creation', { id: fromUi.id, confirm: true });
  await until(async () => !(await ok('list_creations', { search: uiPrompt })).items.length, 10000, 'the deletion');
  console.log('Generic SwipeForge tools work; destructive calls require confirm=true.');

  await page.screenshot({ path: path.join(profile, 'swipeforge-app.png') });
  console.log('Screenshot:', path.join(profile, 'swipeforge-app.png'));

  // Disconnect revokes the grant; removing the app clears its sealed tokens.
  await ok('disconnect', { confirm: true });
  assert.equal((await ok('get_connection')).connected, false);
  await page.evaluate(() => window.nextbrowser.invoke('mini_apps_remove', { owner: 'preview', id: 'swipeforge' }));
  assert.deepEqual(await sealedFiles(), []);
  console.log('Disconnected and removed.');
} finally {
  await app.close();
}
