const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createSwipeForge, resolveBase } = require('./mini-apps/swipeforge.cjs');

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: text => Buffer.from('sealed:' + Buffer.from(text).toString('hex')),
  decryptString: buffer => Buffer.from(buffer.toString().slice(7), 'hex').toString(),
};
const binding = { owner: 'owner-1', generation: 'gen-1' };
const active = () => true;

// A small stand-in for the SwipeForge OAuth + MCP endpoints with rotating refresh tokens.
async function fakeSwipeForge(t, { onCall } = {}) {
  const state = { clients: new Map(), intents: new Map(), authorizeQueries: [], codes: new Map(), access: new Set(), refresh: new Map(), calls: [], refreshes: 0, revoked: [], registered: 0 };
  let next = 0;
  const issue = () => {
    const access = 'access-' + ++next, refresh = 'refresh-' + next;
    state.access.add(access); state.refresh.set(refresh, true);
    return { access_token: access, refresh_token: refresh, expires_in: 1800, token_type: 'Bearer', scope: 'read generation:write' };
  };
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const send = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    const url = new URL(request.url, 'http://x');
    if (url.pathname === '/oauth/mcp/register') {
      const body = JSON.parse(raw);
      state.registered++;
      const id = 'client-' + state.registered;
      state.clients.set(id, body.redirect_uris);
      return send(201, { client_id: id });
    }
    if (url.pathname === '/oauth/mcp/authorize') {
      const q = url.searchParams;
      state.authorizeQueries.push(q);
      if (!state.clients.get(q.get('client_id'))?.includes(q.get('redirect_uri'))) return send(400, { error: 'invalid_request' });
      const id = 'intent-' + state.intents.size;
      state.intents.set(id, { challenge: q.get('code_challenge'), redirect: q.get('redirect_uri'), state: q.get('state') });
      response.writeHead(302, { Location: '/mcp/consent?request=' + id });
      return response.end();
    }
    if (url.pathname === '/oauth/mcp/token') {
      const form = new URLSearchParams(raw);
      if (form.get('grant_type') === 'authorization_code') {
        const code = state.codes.get(form.get('code'));
        const hash = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
        if (!code || code.challenge !== hash || code.redirect !== form.get('redirect_uri')) return send(400, { error: 'invalid_grant' });
        state.codes.delete(form.get('code'));
        return send(200, issue());
      }
      state.refreshes++;
      if (!state.refresh.get(form.get('refresh_token'))) return send(400, { error: 'invalid_grant' });
      state.refresh.set(form.get('refresh_token'), false);
      return send(200, issue());
    }
    if (url.pathname === '/oauth/mcp/revoke') { state.revoked.push(new URLSearchParams(raw).get('token')); return send(200, {}); }
    if (url.pathname === '/mcp') {
      const token = request.headers.authorization?.slice(7);
      if (!state.access.has(token)) return send(401, { error: 'invalid_token' });
      const rpc = JSON.parse(raw);
      state.calls.push(rpc);
      if (rpc.method === 'tools/list') return send(200, { jsonrpc: '2.0', id: rpc.id, result: { tools: [{ name: 'get_workspace', description: 'Read the workspace.', annotations: { readOnlyHint: true } }] } });
      const custom = await onCall?.(rpc.params, state);
      if (custom) return send(200, { jsonrpc: '2.0', id: rpc.id, result: custom });
      return send(200, { jsonrpc: '2.0', id: rpc.id, result: { structuredContent: { status: 200, data: { tool: rpc.params.name, args: rpc.params.arguments } } } });
    }
    send(404, { error: 'not found' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  // The browser: consent is granted by following the authorize URL to the loopback callback.
  const opened = [];
  const browser = async (href, { deny = false, wrongState = false } = {}) => {
    let url = new URL(href);
    // A sign-in through a named connection comes back to the consent page it carries.
    if (url.pathname === '/api/session/login') url = new URL(url.searchParams.get('next'), url.origin);
    assert.equal(url.pathname, '/mcp/consent');
    const intent = state.intents.get(url.searchParams.get('request'));
    const code = 'code-' + Math.random().toString(36).slice(2);
    state.codes.set(code, { challenge: intent.challenge, redirect: intent.redirect });
    const target = new URL(intent.redirect);
    if (deny) target.searchParams.set('error', 'access_denied'); else target.searchParams.set('code', code);
    target.searchParams.set('state', wrongState ? 'forged' : intent.state);
    target.searchParams.set('iss', base);
    return fetch(target);
  };
  return { state, base, opened, browser };
}
const sealed = root => fs.readdirSync(root).filter(name => !name.startsWith('client-'));
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swipeforge-unit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function client(t, fake, options = {}) {
  const root = fixture(t);
  const sf = createSwipeForge({ root, safeStorage, platform: 'darwin', baseUrl: fake.base, openExternal: async url => { fake.opened.push(url); }, ...options });
  t.after(() => sf.close());
  return { sf, root };
}
async function connected(t, fake, options) {
  const made = client(t, fake, options);
  const status = await made.sf.action(binding, { action: 'connect' }, active);
  assert.equal(status.pending, true);
  const reply = await fake.browser(fake.opened.at(-1));
  assert.equal(reply.status, 200);
  assert.match(await reply.text(), /SwipeForge is connected/);
  return made;
}

test('the SwipeForge address must be HTTPS or a loopback development server', () => {
  assert.equal(resolveBase('https://app.swipeforge.io'), 'https://app.swipeforge.io');
  assert.equal(resolveBase('http://127.0.0.1:8381'), 'http://127.0.0.1:8381');
  for (const bad of ['http://app.swipeforge.io', 'https://app.swipeforge.io/studio', 'https://u:p@app.swipeforge.io', 'ftp://x', 'nonsense']) assert.throws(() => resolveBase(bad));
});

test('connecting stores sealed tokens and tool calls reach SwipeForge', async t => {
  const fake = await fakeSwipeForge(t);
  const { sf, root } = await connected(t, fake);
  assert.match(fake.opened[0], /\/mcp\/consent\?request=/);
  const authorize = fake.state.authorizeQueries[0];
  assert.equal(authorize.get('code_challenge_method'), 'S256');
  assert.match(authorize.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  assert.match(authorize.get('scope'), /generation:write/);
  const status = await sf.action(binding, { action: 'status' }, active);
  assert.deepEqual([status.connected, status.pending, status.scopes], [true, false, ['read', 'generation:write']]);
  assert.equal(sealed(root).length, 1);
  const saved = fs.readdirSync(root).map(name => fs.readFileSync(path.join(root, name), 'utf8')).join('');
  assert.doesNotMatch(saved, /access-1|refresh-1/);
  const out = await sf.action(binding, { action: 'call', tool: 'get_content', arguments: { id: 'x' } }, active);
  assert.deepEqual(out, { isError: false, value: { status: 200, data: { tool: 'get_content', args: { id: 'x' } } } });
  assert.deepEqual((await sf.action(binding, { action: 'tools' }, active)).tools, [{ name: 'get_workspace', description: 'Read the workspace.', readOnly: true }]);
  // Another account or installation never sees this connection.
  assert.equal((await sf.action({ owner: 'owner-2', generation: 'gen-1' }, { action: 'status' }, active)).connected, false);
  await assert.rejects(sf.action({ owner: 'owner-1', generation: 'gen-2' }, { action: 'call', tool: 'get_workspace' }, active), /Connect SwipeForge first/);
});

test('a forged or denied callback does not connect', async t => {
  const fake = await fakeSwipeForge(t);
  const { sf } = client(t, fake);
  await sf.action(binding, { action: 'connect' }, active);
  assert.equal((await fake.browser(fake.opened[0], { wrongState: true })).status, 400);
  assert.equal((await sf.action(binding, { action: 'status' }, active)).pending, true);
  await fake.browser(fake.opened[0], { deny: true });
  const status = await sf.action(binding, { action: 'status' }, active);
  assert.deepEqual([status.connected, status.pending], [false, false]);
  assert.match(status.problem, /not granted/);
  // Pressing Connect again while waiting reopens the same sign-in; a new sign-in reuses the registered client.
  await sf.action(binding, { action: 'connect' }, active);
  await sf.action(binding, { action: 'connect' }, active);
  assert.equal(fake.state.registered, 1);
  assert.equal(fake.opened.at(-1), fake.opened.at(-2));
});

test('a client SwipeForge no longer knows is registered again before the browser opens', async t => {
  const fake = await fakeSwipeForge(t);
  const { sf } = client(t, fake);
  await sf.action(binding, { action: 'connect' }, active);
  await sf.action(binding, { action: 'cancel' }, active);
  fake.state.clients.clear();
  await sf.action(binding, { action: 'connect' }, active);
  assert.equal(fake.state.registered, 2);
  assert.equal((await fake.browser(fake.opened.at(-1))).status, 200);
  assert.equal((await sf.action(binding, { action: 'status' }, active)).connected, true);
});

test('concurrent calls after expiry rotate the refresh token once', async t => {
  const fake = await fakeSwipeForge(t);
  let clock = Date.now();
  const { sf } = await connected(t, fake, { now: () => clock });
  clock += 3600_000;
  const results = await Promise.all([1, 2, 3].map(n => sf.action(binding, { action: 'call', tool: 'get_post', arguments: { id: String(n) } }, active)));
  assert.equal(fake.state.refreshes, 1);
  assert.deepEqual(results.map(r => r.value.data.args.id), ['1', '2', '3']);
});

test('a rejected access token is refreshed once and the call repeated', async t => {
  const fake = await fakeSwipeForge(t);
  const { sf } = await connected(t, fake);
  fake.state.access.clear();
  const out = await sf.action(binding, { action: 'call', tool: 'list_content', arguments: {} }, active);
  assert.equal(out.value.data.tool, 'list_content');
  assert.equal(fake.state.refreshes, 1);
});

test('a revoked grant clears the connection with a reconnect message', async t => {
  const fake = await fakeSwipeForge(t);
  const { sf, root } = await connected(t, fake);
  fake.state.access.clear();
  fake.state.refresh.clear();
  await assert.rejects(sf.action(binding, { action: 'call', tool: 'list_content', arguments: {} }, active), /expired or was revoked/);
  const status = await sf.action(binding, { action: 'status' }, active);
  assert.equal(status.connected, false);
  assert.match(status.problem, /Connect again/);
  assert.deepEqual(sealed(root), []);
});

test('tool errors come back as a readable message, not a thrown transport error', async t => {
  const fake = await fakeSwipeForge(t, { onCall: params => params.name === 'start_generation' &&
    { isError: true, structuredContent: { status: 403, data: { error: { code: 'AUTH_FEATURE_NOT_AVAILABLE', message: 'This feature requires an upgrade' } } } } });
  const { sf } = await connected(t, fake);
  const out = await sf.action(binding, { action: 'call', tool: 'start_generation', arguments: {} }, active);
  assert.equal(out.isError, true);
  assert.equal(out.error, 'This feature requires an upgrade');
  await assert.rejects(sf.action(binding, { action: 'call', tool: '../admin', arguments: {} }, active), /Unknown SwipeForge tool/);
});

test('disconnect revokes the grant and removes the sealed tokens', async t => {
  const fake = await fakeSwipeForge(t);
  const { sf, root } = await connected(t, fake);
  await sf.action(binding, { action: 'disconnect' }, active);
  assert.deepEqual(fake.state.revoked, ['refresh-1']);
  assert.deepEqual(sealed(root), []);
  assert.equal((await sf.action(binding, { action: 'status' }, active)).connected, false);
});

test('only SwipeForge pages open in the browser', async t => {
  const fake = await fakeSwipeForge(t);
  const { sf } = client(t, fake);
  await sf.action(binding, { action: 'open', path: '/content/abc' }, active);
  await sf.action(binding, { action: 'open', url: fake.base + '/mcp/approve?id=1' }, active);
  assert.deepEqual(fake.opened, [fake.base + '/content/abc', fake.base + '/mcp/approve?id=1']);
  for (const input of [{ url: 'https://evil.example/' }, { path: '//evil.example' }, { path: 'javascript:alert(1)' }, {}]) {
    await assert.rejects(sf.action(binding, { action: 'open', ...input }, active));
  }
  await assert.rejects(sf.action(binding, { action: 'status' }, () => false), /account changed/);
});

test('secure storage is required before a sign-in starts', async t => {
  const fake = await fakeSwipeForge(t);
  const { sf } = client(t, fake, { safeStorage: { isEncryptionAvailable: () => false } });
  await assert.rejects(sf.action(binding, { action: 'connect' }, active), /Secure storage is unavailable/);
  assert.equal(fake.state.registered, 0);
});

test('production sign-in goes through the Nextbrowser connection, then the same consent page', async t => {
  const fake = await fakeSwipeForge(t);
  const { sf } = client(t, fake, { signInConnection: 'Nextbrowser' });
  await sf.action(binding, { action: 'connect' }, active);
  const opened = new URL(fake.opened[0]);
  assert.equal(opened.pathname, '/api/session/login');
  assert.equal(opened.searchParams.get('connection'), 'Nextbrowser');
  assert.match(opened.searchParams.get('next'), /^\/mcp\/consent\?request=intent-0$/);
  assert.equal((await fake.browser(fake.opened[0])).status, 200);
  assert.equal((await sf.action(binding, { action: 'status' }, active)).connected, true);
  assert.throws(() => createSwipeForge({ root: fixture(t), safeStorage, baseUrl: fake.base, openExternal: async () => {}, signInConnection: 'x&prompt=none' }), /Invalid SwipeForge sign-in connection/);
});
