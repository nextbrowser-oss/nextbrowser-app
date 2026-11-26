const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { secureStorageAvailable } = require('../multilogin-credential.cjs');

// The bundled SwipeForge app talks to the SwipeForge MCP server as a native
// OAuth client (RFC 8252): consent happens in the user's own browser, the
// loopback listener receives the code, and the tokens never leave the main
// process. The package only sees tool results.
const DEFAULT_BASE = 'https://app.swipeforge.io';
const SCOPES = ['read', 'content:write', 'generation:write', 'publishing:write', 'accounts:write', 'tracking:write', 'notifications:write', 'settings:write'];
const CONNECT_MS = 10 * 60_000;
const GRANT_MS = 30 * 24 * 3600_000;
const CALL_MS = 25_000;
const THUMB_BYTES = 400 * 1024;

function resolveBase(raw) {
  let url;
  try { url = new URL(raw); } catch { throw Error('Invalid SwipeForge address.'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) throw Error('Invalid SwipeForge address.');
  return url.origin;
}
const b64url = buffer => Buffer.from(buffer).toString('base64url');
const page = (title, text) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>` +
  `<body style="font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#101114;color:#f4f4f6">` +
  `<main style="max-width:420px;padding:24px;text-align:center"><h1 style="font-size:22px">${title}</h1><p>${text}</p></main></body></html>`;

function readRpc(text, type) {
  if (/text\/event-stream/.test(type ?? '')) {
    const data = text.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).filter(Boolean);
    return JSON.parse(data.at(-1) ?? 'null');
  }
  return JSON.parse(text);
}
function resultValue(result) {
  if (result?.structuredContent !== undefined) return result.structuredContent;
  const text = result?.content?.find?.(item => item?.type === 'text')?.text;
  if (typeof text !== 'string') return null;
  try { return JSON.parse(text); } catch { return text; }
}
// Turns a SwipeForge error envelope into the one line a person can act on.
function errorText(value, fallback) {
  const error = value?.data?.error ?? value?.error;
  const message = typeof error === 'string' ? error : error?.message;
  const fields = Array.isArray(error?.fields) ? error.fields.map(f => f?.message).filter(Boolean).join(' ') : '';
  const text = [message, fields].filter(Boolean).join(' ') || (typeof value === 'string' ? value : '') || fallback;
  return String(text).slice(0, 600);
}

function createSwipeForge({ root, safeStorage, openExternal, fetch: fetchImpl = globalThis.fetch, baseUrl = process.env.NEXTBROWSER_SWIPEFORGE_URL || DEFAULT_BASE,
  platform = process.platform, now = Date.now, clientName = 'Nextbrowser', signInConnection = process.env.NEXTBROWSER_SWIPEFORGE_CONNECTION }) {
  const base = resolveBase(baseUrl);
  // Production SwipeForge signs people in through their Nextbrowser account
  // (the Auth0 "Nextbrowser" connection). A loopback development stack has
  // no such connection and keeps its own sign-in.
  const connection = signInConnection ?? (base.startsWith('https:') ? 'Nextbrowser' : '');
  if (connection && !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(connection)) throw Error('Invalid SwipeForge sign-in connection.');
  const pending = new Map();
  const cache = new Map();
  const problems = new Map();
  const locks = new Map();
  const toolLists = new Map();
  const thumbs = new Map();
  const keyOf = ({ owner, generation }) => {
    if (typeof owner !== 'string' || !owner || typeof generation !== 'string' || !generation) throw Error('SwipeForge is unavailable for this account.');
    return createHash('sha256').update(JSON.stringify([base, owner, generation])).digest('hex');
  };
  const file = key => path.join(root, key + '.json');
  function serialize(key, run) {
    const next = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
    locks.set(key, next);
    return next.finally(() => { if (locks.get(key) === next) locks.delete(key); });
  }
  async function requireSecure() {
    if (!await secureStorageAvailable(safeStorage, platform)) throw Error('Secure storage is unavailable on this computer, so Nextbrowser cannot keep a SwipeForge connection.');
  }
  async function encrypt(value) {
    const text = JSON.stringify(value);
    const data = typeof safeStorage.encryptStringAsync === 'function' ? await safeStorage.encryptStringAsync(text) : safeStorage.encryptString(text);
    return Buffer.from(data).toString('base64');
  }
  async function decrypt(value) {
    const buffer = Buffer.from(value, 'base64');
    if (typeof safeStorage.decryptStringAsync === 'function') {
      const out = await safeStorage.decryptStringAsync(buffer);
      if (out?.isTemporarilyUnavailable) throw Error('Secure storage is locked. Unlock it and try again.');
      return JSON.parse(out?.result ?? out);
    }
    return JSON.parse(safeStorage.decryptString(buffer));
  }
  async function load(key) {
    if (cache.has(key)) return cache.get(key);
    let record;
    try { record = JSON.parse(await fs.readFile(file(key), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
    if (record?.version !== 1 || record.baseUrl !== base || typeof record.secret !== 'string') return null;
    await requireSecure();
    const entry = { record, tokens: await decrypt(record.secret) };
    cache.set(key, entry);
    return entry;
  }
  async function store(key, record, tokens) {
    const saved = { ...record, version: 1, baseUrl: base, secret: await encrypt(tokens) };
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const temporary = file(key) + '.' + process.pid + '.' + b64url(randomBytes(6)) + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(saved), { mode: 0o600 });
    try { await fs.rename(temporary, file(key)); } finally { await fs.rm(temporary, { force: true }); }
    cache.set(key, { record: saved, tokens });
  }
  async function forget(key, problem) {
    cache.delete(key);
    toolLists.delete(key);
    await fs.rm(file(key), { force: true });
    if (problem) problems.set(key, problem); else problems.delete(key);
  }
  async function post(url, body, form, signal = AbortSignal.timeout(CALL_MS)) {
    const response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json', Accept: 'application/json' },
      body: form ? new URLSearchParams(body).toString() : JSON.stringify(body) });
    let value = null;
    try { value = await response.json(); } catch { /* Error pages are not JSON. */ }
    return { status: response.status, value };
  }
  function tokensFrom(value) {
    if (typeof value?.access_token !== 'string' || typeof value?.refresh_token !== 'string') throw Error('SwipeForge returned an incomplete sign-in. Connect again.');
    const seconds = Number.isFinite(value.expires_in) ? value.expires_in : 1800;
    return { access: value.access_token, refresh: value.refresh_token, expiresAt: now() + seconds * 1000 };
  }
  function cancel(key, problem) {
    const flow = pending.get(key);
    if (!flow) return;
    pending.delete(key);
    clearTimeout(flow.timer);
    flow.server.close();
    flow.server.closeAllConnections?.();
    if (problem) problems.set(key, problem);
  }
  async function callback(key, flow, request, response) {
    const url = new URL(request.url, flow.redirectUri);
    const reply = (status, title, text) => { response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(page(title, text)); };
    if (request.method !== 'GET' || url.pathname !== '/callback') return reply(404, 'Not found', 'This address only finishes a SwipeForge sign-in.');
    if (pending.get(key) !== flow || url.searchParams.get('state') !== flow.state) return reply(400, 'Sign-in expired', 'Start the connection again from Nextbrowser.');
    const issuer = url.searchParams.get('iss');
    if (issuer && issuer !== base) return reply(400, 'Sign-in rejected', 'The response did not come from SwipeForge. Start the connection again from Nextbrowser.');
    pending.delete(key);
    clearTimeout(flow.timer);
    if (url.searchParams.get('error') || !url.searchParams.get('code')) {
      problems.set(key, 'SwipeForge access was not granted. Connect again when you are ready.');
      reply(200, 'Not connected', 'Nextbrowser did not get access to SwipeForge. You can close this tab.');
      return flow.server.close();
    }
    try {
      const { status, value } = await post(base + '/oauth/mcp/token', { grant_type: 'authorization_code', client_id: flow.clientId, redirect_uri: flow.redirectUri,
        code: url.searchParams.get('code'), code_verifier: flow.verifier, resource: base + '/mcp' }, true);
      if (status !== 200) throw Error(errorText(value, 'SwipeForge refused the sign-in.') + ' Connect again.');
      const tokens = tokensFrom(value);
      const scopes = typeof value.scope === 'string' ? value.scope.split(' ').filter(Boolean) : [];
      await serialize(key, () => store(key, { clientId: flow.clientId, scopes, connectedAt: new Date(now()).toISOString() }, tokens));
      problems.delete(key);
      reply(200, 'SwipeForge is connected', 'You can close this tab and return to Nextbrowser.');
    } catch (error) {
      problems.set(key, error.message);
      reply(500, 'Not connected', 'Nextbrowser could not finish the sign-in. Return to Nextbrowser and connect again.');
    } finally {
      flow.server.close();
    }
  }
  // One registered client per SwipeForge address and device: its redirect URI
  // names a loopback port, and SwipeForge limits registrations per hour.
  const clientFile = path.join(root, 'client-' + createHash('sha256').update(base).digest('hex').slice(0, 16) + '.json');
  async function savedClient() {
    try {
      const saved = JSON.parse(await fs.readFile(clientFile, 'utf8'));
      return typeof saved?.clientId === 'string' && Number.isSafeInteger(saved.port) && saved.port > 1023 && saved.port < 65536 ? saved : null;
    } catch { return null; }
  }
  async function listen(port) {
    const server = http.createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    return server;
  }
  async function register(port) {
    const { status, value } = await post(base + '/oauth/mcp/register', { client_name: clientName, redirect_uris: [`http://127.0.0.1:${port}/callback`],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' });
    if (status === 429) throw Error('SwipeForge is limiting new connections from this network. Try again in an hour.');
    if (status !== 201 || typeof value?.client_id !== 'string') throw Error(errorText(value, 'SwipeForge did not accept Nextbrowser as a client.'));
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    await fs.writeFile(clientFile, JSON.stringify({ clientId: value.client_id, port }), { mode: 0o600 });
    return value.client_id;
  }
  // The authorization request is sent from here, so an unknown client is
  // replaced before the browser opens; the browser gets the consent page.
  async function authorize(clientId, redirectUri, challenge, state) {
    const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', code_challenge_method: 'S256',
      code_challenge: challenge, scope: SCOPES.join(' '), state, resource: base + '/mcp' });
    const response = await fetchImpl(base + '/oauth/mcp/authorize?' + query, { redirect: 'manual', signal: AbortSignal.timeout(CALL_MS) });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      const consent = new URL(location, base);
      if (consent.origin !== base) throw Error('SwipeForge sent the sign-in to an unexpected address.');
      if (!connection) return consent.href;
      // Sign in through Nextbrowser first, then land on the same consent page.
      return base + '/api/session/login?' + new URLSearchParams({ connection, next: consent.pathname + consent.search });
    }
    if (response.status === 429) throw Error('Too many SwipeForge sign-in attempts. Wait a minute and try again.');
    return null;
  }
  async function connect(key) {
    const open = pending.get(key);
    if (open) { await openExternal(open.url); return; }
    await requireSecure();
    let saved = await savedClient();
    let server = saved && await listen(saved.port).catch(() => null);
    if (!server) { saved = null; server = await listen(0); }
    try {
      const port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      const verifier = b64url(randomBytes(32));
      const challenge = b64url(createHash('sha256').update(verifier).digest());
      const state = b64url(randomBytes(24));
      let clientId = saved?.clientId ?? await register(port);
      let url = await authorize(clientId, redirectUri, challenge, state);
      if (!url && saved) url = await authorize(clientId = await register(port), redirectUri, challenge, state);
      if (!url) throw Error('SwipeForge did not start the sign-in. Try again.');
      const flow = { server, state, verifier, redirectUri, clientId, url, startedAt: now() };
      flow.timer = setTimeout(() => cancel(key, 'The SwipeForge sign-in timed out. Connect again.'), CONNECT_MS);
      flow.timer.unref?.();
      server.on('request', (request, response) => { void callback(key, flow, request, response); });
      pending.set(key, flow);
      problems.delete(key);
      await openExternal(flow.url);
    } catch (error) {
      if (![...pending.values()].some(flow => flow.server === server)) server.close();
      throw error;
    }
  }
  async function refresh(key, stale) {
    return serialize(key, async () => {
      const entry = await load(key);
      if (!entry) throw Error('Connect SwipeForge first.');
      // Another call already rotated the token while this one waited.
      if (entry.tokens.access !== stale && entry.tokens.expiresAt - 60_000 > now()) return entry.tokens.access;
      const { status, value } = await post(base + '/oauth/mcp/token', { grant_type: 'refresh_token', client_id: entry.record.clientId,
        refresh_token: entry.tokens.refresh, resource: base + '/mcp' }, true);
      if (status === 400 || status === 401) {
        await forget(key, 'The SwipeForge connection expired or was revoked. Connect again.');
        throw Error('The SwipeForge connection expired or was revoked. Connect again.');
      }
      if (status !== 200) throw Error('SwipeForge is temporarily unavailable. Try again shortly.');
      const tokens = tokensFrom(value);
      await store(key, entry.record, tokens);
      return tokens.access;
    });
  }
  async function token(key) {
    const entry = await load(key);
    if (!entry) throw Error(problems.get(key) ?? 'Connect SwipeForge first.');
    return entry.tokens.expiresAt - 60_000 > now() ? entry.tokens.access : refresh(key, entry.tokens.access);
  }
  async function rpc(key, method, params) {
    const send = async access => {
      const response = await fetchImpl(base + '/mcp', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(CALL_MS),
        headers: { Authorization: 'Bearer ' + access, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: b64url(randomBytes(9)), method, params }) });
      return { response, text: await response.text() };
    };
    let access = await token(key);
    let { response, text } = await send(access);
    // A rejected token means the request was not executed, so one retry is safe.
    if (response.status === 401) ({ response, text } = await send(await refresh(key, access)));
    if (response.status === 401) {
      await forget(key, 'The SwipeForge connection expired or was revoked. Connect again.');
      throw Error('The SwipeForge connection expired or was revoked. Connect again.');
    }
    if (response.status === 429) throw Error('SwipeForge is rate limiting requests. Wait a minute and try again.');
    if (!response.ok) throw Error(`SwipeForge did not complete the request (HTTP ${response.status}). Check the result before trying again.`);
    let body;
    try { body = readRpc(text, response.headers.get('content-type')); } catch { throw Error('SwipeForge returned an unreadable answer. Check the result before trying again.'); }
    if (body?.error) throw Error(String(body.error.message || 'SwipeForge rejected the request.').slice(0, 600));
    return body?.result;
  }
  async function callTool(key, name, args) {
    if (typeof name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(name)) throw Error('Unknown SwipeForge tool.');
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('SwipeForge tool arguments must be an object.');
    const result = await rpc(key, 'tools/call', { name, arguments: args });
    const value = resultValue(result);
    return result?.isError ? { isError: true, error: errorText(value, 'SwipeForge rejected the request.'), value } : { isError: false, value };
  }
  async function tools(key) {
    const saved = toolLists.get(key);
    if (saved && saved.at > now() - 10 * 60_000) return saved.list;
    const result = await rpc(key, 'tools/list', {});
    const list = (result?.tools ?? []).filter(tool => typeof tool?.name === 'string')
      .map(tool => ({ name: tool.name, description: String(tool.description ?? '').slice(0, 400), readOnly: tool.annotations?.readOnlyHint === true }));
    toolLists.set(key, { at: now(), list });
    return list;
  }
  async function thumbnail(key, contentId) {
    if (typeof contentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(contentId)) throw Error('Invalid creation ID.');
    const media = await callTool(key, 'list_media', { query: { contentId, limit: '5' } });
    const items = media.value?.data?.items ?? [];
    const asset = items.find(item => item?.contentId === contentId && typeof item.thumbnailUrl === 'string') ??
      items.find(item => item?.contentId === contentId && item.format && /^(jpe?g|png|webp)$/i.test(item.format) && typeof (item.processedUrl ?? item.originalUrl) === 'string');
    if (!asset) return { image: null };
    if (thumbs.has(asset.id)) return { image: thumbs.get(asset.id) };
    const source = new URL(asset.thumbnailUrl ?? asset.processedUrl ?? asset.originalUrl);
    if (!['https:', 'http:'].includes(source.protocol) || (source.protocol === 'http:' && new URL(base).protocol !== 'http:')) return { image: null };
    const response = await fetchImpl(source, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
    const type = response.headers.get('content-type')?.split(';')[0].trim();
    if (!response.ok || !/^image\/(jpeg|png|webp)$/.test(type ?? '')) return { image: null };
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > THUMB_BYTES) return { image: null };
    const image = `data:${type};base64,${bytes.toString('base64')}`;
    thumbs.set(asset.id, image);
    if (thumbs.size > 60) thumbs.delete(thumbs.keys().next().value);
    return { image };
  }
  function target(input) {
    if (typeof input.url === 'string') {
      let url;
      try { url = new URL(input.url); } catch { throw Error('Invalid SwipeForge address.'); }
      if (url.origin !== base) throw Error('Only SwipeForge pages can be opened.');
      return url.href;
    }
    if (typeof input.path === 'string' && /^\/[A-Za-z0-9/_\-.?=&%]{0,300}$/.test(input.path) && !input.path.startsWith('//')) return base + input.path;
    throw Error('Choose a SwipeForge page to open.');
  }
  async function status(key) {
    const entry = await load(key).catch(error => { problems.set(key, error.message); return null; });
    const flow = pending.get(key);
    const connectedAt = entry?.record.connectedAt;
    return { connected: !!entry, pending: !!flow, studioUrl: base, scopes: entry?.record.scopes ?? [], connectedAt: connectedAt ?? null,
      expiresAt: connectedAt ? new Date(Date.parse(connectedAt) + GRANT_MS).toISOString() : null,
      waitingSince: flow ? new Date(flow.startedAt).toISOString() : null, problem: entry ? null : problems.get(key) ?? null };
  }
  async function disconnect(key) {
    cancel(key);
    await serialize(key, async () => {
      const entry = await load(key).catch(() => null);
      if (entry) {
        // Revoking the refresh token ends the whole grant on SwipeForge.
        await post(base + '/oauth/mcp/revoke', { token: entry.tokens.refresh, client_id: entry.record.clientId }, true, AbortSignal.timeout(10_000)).catch(() => {});
      }
      await forget(key);
    });
  }
  async function action(binding, input, active) {
    if (!input || typeof input.action !== 'string') throw Error('Expected a SwipeForge action.');
    if (!active()) throw Error('The active account changed.');
    const key = keyOf(binding);
    switch (input.action) {
      case 'status': return status(key);
      case 'connect': await connect(key); return status(key);
      case 'cancel': cancel(key); return status(key);
      case 'disconnect': await disconnect(key); return status(key);
      case 'tools': return { tools: await tools(key) };
      case 'call': return callTool(key, input.tool, input.arguments ?? {});
      case 'thumbnail': return thumbnail(key, input.contentId);
      case 'open': await openExternal(target(input)); return { opened: true };
      default: throw Error('Unknown SwipeForge action.');
    }
  }
  return {
    action,
    base,
    clear: binding => disconnect(keyOf(binding)),
    close() { for (const key of pending.keys()) cancel(key); },
  };
}
module.exports = { createSwipeForge, resolveBase, SCOPES, DEFAULT_BASE };
