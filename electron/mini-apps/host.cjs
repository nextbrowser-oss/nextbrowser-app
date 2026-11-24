const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const { entry, preferences, bounded, discover, invokeTool } = require('./webmcp.cjs');
const { createStore, parsePackage, metadata, STATE_BYTES } = require('./store.cjs');

// This origin is served entirely by the guest's in-memory Electron session.
const origin = 'https://mini-app.invalid';
const stateURL = origin + '/state';
const catalogPath = path.join(__dirname, 'catalog', 'kanban.nbmini.json');
const csp = "sandbox allow-scripts allow-same-origin allow-forms; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
function pageOf(items, requestedOffset) {
  const offset = requestedOffset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw Error('Invalid discovery offset.');
  let size = 0;
  const page = [];
  for (const item of items.slice(offset)) {
    const length = JSON.stringify(item).length;
    if (page.length && size + length > 5500) break;
    page.push(item);
    size += length;
  }
  const next = offset + page.length;
  return { page, next_offset: next < items.length ? next : undefined };
}
async function readStateRequest(request) {
  const reader = request.body?.getReader();
  if (!reader) throw Error('Missing body.');
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > STATE_BYTES + 128) { await reader.cancel(); throw Error('State too large.'); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function createHost({ root, session, dialog, WebContentsView, libraryChanged }) {
  const catalog = () => fs.readFileSync(catalogPath, 'utf8');
  const store = createStore(root, () => parsePackage(catalog()));
  const bindings = new Map();
  const scopes = new Map();
  const sessionBindings = new WeakMap();
  const guestSessions = new WeakSet();
  function prepare(window, owner, id) {
    const { generation } = store.read(owner, id);
    const shellId = window.webContents.id;
    for (const [partition, b] of bindings) {
      if (b.shellId === shellId && b.owner === owner && b.id === id && b.generation === generation) return { partition, src: entry };
    }
    const partition = 'mini-app-' + randomUUID();
    createPartition(partition, { shellId, owner, id, generation }, () => store.read(owner, id),
      (revision, value) => store.save(owner, id, generation, revision, value));
    return { partition, src: entry };
  }
  function createPartition(partition, binding, read, save) {
    const isolated = session.fromPartition(partition, { cache: false });
    guestSessions.add(isolated);
    bindings.set(partition, binding);
    sessionBindings.set(isolated, binding);
    isolated.setPermissionRequestHandler((_contents, _permission, respond) => respond(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.setDevicePermissionHandler(() => false);
    isolated.on('will-download', event => event.preventDefault());
    isolated.webRequest.onBeforeRequest((details, done) => {
      done({ cancel: !bindings.has(partition) || (details.url !== entry && details.url !== stateURL) });
    });
    isolated.protocol.handle('https', async request => {
      if (!bindings.has(partition)) return json(null, 410);
      try {
        const record = read();
        if (record.generation !== binding.generation) return json(null, 410);
        if (request.url === entry && request.method === 'GET') {
          return new Response(record.pkg.html, { headers: { 'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer', 'X-DNS-Prefetch-Control': 'off' } });
        }
        if (request.url !== stateURL || !record.pkg.permissions.includes('storage')) return json(null, 403);
        if (request.method === 'GET') return json({ revision: record.revision, value: record.value });
        if (request.method !== 'PUT') return json(null, 405);
        const { revision, value } = await readStateRequest(request);
        if (!Number.isSafeInteger(revision) || revision < 0 || value === undefined) return json(null, 400);
        if (!bindings.has(partition)) return json(null, 410);
        return save(revision, value) ? json({ revision: revision + 1 }) : json(null, 409);
      } catch { return json(null, 400); }
    });
    return isolated;
  }
  function guardGuest(guest) {
    guest.setWindowOpenHandler(() => ({ action: 'deny' }));
    guest.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    guest.on('will-frame-navigate', event => { if (!event.isMainFrame || event.url !== entry) event.preventDefault(); });
    guest.on('will-attach-webview', event => event.preventDefault());
  }
  async function validateInstallation(pkg) {
    const partition = 'mini-app-check-' + randomUUID();
    const mock = { pkg, revision: 0, value: null };
    const isolated = createPartition(partition, {}, () => mock, (revision, value) => {
      if (revision !== mock.revision) return false;
      mock.revision++; mock.value = value;
      return true;
    });
    const view = new WebContentsView({ webPreferences: { ...preferences, session: isolated } });
    const guest = view.webContents;
    try {
      guardGuest(guest);
      await bounded(guest.loadURL(entry), 8000);
      await discover(guest, pkg.tools, () => !guest.isDestroyed());
    } finally {
      bindings.delete(partition);
      if (!guest.isDestroyed()) guest.close();
      isolated.protocol.unhandle('https');
      await isolated.clearStorageData();
    }
  }
  function guardWindow(window) {
    const contents = window.webContents;
    const shellId = contents.id;
    const revoke = () => {
      scopes.delete(shellId);
      for (const [key, item] of bindings) if (item.shellId === shellId) bindings.delete(key);
    };
    contents.once('destroyed', revoke);
    contents.on('did-navigate', revoke);
    contents.on('render-process-gone', revoke);
    contents.on('will-attach-webview', (event, prefs, params) => {
      if (!params.partition?.startsWith('mini-app-') && !params.src?.startsWith(origin)) return;
      if (bindings.get(params.partition)?.shellId !== shellId || params.src !== entry) { event.preventDefault(); return; }
      delete prefs.preload;
      Object.assign(prefs, preferences);
    });
    contents.on('did-attach-webview', (_event, guest) => {
      if (!guestSessions.has(guest.session)) return;
      guardGuest(guest);
      const binding = sessionBindings.get(guest.session);
      binding.guest = guest;
      binding.instance = randomUUID();
      guest.on('did-navigate', () => { binding.instance = randomUUID(); });
      guest.once('destroyed', () => { if (binding.guest === guest) binding.guest = undefined; });
    });
  }
  function setScope(window, owner, workspaceId) {
    const shellId = window.webContents.id;
    const previous = scopes.get(shellId);
    if (previous?.owner === owner && previous?.workspaceId === workspaceId) return;
    scopes.delete(shellId);
    if (previous?.owner !== owner) {
      for (const [key, item] of bindings) if (item.shellId === shellId && item.owner !== owner) bindings.delete(key);
    }
    if (typeof owner === 'string' && owner && typeof workspaceId === 'string' && workspaceId) {
      scopes.set(shellId, { owner, workspaceId, window, shellId });
    }
  }
  function agentScope(sender, workspaceId) {
    const scope = scopes.get(sender?.id);
    return scope && scope.workspaceId === workspaceId ? scope : undefined;
  }
  async function agentTool(scope, name, args, authorized) {
    const alive = () => authorized() && scopes.get(scope.shellId) === scope;
    if (!alive()) throw Error('The account or workspace changed. Start a new agent turn.');
    const installed = store.list(scope.owner).filter(app => app.apiVersion === 2);
    if (name === 'list_apps') {
      const entries = installed.map(({ id, name, description, version }) => ({ id, name, description, version }));
      const { page: apps, next_offset } = pageOf(entries, args.offset);
      return { apps, next_offset };
    }
    const app = installed.find(a => a.id === args.app_id);
    if (!app) throw Error('This mini app is not installed for the current account.');
    const live = () => [...bindings.values()].find(b => b.shellId === scope.shellId && b.owner === scope.owner
      && b.id === app.id && b.generation === app.generation && b.guest && !b.guest.isDestroyed());
    if (name === 'list_app_tools') {
      let binding = live();
      if (!binding) {
        scope.window.webContents.send('mini-apps:agent-open', { owner: scope.owner, workspaceId: scope.workspaceId, id: app.id });
        const end = Date.now() + 7000;
        while (alive() && !binding && Date.now() < end) { await delay(50); binding = live(); }
      }
      if (!binding || !alive()) throw Error('The mini app could not open in this workspace.');
      const guest = binding.guest;
      const tools = await discover(guest, app.tools, () => alive() && live()?.guest === guest);
      if (!alive() || live()?.guest !== guest) throw Error('The mini app closed. Discover it again.');
      const { page, next_offset } = pageOf(tools, args.offset);
      return { instance: binding.instance, tools: page, next_offset };
    }
    if (name !== 'call_app_tool') throw Error('Unknown mini app operation.');
    const binding = live();
    if (!binding || binding.instance !== args.instance || !app.tools.includes(args.tool)) throw Error('Discover the tools of this mini app again.');
    if (typeof args.input_json !== 'string' || args.input_json.length > 24000) throw Error('Invalid tool input.');
    const input = JSON.parse(args.input_json);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Expected a JSON object.');
    const value = await invokeTool(binding.guest, args.tool, input);
    if (!alive() || live()?.instance !== args.instance) throw Error('The app changed. Inspect its state before retrying.');
    if (!value || typeof value.ok !== 'boolean' || (value.ok && !Object.hasOwn(value, 'value'))) throw Error('The app returned an invalid v2 result. Inspect its state before retrying.');
    if (!value.ok) throw Error(typeof value.error === 'string' ? value.error : 'Mini app operation failed.');
    return value.value;
  }
  async function command(name, args, window) {
    const { owner, id } = args;
    switch (name) {
      case 'mini_apps_context': return setScope(window, owner, args.workspaceId);
      case 'mini_apps_list': return { installed: store.list(owner), catalog: [metadata(parsePackage(catalog()))] };
      case 'mini_apps_inspect': return metadata(parsePackage(args.raw));
      case 'mini_apps_set_pinned':
        store.setPinned(owner, id, args.pinned);
        libraryChanged();
        return;
      case 'mini_apps_install': {
        const shellId = window.webContents.id;
        const scope = scopes.get(shellId);
        const official = catalog();
        const raw = args.catalog === true ? official : args.raw;
        const candidate = parsePackage(raw);
        const bundled = parsePackage(official);
        if (candidate.id === bundled.id && !isDeepStrictEqual(candidate, bundled)) {
          throw Error('This ID belongs to the catalog app. Choose a different ID in your manifest.');
        }
        await validateInstallation(candidate);
        if (window.isDestroyed() || scopes.get(shellId) !== scope || (scope && scope.owner !== owner)) throw Error('The account or workspace changed during installation.');
        const installed = store.install(owner, raw, args.previousGeneration);
        libraryChanged();
        return installed;
      }
      case 'mini_apps_open': return prepare(window, owner, id);
      case 'mini_apps_remove': {
        store.remove(owner, id);
        libraryChanged();
        for (const [key, item] of bindings) if (item.owner === owner && item.id === id) bindings.delete(key);
        return;
      }
      case 'mini_apps_download': {
        const { canceled, filePath } = await dialog.showSaveDialog(window, { defaultPath: 'kanban.nbmini.json', filters: [{ name: 'Mini app package', extensions: ['json'] }] });
        if (!canceled && filePath) await fs.promises.writeFile(filePath, catalog(), 'utf8');
        return;
      }
      default: throw Error('Unknown mini app action.');
    }
  }
  return { command, guardWindow, agentScope, agentTool, isGuest: contents => guestSessions.has(contents.session) };
}
module.exports = { createHost };
