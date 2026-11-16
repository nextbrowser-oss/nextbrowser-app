const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { writeFileAtomic } = require('./app-settings.cjs');

function cleanPins(value) {
  if (!Array.isArray(value) || value.length > 24) throw new Error('Use up to 24 shortcuts.');
  const ids = new Set();
  return value.map(pin => {
    const url = new URL(pin.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) throw new Error('Use an HTTP or HTTPS address without credentials.');
    if (typeof pin.id !== 'string' || !/^[\w-]{1,64}$/.test(pin.id) || ids.has(pin.id)) throw new Error('Invalid shortcut.');
    ids.add(pin.id);
    const name = String(pin.name || '').trim().slice(0, 80);
    if (!name) throw new Error('Give the shortcut a name.');
    return { id: pin.id, name, url: url.href };
  });
}

/** A loopback-only, profile-scoped start page. It never exposes Electron IPC to web content. */
function createStartPageServer({ distDir, storageDir, requestDesktop }) {
  const scopes = new Map();
  let server, origin, starting;
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2' };
  const json = (res, code, value) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  async function body(req) {
    let text = '';
    for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 65536) throw new Error('Request too large.'); }
    return JSON.parse(text);
  }
  function fileFor(scope) {
    const key = createHash('sha256').update(JSON.stringify([scope.workspaceId, scope.runtime, scope.profile])).digest('hex');
    return path.join(storageDir, 'start-page', `${key}.json`);
  }
  async function readPins(scope) {
    try { return cleanPins(JSON.parse(await fs.readFile(fileFor(scope), 'utf8'))); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function handle(req, res) {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'");
    const pathname = new URL(req.url, origin).pathname;
    const match = /^\/start\/([a-f0-9]{32})\/(state|pins|action)?$/.exec(pathname);
    const topLevelNavigation = req.method === 'GET' && match && !match[2] && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) ||
        (req.headers['sec-fetch-site'] === 'cross-site' && !topLevelNavigation)) {
      return json(res, 403, { error: 'Request not allowed.' });
    }
    const scope = match && scopes.get(match[1]);
    if (scope) {
      if (scope.sender.isDestroyed()) return json(res, 410, { error: 'Open Nextbrowser to reconnect this page.' });
      if (req.method === 'GET' && match[2] === 'state') {
        const data = await requestDesktop(scope, { type: 'state' });
        return json(res, 200, { ...data, pins: await readPins(scope) });
      }
      if (['PUT', 'POST'].includes(req.method)) {
        if (req.headers.origin !== origin || req.headers['x-nextbrowser-start'] !== '1' || !String(req.headers['content-type']).startsWith('application/json')) return json(res, 403, { error: 'Request not allowed.' });
        const data = await body(req);
        // Recheck workspace/profile ownership on every write, including saved shortcuts.
        if (req.method === 'PUT' && match[2] === 'pins') {
          await requestDesktop(scope, { type: 'authorize' });
          const pins = cleanPins(data);
          await fs.mkdir(path.dirname(fileFor(scope)), { recursive: true });
          await writeFileAtomic(fileFor(scope), JSON.stringify(pins), { durable: true });
          return json(res, 200, pins);
        }
        if (req.method === 'POST' && match[2] === 'action' && ['draft', 'resume', 'refresh'].includes(data.type)) return json(res, 200, await requestDesktop(scope, data));
      }
      if (req.method === 'GET' && !match[2]) {
        const html = (await fs.readFile(path.join(distDir, 'start.html'), 'utf8')).replace('<head>', '<head><base href="/">');
        res.writeHead(200, { 'Content-Type': mime['.html'], 'Cache-Control': 'no-store' }); return res.end(html);
      }
    }
    // Only compiled public assets, never app data or the desktop HTML/preload.
    if (req.method === 'GET' && (/^\/assets\/[a-zA-Z0-9_.-]+$/.test(pathname) || pathname === '/nextbrowser-logo.svg')) {
      const type = mime[path.extname(pathname)];
      if (type) {
        try { const data = await fs.readFile(path.join(distDir, pathname.slice(1))); res.writeHead(200, { 'Content-Type': type }); return res.end(data); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
    json(res, 404, { error: 'Start page not found. Open Live again from Nextbrowser.' });
  }
  async function ensure() {
    if (origin) return;
    if (!starting) starting = new Promise((resolve, reject) => {
      server = http.createServer((req, res) => { void handle(req, res).catch(error => json(res, 400, { error: error.message || 'Could not load the start page.' })); });
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { origin = `http://127.0.0.1:${server.address().port}`; resolve(); });
    }).catch(error => { starting = undefined; throw error; });
    await starting;
  }
  return {
    async open(scope) {
      await ensure();
      for (const [key, value] of scopes) if (value.sender.isDestroyed()) scopes.delete(key);
      const existing = [...scopes].find(([, value]) => value.sender === scope.sender && value.workspaceId === scope.workspaceId && value.profile === scope.profile && value.runtime === scope.runtime);
      const token = existing?.[0] || randomBytes(16).toString('hex');
      scopes.set(token, scope);
      return `${origin}/start/${token}/`;
    },
    async close() { scopes.clear(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } origin = undefined; starting = undefined; },
  };
}
module.exports = { createStartPageServer, cleanPins };
