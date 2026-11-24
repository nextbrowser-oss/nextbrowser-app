const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const PACKAGE_BYTES = 256 * 1024;
const STATE_BYTES = 128 * 1024;
const validId = id => typeof id === 'string' && /^[a-z][a-z0-9-]{1,47}$/.test(id);
function parsePackage(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > PACKAGE_BYTES) throw Error('Package exceeds 256 KiB.');
  let p;
  try { p = JSON.parse(raw); } catch { throw Error('Invalid package JSON.'); }
  const fields = ['apiVersion', 'id', 'name', 'version', 'description', 'permissions', 'html', 'icon'];
  if (!p || Object.keys(p).some(k => !fields.includes(k)) || p.apiVersion !== 1 || !validId(p.id) ||
      typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60 ||
      typeof p.description !== 'string' || p.description.length > 240 ||
      typeof p.version !== 'string' || !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(p.version) ||
      typeof p.html !== 'string' || !p.html.trim() ||
      (p.icon !== undefined && !['board', 'calendar', 'list', 'notebook', 'chart', 'grid'].includes(p.icon)) ||
      !Array.isArray(p.permissions) || p.permissions.length > 1 || p.permissions.some(v => v !== 'storage')) {
    throw Error('Invalid Mini Apps v1 package or unsupported permission.');
  }
  return p;
}
function metadata({ html, ...info }) { return info; }
function createStore(root) {
  function directory(owner) {
    if (typeof owner !== 'string' || !owner || owner.length > 512) throw Error('Account unavailable.');
    return path.join(root, createHash('sha256').update(owner).digest('hex'));
  }
  function location(owner, id) {
    if (!validId(id)) throw Error('Invalid app ID.');
    return path.join(directory(owner), 'app-' + id + '.json');
  }
  function write(file, record) {
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, file);
    } finally { fs.rmSync(temporary, { force: true }); }
  }
  function read(owner, id) { return JSON.parse(fs.readFileSync(location(owner, id), 'utf8')); }
  function list(owner) {
    const dir = directory(owner);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(name => /^app-.*\.json$/.test(name))
      .map(name => {
        const record = read(owner, name.slice(4, -5));
        return { ...metadata(record.pkg), pinned: record.pinned === true };
      });
  }
  function install(owner, raw) {
    const pkg = parsePackage(raw);
    const file = location(owner, pkg.id);
    if (fs.existsSync(file)) throw Error('This app ID is already installed.');
    fs.mkdirSync(directory(owner), { recursive: true, mode: 0o700 });
    if (list(owner).length >= 32) throw Error('The limit is 32 installed mini apps.');
    write(file, { pkg, generation: randomUUID(), revision: 0, value: null });
    return metadata(pkg);
  }
  function save(owner, id, generation, expected, value) {
    const record = read(owner, id);
    if (record.generation !== generation || !record.pkg.permissions.includes('storage')) throw Error('Storage unavailable.');
    if (record.revision !== expected) return false;
    if (value === undefined || Buffer.byteLength(JSON.stringify(value)) > STATE_BYTES) throw Error('Storage limit exceeded.');
    write(location(owner, id), { ...record, revision: expected + 1, value });
    return true;
  }
  function setPinned(owner, id, pinned) {
    if (typeof pinned !== 'boolean') throw Error('Invalid rail preference.');
    const record = read(owner, id);
    write(location(owner, id), { ...record, pinned });
  }
  return { list, read, install, save, setPinned, remove(owner, id) { fs.unlinkSync(location(owner, id)); } };
}
module.exports = { parsePackage, metadata, createStore, PACKAGE_BYTES, STATE_BYTES };
