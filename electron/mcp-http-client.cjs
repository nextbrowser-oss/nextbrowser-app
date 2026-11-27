// Streamable HTTP JSON-RPC, including JSON and SSE responses. OAuth-dependent
// servers must be authorized separately; configured headers are encrypted.
function createHttpMcpClient({ url, headers = {}, fetchImpl = fetch }) {
  let id = 0, session = '', version = '2025-03-26', closed = false;
  const active = new Set();
  async function send(method, params, timeoutMs = 30_000, notification = false) {
    if (closed) throw new Error('MCP connection closed.');
    const controller = new AbortController(); active.add(controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs), requestId = ++id;
    try {
      const response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
          ...(session ? { 'Mcp-Session-Id': session } : {}), ...(method !== 'initialize' ? { 'MCP-Protocol-Version': version } : {}) },
        body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id: requestId }), method, params }) });
      if (!response.ok) throw new Error(`MCP HTTP ${response.status}.`);
      if (method === 'initialize') session = response.headers.get('Mcp-Session-Id') || '';
      if (notification) { await response.body?.cancel(); return; }
      const decode = message => {
        if (message.id !== requestId) return undefined;
        if (message.error) throw new Error('MCP server rejected the request.');
        return { result: message.result };
      };
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let buffer = '', bytes = 0;
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) throw new Error('MCP stream ended without a response.');
            bytes += chunk.value.byteLength;
            if (bytes > 8 * 1024 * 1024) throw new Error('MCP response too large.');
            buffer += decoder.decode(chunk.value, { stream: true }); buffer = buffer.replace(/\r\n/g, '\n');
            let end;
            while ((end = buffer.indexOf('\n\n')) !== -1) {
              const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
              const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
              if (!data) continue;
              const result = decode(JSON.parse(data));
              if (result) return result.result;
            }
          }
        } finally { await reader.cancel().catch(() => {}); }
      }
      const text = await response.text();
      if (text.length > 8 * 1024 * 1024) throw new Error('MCP response too large.');
      const result = decode(JSON.parse(text));
      if (!result) throw new Error('MCP response ID did not match.');
      return result.result;
    } finally { clearTimeout(timer); active.delete(controller); }
  }
  return {
    async initialize(timeoutMs) {
      const result = await send('initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'nextbrowser', version: '1' } }, timeoutMs);
      version = result.protocolVersion || version;
      await send('notifications/initialized', {}, timeoutMs, true);
    },
    async listTools(timeoutMs) {
      const tools = [], seen = new Set(); let cursor;
      do {
        const result = await send('tools/list', cursor ? { cursor } : {}, timeoutMs);
        tools.push(...(result.tools || [])); cursor = result.nextCursor;
        if (cursor && (seen.has(cursor) || seen.size >= 20)) throw new Error('MCP pagination exceeded its limit.');
        if (cursor) seen.add(cursor);
      } while (cursor);
      return tools;
    },
    callTool: (name, args, timeoutMs = 120_000) => send('tools/call', { name, arguments: args }, timeoutMs),
    close() {
      if (closed) return; closed = true; active.forEach(controller => controller.abort());
      if (session) void fetchImpl(url, { method: 'DELETE', redirect: 'error', headers: { ...headers, 'Mcp-Session-Id': session, 'MCP-Protocol-Version': version }, signal: AbortSignal.timeout(3000) }).catch(() => {});
    },
  };
}
module.exports = { createHttpMcpClient };
