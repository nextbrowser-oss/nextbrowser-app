const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { once } = require('node:events');
const { createTabBridge } = require('./tab-mcp.cjs');

const [binary, ...args] = process.argv.slice(2);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const runner = spawn(binary, args, { env, windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });
const bridge = createTabBridge();
async function write(stream, message) {
  if (!stream.write(JSON.stringify(message) + '\n')) await once(stream, 'drain');
}
async function relay(input, handle) {
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (line.trim()) await handle(JSON.parse(line));
  }
}
function stop() { runner.kill(); }
function fail() {
  process.exitCode = 1;
  process.stdin.destroy();
  stop();
}
runner.on('error', fail);
runner.stdin.on('error', fail);
process.stdout.on('error', fail);
process.once('SIGTERM', stop);
runner.on('close', code => { if (code) process.exitCode = code; process.stdin.destroy(); });
relay(process.stdin, async message => {
  const { forward, reply } = bridge.request(message);
  if (reply) await write(process.stdout, reply);
  else await write(runner.stdin, forward);
}).then(() => runner.stdin.end(), fail);
relay(runner.stdout, async message => write(process.stdout, bridge.response(message))).catch(fail);
