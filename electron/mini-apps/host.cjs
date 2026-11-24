const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { createStore, parsePackage, metadata, STATE_BYTES } = require('./store.cjs');

// This origin is served entirely by the guest's in-memory Electron session.
const origin = 'https://mini-app.invalid';
const entry = origin + '/index.html';
const stateURL = origin + '/state';
const catalogPath = path.join(__dirname, 'catalog', 'kanban.nbmini.json');
const csp = "sandbox allow-scripts allow-same-origin allow-forms; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
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

function createHost({ root, session, dialog }) {
  const store = createStore(root);
  const bindings = new Map();
  const guestSessions = new WeakSet();
  function prepare(window, owner, id) {
    const { generation } = store.read(owner, id);
    const partition = 'mini-app-' + createHash('sha256').update(JSON.stringify([window.id, owner, id, generation])).digest('hex');
    if (bindings.has(partition)) return { partition, src: entry };
    const isolated = session.fromPartition(partition, { cache: false });
    guestSessions.add(isolated);
    const shellId = window.webContents.id;
    bindings.set(partition, { shellId, owner, id });
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
        const record = store.read(owner, id);
        if (record.generation !== generation) return json(null, 410);
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
        return store.save(owner, id, generation, revision, value) ? json({ revision: revision + 1 }) : json(null, 409);
      } catch { return json(null, 400); }
    });
    return { partition, src: entry };
  }
  function guardWindow(window) {
    const contents = window.webContents;
    const shellId = contents.id;
    contents.once('destroyed', () => {
      for (const [key, item] of bindings) if (item.shellId === shellId) bindings.delete(key);
    });
    contents.on('will-attach-webview', (event, prefs, params) => {
      if (!params.partition?.startsWith('mini-app-') && !params.src?.startsWith(origin)) return;
      if (bindings.get(params.partition)?.shellId !== shellId || params.src !== entry) { event.preventDefault(); return; }
      delete prefs.preload;
      Object.assign(prefs, { sandbox: true, nodeIntegration: false, nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false, contextIsolation: true, webSecurity: true, webviewTag: false,
        plugins: false, disableDialogs: true, navigateOnDragDrop: false, safeDialogs: true, allowRunningInsecureContent: false });
    });
    contents.on('did-attach-webview', (_event, guest) => {
      if (!guestSessions.has(guest.session)) return;
      guest.setWindowOpenHandler(() => ({ action: 'deny' }));
      guest.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
      guest.on('will-frame-navigate', event => { if (!event.isMainFrame || event.url !== entry) event.preventDefault(); });
      guest.on('will-attach-webview', event => event.preventDefault());
    });
  }
  async function command(name, args, window) {
    const { owner, id } = args;
    const catalog = () => fs.readFileSync(catalogPath, 'utf8');
    switch (name) {
      case 'mini_apps_list': return { installed: store.list(owner), catalog: [metadata(parsePackage(catalog()))] };
      case 'mini_apps_inspect': return metadata(parsePackage(args.raw));
      case 'mini_apps_install': {
        const official = catalog();
        const raw = args.catalog === true ? official : args.raw;
        const candidate = parsePackage(raw);
        const bundled = parsePackage(official);
        if (candidate.id === bundled.id && !isDeepStrictEqual(candidate, bundled)) {
          throw Error('This ID belongs to the catalog app. Choose a different ID in your manifest.');
        }
        return store.install(owner, raw);
      }
      case 'mini_apps_open': return prepare(window, owner, id);
      case 'mini_apps_remove': {
        store.remove(owner, id);
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
  return { command, guardWindow, isGuest: contents => guestSessions.has(contents.session) };
}
module.exports = { createHost };
