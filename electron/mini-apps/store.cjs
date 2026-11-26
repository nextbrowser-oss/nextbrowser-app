const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const PACKAGE_BYTES = 256 * 1024;
const STATE_BYTES = 128 * 1024;
const validId = id => typeof id === 'string' && /^[a-z][a-z0-9-]{1,47}$/.test(id);
const surfaces = ['chat.panel', 'settings.design'];
const shippedMusicHashes = new Map([
  ['1.3.0', '0d7f50038eacf1bb211b7b93939a602d9d198f8cc26acd41bdc0b43f2601e530'],
  ['1.2.1', '1cb81dae38648e885353e6b2d677ad39b4aac8376d899657597e621784d4e603'],
  ['1.0.0', '17330b5da0632edd84375c731819dc384bc43825fdcc5d8c7b72b5e3c6fa6209'],
  ['1.1.0', '5ba0c7eee033cfa264523868bea710ef2aa0fc0e87d4578c5720543c1ca6f256'],
  ['1.2.0', 'b4020af5eb0705aec51f513eb336edb08a81bb55ff8f4c2308f89c71917a3c3d'],
]);
// Add the HTML hash of each released SwipeForge version here when shipping the next one,
// so earlier installations upgrade in place and keep their connection.
const shippedSwipeForgeHashes = new Map([
  ['1.0.2', '8073bd1b7b7c604252f352b42b5da231834f6f887570f141eeff42acc07e1162'],
  ['1.0.1', 'e7b92caa3544d3c8a81db36fd7bd4bc1276327661783011ed960f4fc4c55caa9'],
  ['1.0.0', '982e10f059580c0ddc78c88cdd6d7d53d9debc9187c1c4c1fa43d04c480b10d3'],
]);
const shippedCatalogHashes = { 'music-player': shippedMusicHashes, swipeforge: shippedSwipeForgeHashes };
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
      (p.icon !== undefined && !['board', 'calendar', 'list', 'notebook', 'chart', 'grid', 'music', 'video', 'swipeforge'].includes(p.icon)) ||
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
    // Keep the generation: it also identifies the user's isolated music logins
    // and the SwipeForge connection.
    const shipped = Object.hasOwn(shippedCatalogHashes, id) ? shippedCatalogHashes[id] : undefined;
    if (shipped && catalog && shipped.has(record.pkg.version) &&
        createHash('sha256').update(record.pkg.html.replace(/\r\n/g, '\n')).digest('hex') ===
          shipped.get(record.pkg.version)) {
      const updated = catalog(id);
      if (updated.id === id && updated.version !== record.pkg.version) {
        const legacySize = id === 'music-player' && record.pkg.version === '1.0.0';
        record.pkg = updated;
        for (const [key, size] of Object.entries(record.placements ?? {})) {
          if (legacySize && size[0] === 10 && size[1] === 2) record.placements[key] = [...updated.widgets[0].grid.preferred];
        }
        write(file, record);
      }
    }
    return record;
  }
  function list(owner) {
    const dir = directory(owner);
    if (!fs.existsSync(dir)) return [];
    const orderFile = path.join(dir, 'rail-order.json');
    let order = [];
    if (fs.existsSync(orderFile)) {
      try {
        const saved = JSON.parse(fs.readFileSync(orderFile, 'utf8'));
        if (Array.isArray(saved)) order = saved;
      } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    }
    return fs.readdirSync(dir).filter(name => /^app-.*\.json$/.test(name))
      .map((name, index) => {
        const record = read(owner, name.slice(4, -5));
        const position = order.indexOf(record.generation);
        return { ...metadata(record.pkg), generation: record.generation, pinned: record.pinned === true,
          railIndex: position < 0 ? order.length + index : position, placements: record.placements ?? {} };
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
  function movePinned(owner, source, target, position) {
    if (position !== 'before' && position !== 'after') throw Error('Invalid rail position.');
    const apps = list(owner).sort((a, b) => a.railIndex - b.railIndex);
    const from = apps.findIndex(app => app.pinned && app.generation === source);
    const to = apps.findIndex(app => app.pinned && app.generation === target);
    if (from < 0 || to < 0) throw Error('The pinned apps have changed. Try moving the icon again.');
    if (from === to) return;
    const [moved] = apps.splice(from, 1);
    const insertAt = apps.findIndex(app => app.generation === target) + (position === 'after' ? 1 : 0);
    apps.splice(insertAt, 0, moved);
    write(path.join(directory(owner), 'rail-order.json'), apps.map(app => app.generation));
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
  return { list, read, install, save, setPinned, movePinned, setWidget, remove(owner, id) { fs.unlinkSync(location(owner, id)); } };
}
module.exports = { parsePackage, metadata, createStore, PACKAGE_BYTES, STATE_BYTES };
