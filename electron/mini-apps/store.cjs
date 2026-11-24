const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const PACKAGE_BYTES = 256 * 1024;
const STATE_BYTES = 128 * 1024;
const validId = id => typeof id === 'string' && /^[a-z][a-z0-9-]{1,47}$/.test(id);
const surfaces = ['chat.panel', 'settings.design'];
function validateWidgets(pkg) {
  if (pkg.skill !== undefined && (typeof pkg.skill !== 'string' || !pkg.skill.trim() || pkg.skill.length > 2400)) throw Error('Invalid mini app skill.');
  if (pkg.widgets === undefined) return;
  if (!Array.isArray(pkg.widgets) || !pkg.widgets.length || pkg.widgets.length > 12 || !pkg.skill) throw Error('Widget packages must include blocks and an agent skill.');
  const ids = new Set();
  for (const block of pkg.widgets) {
    if (!block || Object.keys(block).some(k => !['id','name','surfaces','grid'].includes(k)) ||
        !validId(block.id) || ids.has(block.id) || typeof block.name !== 'string' || !block.name.trim() || block.name.length > 60 ||
        !Array.isArray(block.surfaces) || !block.surfaces.length || block.surfaces.length > surfaces.length ||
        new Set(block.surfaces).size !== block.surfaces.length || block.surfaces.some(s => !surfaces.includes(s))) throw Error('Invalid widget block or surface.');
    ids.add(block.id);
    const grid = block.grid;
    if (!grid || Object.keys(grid).some(k => !['min','preferred','max'].includes(k)) ||
        !['min','preferred','max'].every(k => Array.isArray(grid[k]) && grid[k].length === 2 &&
          grid[k].every((n, i) => Number.isSafeInteger(n) && n >= 1 && n <= (i === 0 ? 12 : 8))) ||
        ![0,1].every(i => grid.min[i] <= grid.preferred[i] && grid.preferred[i] <= grid.max[i])) throw Error('Invalid widget grid bounds.');
  }
}
function parsePackage(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > PACKAGE_BYTES) throw Error('Package exceeds 256 KiB.');
  let p;
  try { p = JSON.parse(raw); } catch { throw Error('Invalid package JSON.'); }
  const fields = ['apiVersion', 'id', 'name', 'version', 'description', 'permissions', 'html', 'icon', 'tools', 'widgets', 'skill'];
  if (!p || Object.keys(p).some(k => !fields.includes(k)) || p.apiVersion !== 2 || !validId(p.id) ||
      !Array.isArray(p.tools) || !p.tools.length || p.tools.length > 64 || new Set(p.tools).size !== p.tools.length ||
      p.tools.some(name => typeof name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(name)) ||
      typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60 ||
      typeof p.description !== 'string' || p.description.length > 240 ||
      typeof p.version !== 'string' || !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(p.version) ||
      typeof p.html !== 'string' || !p.html.trim() ||
      (p.icon !== undefined && !['board', 'calendar', 'list', 'notebook', 'chart', 'grid', 'music'].includes(p.icon)) ||
      !Array.isArray(p.permissions) || p.permissions.length > 1 || p.permissions.some(v => v !== 'storage')) {
    throw Error('Mini Apps v2 requires a valid manifest and a nonempty list of unique WebMCP tool names.');
  }
  validateWidgets(p);
  return p;
}
function metadata({ html, ...info }) { return info; }
function createStore(root, catalog) {
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
  function read(owner, id) {
    const file = location(owner, id);
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (id === 'kanban' && record.pkg.apiVersion === 1 && catalog && record.pkg.version === '1.0.0') {
      const hash = createHash('sha256').update(record.pkg.html).digest('hex');
      if (hash === 'afcea1a4c6bdece7974faa48e8ad4c3baf9d76c5f43383916c2308d3202a4445') {
        record.pkg = catalog();
        record.generation = randomUUID();
        write(file, record);
      }
    }
    // Keep the generation: it also identifies the user's isolated music logins.
    if (id === 'music-player' && catalog && record.pkg.version === '1.0.0' &&
        createHash('sha256').update(record.pkg.html.replace(/\r\n/g, '\n')).digest('hex') ===
          '17330b5da0632edd84375c731819dc384bc43825fdcc5d8c7b72b5e3c6fa6209') {
      const updated = catalog(id);
      if (updated.id === id && updated.version !== record.pkg.version) {
        record.pkg = updated;
        for (const [key, size] of Object.entries(record.placements ?? {})) {
          if (size[0] === 10 && size[1] === 2) record.placements[key] = [...updated.widgets[0].grid.preferred];
        }
        write(file, record);
      }
    }
    return record;
  }
  function list(owner) {
    const dir = directory(owner);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(name => /^app-.*\.json$/.test(name))
      .map(name => {
        const record = read(owner, name.slice(4, -5));
        return { ...metadata(record.pkg), generation: record.generation, pinned: record.pinned === true, placements: record.placements ?? {} };
      });
  }
  function install(owner, raw, previousGeneration) {
    const pkg = parsePackage(raw);
    const file = location(owner, pkg.id);
    if (fs.existsSync(file)) {
      const old = read(owner, pkg.id);
      if (previousGeneration !== old.generation || old.pkg.apiVersion !== 1) throw Error('This app ID is already installed.');
      write(file, { ...old, pkg, generation: randomUUID() });
      return metadata(pkg);
    }
    if (previousGeneration) throw Error('The previous installation changed.');
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
  function setWidget(owner, id, blockId, surface, size) {
    const record = read(owner, id);
    const block = record.pkg.widgets?.find(b => b.id === blockId && b.surfaces.includes(surface));
    if (!block) throw Error('Widget is unavailable on this surface.');
    const placements = { ...record.placements };
    const key = surface + '/' + blockId;
    if (size === null) delete placements[key];
    else {
      if (!Array.isArray(size) || size.length !== 2 || !size.every((n,i) => Number.isInteger(n) && n >= block.grid.min[i] && n <= block.grid.max[i])) throw Error('Widget size is outside its grid bounds.');
      placements[key] = size;
    }
    write(location(owner, id), { ...record, placements });
  }
  return { list, read, install, save, setPinned, setWidget, remove(owner, id) { fs.unlinkSync(location(owner, id)); } };
}
module.exports = { parsePackage, metadata, createStore, PACKAGE_BYTES, STATE_BYTES };
