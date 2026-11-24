const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { serverEnvironment } = require('./mcp-environment.cjs');
const { terminateProcessTree } = require('./process-tree.cjs');

function shells() {
  if (process.platform !== 'win32') return fs.existsSync('/bin/bash') ? { bash: '/bin/bash' } : {};
  const gitBash = [process.env.ProgramW6432, process.env.ProgramFiles, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]
    .filter(Boolean).map(dir => path.join(dir, 'Git', 'bin', 'bash.exe')).find(file => fs.existsSync(file));
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return { ...(gitBash ? { bash: gitBash } : {}), ...(fs.existsSync(powershell) ? { powershell } : {}) };
}

function safeText(value, limit) {
  // Dialog text must display the same operation the host will run.
  return typeof value === 'string' && value.trim() && value.length <= limit &&
    !/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/u.test(value);
}
function inside(root, file) {
  const rel = path.relative(root, file);
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}
async function resolveEntry(root, relative) {
  if (!safeText(relative, 600) || relative.includes('\n') || relative.includes(':') || /^[\\/]/.test(relative) ||
      relative.split(/[\\/]/).some(part => part === '..' || (process.platform === 'win32' && /^(?:con|nul|aux|prn|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))) throw Error('Use a relative path inside the selected folder.');
  const base = await fs.promises.realpath(root);
  if (path.relative(root, base) !== '') throw Error('The selected folder moved. Choose it again in MCP permissions.');
  const resolved = await fs.promises.realpath(path.resolve(base, relative));
  if (!inside(base, resolved)) throw Error('This path is outside the selected folder.');
  return resolved;
}
async function readEntry(root, relative, list, offset = 0) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw Error('Invalid offset.');
  const target = await resolveEntry(root, relative);
  if (list) {
    const before = await fs.promises.stat(target);
    if (!before.isDirectory()) throw Error('Choose a directory.');
    const entries = (await fs.promises.readdir(target, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    const after = await fs.promises.stat(await resolveEntry(root, relative));
    if (after.dev !== before.dev || after.ino !== before.ino) throw Error('Directory changed. List it again.');
    const page = entries.slice(offset, offset + 20).map(d => ({ name: d.name, type: d.isDirectory() ? 'directory' : d.isFile() ? 'file' : 'link or special file' }));
    return { entries: page, nextOffset: offset + page.length < entries.length ? offset + page.length : null };
  }
  const before = await fs.promises.stat(target);
  if (!before.isFile()) throw Error('Choose a regular UTF-8 text file.');
  const file = await fs.promises.open(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || target !== await resolveEntry(root, relative)) throw Error('File changed. Read it again.');
    if (stat.size > 512 * 1024) throw Error('Text files must be at most 512 KiB.');
    const bytes = Buffer.alloc(Math.min(stat.size, 512 * 1024));
    let used = 0;
    while (used < bytes.length) {
      const { bytesRead } = await file.read(bytes, used, bytes.length - used, used);
      if (!bytesRead) break;
      used += bytesRead;
    }
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, used));
    if (content.includes('\0')) throw Error('Choose a UTF-8 text file.');
    const text = content.slice(offset, offset + 4000);
    return { text, nextOffset: offset + text.length < content.length ? offset + text.length : null };
  } finally { await file.close(); }
}

function runShell(file, shell, command, cwd, signal) {
  signal.throwIfAborted();
  const args = shell === 'bash' ? ['--noprofile', '--norc', '-c', command] : ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command];
  const child = spawn(file, args, { cwd, shell: false, windowsHide: true, env: serverEnvironment(process.env), stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, truncated = false, stopping = false;
    const capture = chunk => {
      const room = 5500 - size;
      if (chunk.length > room) truncated = true;
      if (room > 0) { const part = chunk.subarray(0, room); chunks.push(part); size += part.length; }
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const stop = () => {
      if (stopping) return;
      stopping = true;
      if (child.pid && child.exitCode === null && child.signalCode === null) void terminateProcessTree(child.pid, { includeRoot: true }).catch(() => child.kill());
      child.stdout.destroy(); child.stderr.destroy();
    };
    const timer = setTimeout(stop, 25_000);
    signal.addEventListener('abort', stop, { once: true });
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', stop); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', (exitCode, exitSignal) => {
      cleanup();
      if (stopping || signal.aborted) return reject(Error('Command stopped or timed out. Check the result before retrying.'));
      resolve({ exitCode, signal: exitSignal, output: Buffer.concat(chunks).toString('utf8'), truncated });
    });
  });
}
module.exports = { shells, safeText, readEntry, resolveEntry, runShell };
