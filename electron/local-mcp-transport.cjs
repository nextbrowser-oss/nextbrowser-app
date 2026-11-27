async function serveLocalMcp(request, response, invoke, { serverInfo, instructions, tools }) {
  const send = (status, data) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(data)); };
  if (!invoke || request.headers.origin) return send(403);
  if (request.method !== 'POST') return send(405);
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(415);
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 128 * 1024) return send(413);
    chunks.push(chunk);
  }
  let msg;
  try { msg = JSON.parse(Buffer.concat(chunks).toString()); } catch { return send(400); }
  if (msg?.jsonrpc !== '2.0' || typeof msg.method !== 'string') return send(400);
  if (msg.id === undefined) return send(202);
  const reply = { jsonrpc: '2.0', id: msg.id };
  switch (msg.method) {
    case 'initialize': {
      const version = msg.params?.protocolVersion;
      reply.result = { protocolVersion: ['2025-03-26', '2025-06-18', '2025-11-25'].includes(version) ? version : '2025-11-25',
        serverInfo, capabilities: { tools: {} }, instructions };
      break;
    }
    case 'ping': reply.result = {}; break;
    case 'tools/list': reply.result = { tools }; break;
    case 'tools/call':
      try {
        if (!tools.some(tool => tool.name === msg.params?.name)) throw Error('Unknown tool.');
        const value = await invoke(msg.params.name, msg.params.arguments || {});
        reply.result = { content: [{ type: 'text', text: JSON.stringify(value) }] };
      } catch (error) {
        reply.result = { isError: true, content: [{ type: 'text', text: String(error?.message || 'MCP tool call failed.').slice(0, 600) }] };
      }
      break;
    default: reply.error = { code: -32601, message: 'Method not found' };
  }
  send(200, reply);
}
module.exports = { serveLocalMcp };
