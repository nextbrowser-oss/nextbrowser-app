const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHttpMcpClient } = require('./mcp-http-client.cjs');
test('real HTTP handshake, session header, SSE response, paging and cleanup', async t => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    requests.push({ method: req.method, session: req.headers['mcp-session-id'], auth: req.headers.authorization });
    if (req.method === 'DELETE') { res.writeHead(200).end(); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const msg = JSON.parse(raw);
    if (!msg.id) { res.writeHead(202).end(); return; }
    if (msg.method === 'initialize') { res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'session-1' }).end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} } } })); return; }
    const result = msg.method === 'tools/list' ? { tools: [{ name: 'echo' }] } : { content: [{ type: 'text', text: 'hello' }] };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': keepalive\n\n');
    res.end('data: ' + JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = createHttpMcpClient({ url: `http://127.0.0.1:${server.address().port}/mcp`, headers: { Authorization: 'Bearer test-only' } });
  await client.initialize(); assert.equal((await client.listTools()).length, 1);
  assert.equal((await client.callTool('echo', {})).content[0].text, 'hello');
  client.close();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(requests[2].session, 'session-1'); assert.equal(requests[2].auth, 'Bearer test-only');
  assert.equal(requests.at(-1).method, 'DELETE');
});
test('HTTP authentication failures do not echo response bodies or credentials', async () => {
  const client = createHttpMcpClient({ url: 'https://example.invalid/mcp', fetchImpl: async () => new Response('token-secret', { status: 401 }) });
  await assert.rejects(client.initialize(), error => error.message === 'MCP HTTP 401.'); client.close();
});
