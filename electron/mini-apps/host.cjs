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
const contextURL = origin + '/context';
const musicURL = origin + '/music';
const swipeforgeURL = origin + '/swipeforge';
const { createMusicPlayer } = require('./music-player.cjs');
const { createSwipeForge } = require('./swipeforge.cjs');
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

function createHost({ root, session, dialog, WebContentsView, BrowserWindow, libraryChanged, safeStorage, openExternal, focusApp, catalogRequest }) {
  const { catalog, catalogIds, catalogEntry } = require('./catalog.cjs');
  const store = createStore(root, id => parsePackage(catalog(id)));
  const bindings = new Map();
  const scopes = new Map();
  const sessionBindings = new WeakMap();
  const guestSessions = new WeakSet();
  const music = createMusicPlayer({ session, BrowserWindow, dialog, guestSessions, store, browserRoot: path.join(root,'music-browsers') });
  const officialPlayer = parsePackage(catalog('music-player'));
  // Only the bundled package reaches the SwipeForge bridge; its tokens stay in this process.
  const swipeforge = createSwipeForge({ root: path.join(root, 'swipeforge'), safeStorage, openExternal, onConnected: focusApp });
  const officialSwipeForge = parsePackage(catalog('swipeforge'));
  function prepare(window, owner, id, blockId, surface, popover = false) {
    if (typeof popover !== 'boolean' || (popover && !blockId)) throw Error('Invalid widget view.');
    const { generation, pkg, placements } = store.read(owner, id);
    if ((blockId !== undefined || surface !== undefined) && (!pkg.widgets?.some(b => b.id === blockId && b.surfaces.includes(surface)) ||
        !placements?.[surface + '/' + blockId])) throw Error('Enable this widget on the selected surface first.');
    const shellId = window.webContents.id;
    for (const [partition, b] of bindings) {
      if (b.shellId === shellId && b.owner === owner && b.id === id && b.generation === generation && b.blockId === blockId && b.surface === surface && b.popover === popover) return { partition, src: entry };
    }
    const partition = 'mini-app-' + randomUUID();
    createPartition(partition, { shellId, owner, id, generation, blockId, surface, popover, music: id === 'music-player' && isDeepStrictEqual(pkg, officialPlayer),
      swipeforge: id === 'swipeforge' && isDeepStrictEqual(pkg, officialSwipeForge) }, () => store.read(owner, id),
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
      done({ cancel: !bindings.has(partition) || ![entry,stateURL,contextURL,musicURL,swipeforgeURL].includes(details.url) });
    });
    isolated.protocol.handle('https', async request => {
      if (!bindings.has(partition)) return json(null, 410);
      try {
        const record = read();
        if (record.generation !== binding.generation) return json(null, 410);
        if (request.url === contextURL && request.method === 'GET') return json({ blockId: binding.blockId ?? null, surface: binding.surface ?? null, ...(binding.popover ? {view:'popover'} : {}) });
        if (request.url === contextURL && request.method === 'POST' && binding.popover) {
          const { height } = await readStateRequest(request);
          const scope = scopes.get(binding.shellId);
          if (!Number.isSafeInteger(height) || height < 1 || height > 4096) return json(null, 400);
          if (binding.validation) return json(null);
          if (!bindings.has(partition) || !scope || scope.owner !== binding.owner || scope.window.isDestroyed()) return json(null, 410);
          const boundedHeight = Math.max(64, Math.min(360, height));
          if (boundedHeight !== binding.height) {
            binding.height = boundedHeight;
            scope.window.webContents.send('mini-apps:popover-size', { partition, height: boundedHeight });
          }
          return json(null);
        }
        if (request.url === musicURL && request.method === 'POST') {
          if (!binding.music || scopes.get(binding.shellId)?.owner !== binding.owner) return json(null, 403);
          const payload = await readStateRequest(request);
          if (!bindings.has(partition) || scopes.get(binding.shellId)?.owner !== binding.owner) return json(null, 410);
          const active = () => bindings.has(partition) && scopes.get(binding.shellId)?.owner === binding.owner;
          try { return json(await music.action(binding, payload, active)); }
          catch (e) { return json({ error: e.message }, 400); }
        }
        if (request.url === swipeforgeURL && request.method === 'POST') {
          if (!binding.swipeforge || scopes.get(binding.shellId)?.owner !== binding.owner) return json(null, 403);
          const payload = await readStateRequest(request);
          const active = () => bindings.has(partition) && scopes.get(binding.shellId)?.owner === binding.owner;
          if (!active()) return json(null, 410);
          try { return json(await swipeforge.action(binding, payload, active)); }
          catch (e) { return json({ error: e.message }, 400); }
        }
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
  async function validateView(pkg, viewContext) {
    const partition = 'mini-app-check-' + randomUUID();
    const mock = { pkg, revision: 0, value: null };
    const isolated = createPartition(partition, { ...viewContext, validation: true }, () => mock, (revision, value) => {
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
  async function validateInstallation(pkg) {
    await validateView(pkg, {});
    for (const widget of pkg.widgets ?? []) {
      for (const surface of widget.surfaces) {
        for (const popover of [false, true]) {
          try { await validateView(pkg, { blockId: widget.id, surface, popover }); }
          catch (error) { throw Error(`${widget.name} (${surface} ${popover ? 'popover' : 'tile'}): ${error.message}`); }
        }
      }
    }
  }
  function guardWindow(window) {
    const contents = window.webContents;
    const shellId = contents.id;
    const revoke = () => {
      music.closeForShell(shellId);
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
      binding.height = undefined;
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
      music.closeForShell(shellId);
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
  function installedApps(scope) {
    if (scopes.get(scope.shellId) !== scope) throw Error('The account or workspace changed. Start a new agent turn.');
    return store.list(scope.owner).filter(app => app.apiVersion === 2);
  }
  async function agentTool(scope, name, args, authorized) {
    const alive = () => authorized() && scopes.get(scope.shellId) === scope;
    if (!alive()) throw Error('The account or workspace changed. Start a new agent turn.');
    const installed = installedApps(scope);
    if (name === 'list_apps') {
      const entries = installed.map(({ id, name, description, version, skill, widgets, placements }) => ({
        id, name, description, version, skill,
        widgets: (widgets ?? []).map(block => ({ id: block.id, name: block.name,
          enabled_on: block.surfaces.filter(surface => placements[surface + '/' + block.id]) })),
      }));
      const { page: apps, next_offset } = pageOf(entries, args.offset);
      return { apps, next_offset };
    }
    const app = installed.find(a => a.id === args.app_id);
    if (!app) throw Error('This mini app is not installed for the current account.');
    const live = () => [...bindings.values()].find(b => b.shellId === scope.shellId && b.owner === scope.owner
      && b.id === app.id && b.generation === app.generation && b.guest && !b.guest.isDestroyed()
      && (name !== 'call_app_tool' || b.instance === args.instance));
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
      case 'mini_apps_reviews':
      case 'mini_apps_review_save':
      case 'mini_apps_community_list':
      case 'mini_apps_community_file':
      case 'mini_apps_publish': {
        if (!owner?.startsWith('account/') || scopes.get(window.webContents.id)?.owner !== owner) throw Error('Sign in to Nextbrowser to use the community catalog.');
        if (name === 'mini_apps_publish') {
          await validateInstallation(parsePackage(args.publication?.package));
          if (window.isDestroyed() || scopes.get(window.webContents.id)?.owner !== owner) throw Error('Your account changed.');
        }
        return require('./community.cjs').catalogCommand(name, args, (route, body) => catalogRequest(owner, route, body));
      }
      case 'mini_apps_context': return setScope(window, owner, args.workspaceId);
      case 'mini_apps_list': return { installed: store.list(owner), catalog: catalogIds.map(catalogEntry) };
      case 'mini_apps_set_widget':
        store.setWidget(owner, id, args.blockId, args.surface, args.size);
        libraryChanged();
        return;
      case 'mini_apps_inspect': return metadata(parsePackage(args.raw));
      case 'mini_apps_set_pinned':
        store.setPinned(owner, id, args.pinned);
        libraryChanged();
        return;
      case 'mini_apps_move_pinned':
        store.movePinned(owner, args.source, args.target, args.position);
        libraryChanged();
        return;
      case 'mini_apps_install': {
        const shellId = window.webContents.id;
        const scope = scopes.get(shellId);
        const raw = args.catalog === true ? catalog(id) : args.raw;
        const candidate = parsePackage(raw);
        if (catalogIds.includes(candidate.id) && !isDeepStrictEqual(candidate, parsePackage(catalog(candidate.id)))) {
          throw Error('This ID belongs to the catalog app. Choose a different ID in your manifest.');
        }
        if (args.publicationId) {
          if (!owner?.startsWith('account/') || scope?.owner !== owner || !/^[a-f0-9-]{36}$/i.test(args.publicationId)) throw Error('Invalid catalog installation.');
          const route = '/v1/catalog/apps/' + candidate.id + '/' + candidate.version + '/package?publication=' + encodeURIComponent(args.publicationId);
          if (await catalogRequest(owner, route) !== raw) throw Error('The catalog package changed. Refresh your listing.');
        }
        await validateInstallation(candidate);
        if (window.isDestroyed() || scopes.get(shellId) !== scope || (scope && scope.owner !== owner)) throw Error('The account or workspace changed during installation.');
        const installed = store.install(owner, raw, args.previousGeneration, args.publicationId);
        libraryChanged();
        return installed;
      }
      case 'mini_apps_open': return prepare(window, owner, id, args.blockId, args.surface, args.popover);
      case 'mini_apps_remove': {
        if (id === 'music-player') {
          for (const [key,item] of bindings) if (item.owner === owner && item.id === id) bindings.delete(key);
          await music.clear(owner);
        }
        if (id === 'swipeforge') {
          for (const [key,item] of bindings) if (item.owner === owner && item.id === id) bindings.delete(key);
          await swipeforge.clear({ owner, generation: store.read(owner, id).generation });
        }
        store.remove(owner, id);
        libraryChanged();
        for (const [key, item] of bindings) if (item.owner === owner && item.id === id) bindings.delete(key);
        return;
      }
      case 'mini_apps_download': {
        const raw = args.raw === undefined ? catalog(id) : args.raw;
        if (parsePackage(raw).id !== id) throw Error('Package ID changed.');
        const { canceled, filePath } = await dialog.showSaveDialog(window, { defaultPath: (id ?? 'kanban') + '.nbmini.json', filters: [{ name: 'Mini app package', extensions: ['json'] }] });
        if (!canceled && filePath) await fs.promises.writeFile(filePath, raw, 'utf8');
        return;
      }
      default: throw Error('Unknown mini app action.');
    }
  }
  return { command, guardWindow, agentScope, agentTool, installedApps, isGuest: contents => guestSessions.has(contents.session) };
}
module.exports = { createHost };
