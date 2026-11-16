// ClawBrowser deliberately sends loopback URLs through its profile proxy.
// Fulfil only this app's start-page origin over CDP; never change proxy rules
// or intercept ordinary websites. The HTTP server still authorizes every action.
function localEndpoint(value) {
  const url = new URL(value);
  if (!['http:', 'ws:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || url.username || url.password) throw new Error('A local browser connection is required.');
  return url;
}

async function connectStartPageTransport(endpoint, pageURL) {
  const base = localEndpoint(endpoint);
  const page = localEndpoint(pageURL);
  if (page.protocol !== 'http:' || !/^\/start\/[a-f0-9]{32}\/$/.test(page.pathname)) throw new Error('Invalid start page.');
  const version = await fetch(new URL('/json/version', base), { signal: AbortSignal.timeout(3000) }).then(r => r.json());
  const socketURL = localEndpoint(version.webSocketDebuggerUrl);
  if (socketURL.protocol !== 'ws:' || socketURL.port !== base.port) throw new Error('Invalid browser connection.');
  const socket = new WebSocket(socketURL);
  const pending = new Map();
  const sessions = new Map();
  let sequence = 0;
  let closed = false;
  const fail = () => { closed = true; for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Browser connection closed.')); } pending.clear(); };
  socket.addEventListener('close', fail);
  socket.addEventListener('error', fail);
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (closed || socket.readyState !== WebSocket.OPEN) return reject(new Error('Browser connection closed.'));
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Start page connection timed out.')); }, 5000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  async function fulfil(params, sessionId) {
    const request = params.request;
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const allowed = url.origin === page.origin && !url.username && !url.password &&
        (path === page.pathname || ['state', 'pins', 'action'].some(s => path === page.pathname + s) || /^\/assets\/[\w.-]+$/.test(path) || path === '/nextbrowser-logo.svg');
      if (!allowed || !['GET', 'POST', 'PUT'].includes(request.method) || Buffer.byteLength(request.postData || '') > 65536) throw new Error('Invalid local request.');
      const headers = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (['origin', 'content-type', 'x-nextbrowser-start', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'].includes(name.toLowerCase())) headers[name.toLowerCase()] = String(value);
      }
      const response = await fetch(url, { method: request.method, headers, ...(request.postData ? { body: request.postData } : {}), redirect: 'error', signal: AbortSignal.timeout(20000) });
      await call('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: response.status,
        responseHeaders: [...response.headers].filter(([name]) => !['transfer-encoding', 'connection', 'content-length', 'content-encoding'].includes(name)).map(([name, value]) => ({ name, value })),
        body: Buffer.from(await response.arrayBuffer()).toString('base64') }, sessionId);
    } catch {
      await call('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 503,
        responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }], body: Buffer.from('Start page unavailable. Reopen Live from Nextbrowser.').toString('base64') }, sessionId).catch(() => undefined);
    }
  }
  socket.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    const waiting = pending.get(message.id);
    if (waiting) {
      pending.delete(message.id); clearTimeout(waiting.timer);
      if (message.error) waiting.reject(new Error(message.error.message)); else waiting.resolve(message.result);
    } else if (message.method === 'Target.attachedToTarget') {
      const { sessionId } = message.params;
      const ready = call('Fetch.enable', { patterns: [{ urlPattern: page.origin + '/*', requestStage: 'Request' }] }, sessionId)
        .finally(() => call('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => undefined));
      sessions.set(sessionId, ready);
      void ready.catch(() => undefined);
    } else if (message.method === 'Target.detachedFromTarget') {
      sessions.delete(message.params.sessionId);
    } else if (message.method === 'Fetch.requestPaused') void fulfil(message.params, message.sessionId);
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Browser connection timed out.')), 3000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Browser connection failed.')); }, { once: true });
    });
    await call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'page' }, { exclude: true }] });
    await Promise.all(sessions.values());
  } catch (error) { socket.close(); throw error; }
  return { get closed() { return closed; }, close() { socket.close(); } };
}

function createStartPageTransports() {
  const connections = new Map();
  return {
    async ensure(endpoint, pageURL) {
      const current = connections.get(endpoint);
      if (current?.pageURL === pageURL && !current.transport.closed) return;
      current?.transport.close();
      connections.delete(endpoint);
      const transport = await connectStartPageTransport(endpoint, pageURL);
      connections.set(endpoint, { pageURL, transport });
    },
    close() { for (const c of connections.values()) c.transport.close(); connections.clear(); },
  };
}
module.exports = { createStartPageTransports, connectStartPageTransport };
