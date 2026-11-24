const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { parsePackage, createStore } = require('./mini-apps/store.cjs');
const catalogPath = path.join(__dirname, 'mini-apps/catalog/kanban.nbmini.json');
const raw = fs.readFileSync(catalogPath, 'utf8');
const pkg = parsePackage(raw);
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-app-unit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('the catalog ships the reproducible standalone Kanban project', t => {
  const output = path.join(fixture(t), 'kanban.json');
  execFileSync(process.execPath, [path.join(__dirname, '../examples/kanban-mini-app/build.mjs'), output]);
  assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), pkg);
});
test('unsupported packages cannot be installed and duplicate IDs preserve state', t => {
  const store = createStore(fixture(t));
  for (const bad of [{apiVersion: 1}, {tools: []}, {tools: ['duplicate','duplicate']}, {id: '../board'}, {permissions: ['desktop']}, {extra: true}, {html: 'x'.repeat(262144)}]) {
    assert.throws(() => store.install('a', JSON.stringify({ ...pkg, ...bad })));
  }
  store.install('a', raw);
  assert.throws(() => store.install('a', raw), /already installed/);
  assert.deepEqual(store.list('b'), []);
});
test('state writes are bounded, scoped and reject a stale revision or installation', t => {
  const store = createStore(fixture(t));
  store.install('a', raw);
  store.install('b', raw);
  const { generation } = store.read('a', pkg.id);
  assert.equal(store.save('a', pkg.id, generation, 0, { cards: [1] }), true);
  assert.equal(store.save('a', pkg.id, generation, 0, null), false);
  assert.throws(() => store.save('a', pkg.id, generation, 1, 'x'.repeat(131072)));
  assert.equal(store.read('b', pkg.id).value, null);
  assert.throws(() => store.save('b', pkg.id, generation, 0, 1));
  store.remove('a', pkg.id);
  store.install('a', raw);
  assert.throws(() => store.save('a', pkg.id, generation, 0, 'old'));
  store.install('a', JSON.stringify({ ...pkg, id: 'viewer', permissions: [] }));
  assert.throws(() => store.save('a', 'viewer', store.read('a', 'viewer').generation, 0, 'x'));
});
test('a v1 upgrade preserves state and pinning and invalidates the old installation handle', t => {
  const root = fixture(t);
  const store = createStore(root);
  const owner = 'example';
  const id = 'team-board';
  const dir = path.join(root, require('node:crypto').createHash('sha256').update(owner).digest('hex'));
  fs.mkdirSync(dir);
  const legacy = { pkg: { ...pkg, apiVersion: 1, id }, generation: 'legacy', revision: 9, value: { cards: [42] }, pinned: true };
  delete legacy.pkg.tools;
  fs.writeFileSync(path.join(dir, 'app-' + id + '.json'), JSON.stringify(legacy));
  assert.equal(store.list(owner)[0].apiVersion, 1);
  const replacement = JSON.stringify({ ...pkg, id });
  assert.throws(() => store.install(owner, replacement, 'stale'), /already installed/);
  store.install(owner, replacement, 'legacy');
  const current = store.read(owner, id);
  assert.equal(current.pkg.apiVersion, 2);
  assert.equal(current.revision, 9);
  assert.equal(current.pinned, true);
  assert.deepEqual(current.value, legacy.value);
  assert.notEqual(current.generation, 'legacy');
  assert.throws(() => store.save(owner, id, 'legacy', 9, null), /unavailable/);
});
