const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { serverEnvironment } = require('./mcp-environment.cjs');
const { terminateProcessTree } = require('./process-tree.cjs');

function executable(files) {
  return files.find(file => {
    if (!file || !path.isAbsolute(file)) return false;
    try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); }
    catch { return false; }
  });
}
function onPath(name) {
  return (process.env.PATH || '').split(path.delimiter).filter(dir => path.isAbsolute(dir)).map(dir => path.join(dir, name));
}
function shells() {
  const win = process.platform === 'win32';
  const programs = [process.env.ProgramW6432, process.env.ProgramFiles, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  const bash = executable(win ? programs.map(dir => path.join(dir, 'Git', 'bin', 'bash.exe'))
    .concat(onPath('bash.exe').filter(file => !/[/\\](?:system32|syswow64)[/\\]bash\.exe$/i.test(file))) : ['/bin/bash', ...onPath('bash')]);
  const powershell = executable(win ? [...programs.map(dir => path.join(dir, 'PowerShell', '7', 'pwsh.exe')),
    path.join(process.env.SystemRoot || '', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ...onPath('pwsh.exe')]
    : [...onPath('pwsh'), '/opt/microsoft/powershell/7/pwsh', '/opt/homebrew/bin/pwsh', '/usr/local/bin/pwsh']);
  return { ...(bash && { bash }), ...(powershell && { powershell }) };
}
function adbExecutable(sdkFolder) {
  const name = process.platform === 'win32' ? 'adb.exe' : 'adb';
  if (sdkFolder) return executable([path.join(sdkFolder, 'platform-tools', name), path.join(sdkFolder, name)]);
  const roots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
    path.join(os.homedir(), 'Library', 'Android', 'sdk'), path.join(os.homedir(), 'Android', 'Sdk')];
  return executable([...roots.filter(Boolean).map(dir => path.join(dir, 'platform-tools', name)), ...onPath(name), '/opt/homebrew/bin/adb', '/usr/local/bin/adb']);
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
    return { text, sha256: createHash('sha256').update(bytes.subarray(0, used)).digest('hex'), nextOffset: offset + text.length < content.length ? offset + text.length : null };
  } finally { await file.close(); }
}

const activeWorkspaceWrites = new Set();

async function editEntry(root, relative, directory, content, expected, check) {
  if (!safeText(relative, 600) || relative.includes('\n')) throw Error('Choose a workspace path.');
  const parts = relative.split(/[\\/]/).filter(part => part !== '.');
  if (!parts.length || parts.some(part => !part || /[<>:"|?*]|[. ]$/.test(part) || /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) throw Error('Choose a relative workspace path with a valid name.');
  const name = parts.pop();
  const parentPath = parts.join('/') || '.';
  const parent = await resolveEntry(root, parentPath);
  const target = path.join(parent, name);
  if (directory) {
    check();
    try { await fs.promises.mkdir(target); }
    catch (error) {
      if (error.code !== 'EEXIST' || !(await fs.promises.lstat(target)).isDirectory()) throw error;
      return { existing: relative };
    }
    return { created: relative };
  }
  if (typeof content !== 'string' || content.includes('\0') || Buffer.byteLength(content) > 64 * 1024) throw Error('Write at most 64 KiB of UTF-8 text at once.');
  if (expected !== undefined && (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))) throw Error('Use the sha256 returned by read_text_file.');
  const key = process.platform === 'win32' ? target.toLowerCase() : target;
  if (activeWorkspaceWrites.has(key)) throw Error('Another edit is in progress. Read the file again.');
  activeWorkspaceWrites.add(key);
  try {
    await writeWorkspaceText(root, relative, parentPath, parent, target, content, expected, check);
    return { path: relative, sha256: createHash('sha256').update(content).digest('hex') };
  } finally { activeWorkspaceWrites.delete(key); }
}

async function writeWorkspaceText(root, relative, parentPath, parent, target, content, expected, check) {
  // Stage a replacement next to its destination. Never open an existing link
  // for writing, and never overwrite an existing file in create mode.
  let mode = 0o600;
  if (expected !== undefined) {
    const stat = await fs.promises.lstat(target);
    if (!stat.isFile()) throw Error('Choose a regular workspace file.');
    mode = stat.mode & 0o777;
  }
  const temp = path.join(parent, '.nextbrowser-' + randomUUID());
  check();
  const file = await fs.promises.open(temp, 'wx', mode);
  try {
    try { await file.writeFile(content, 'utf8'); } finally { await file.close(); }
    if (await resolveEntry(root, parentPath) !== parent) throw Error('The destination moved.');
    if (expected === undefined) {
      check();
      await fs.promises.copyFile(temp, target, fs.constants.COPYFILE_EXCL);
    } else {
      const current = await readEntry(root, relative, false);
      if (current.sha256 !== expected) throw Error('File changed. Read it again before editing.');
      check();
      await fs.promises.rename(temp, target);
    }
  } finally { await fs.promises.unlink(temp).catch(() => {}); }
}

function runShell(file, shell, command, cwd, signal) {
  const args = shell === 'bash' ? ['--noprofile', '--norc', '-c', command] : ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command];
  return runProgram(file, args, cwd, signal);
}
function runProgram(file, args, cwd, signal, timeoutMs = 25_000) {
  signal.throwIfAborted();
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
    const timer = setTimeout(stop, timeoutMs);
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
module.exports = { shells, adbExecutable, safeText, readEntry, editEntry, resolveEntry, runShell, runProgram };
