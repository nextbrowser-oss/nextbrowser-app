// stdio adapter for external agents. The private configuration arrives in a
// unique environment variable, not argv or the agent's persistent config.
const { spawn } = require('node:child_process');
const { serverEnvironment } = require('./mcp-environment.cjs');
const key = process.argv[2];
try {
  if (!/^NEXTBROWSER_MCP_[a-f0-9]+$/.test(key || '')) throw new Error('Invalid configuration reference.');
  const config = JSON.parse(process.env[key] || '');
  delete process.env[key];
  if (config.url) {
    const client = require('./mcp-http-client.cjs').createHttpMcpClient(config);
    const lines = require('node:readline').createInterface({ input: process.stdin });
    lines.on('line', async line => {
      let message;
      try {
        message = JSON.parse(line);
        if (message.id === undefined) return;
        let result;
        if (message.method === 'initialize') {
          await client.initialize();
          result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'nextbrowser-mcp-bridge', version: '1' } };
        } else if (message.method === 'tools/list') result = { tools: await client.listTools() };
        else if (message.method === 'tools/call') result = await client.callTool(message.params.name, message.params.arguments);
        else if (message.method === 'ping') result = {};
        else throw new Error('Unsupported method.');
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
      } catch { if (message?.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'MCP request failed. Check the connection in Nextbrowser.' } }) + '\n'); }
    });
    lines.on('close', () => client.close());
    process.on('SIGTERM', () => { client.close(); process.exit(); });
  } else {
  const child = spawn(config.file, config.args, { env: serverEnvironment(process.env, config.env), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  process.stdin.pipe(child.stdin); child.stdout.pipe(process.stdout);
  // The server may echo credentials to stderr; keep diagnostics generic.
  child.stderr.resume();
  child.stdin.on('error', () => {});
  child.on('error', () => { process.stderr.write('MCP executable could not start.\n'); process.exitCode = 1; process.stdin.destroy(); });
  child.on('close', code => { process.exitCode = code || 0; process.stdin.destroy(); });
  process.stdin.on('end', () => child.kill());
  process.on('SIGTERM', () => { child.kill(); process.exit(); });
  }
} catch { process.stderr.write('MCP configuration is unavailable.\n'); process.exitCode = 1; }
