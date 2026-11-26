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
test('widget block manifests and saved placements respect their declared bounds and owner', t => {
  const store = createStore(fixture(t));
  const block = {id:'summary', name:'Summary', surfaces:['chat.panel'], grid:{min:[2,1], preferred:[4,2], max:[8,3]}};
  const sample = { ...pkg, id:'widget-test', widgets:[block], skill:'Read list_tasks to see the current board.' };
  for (const invalid of [{skill:''}, {widgets:[block, block]}, {widgets:[{...block,surfaces:['unregistered']}]},
    {widgets:[{...block,grid:{...block.grid,min:[5,1]}}]}]) assert.throws(() => parsePackage(JSON.stringify({...sample,...invalid})));
  store.install('one',JSON.stringify(sample));
  store.setWidget('one',sample.id,block.id,'chat.panel',[6,2]);
  assert.deepEqual(store.list('one')[0].placements,{'chat.panel/summary':[6,2]});
  assert.deepEqual(store.list('two'),[]);
  assert.throws(() => store.setWidget('one',sample.id,block.id,'settings.design',[6,2]));
  assert.throws(() => store.setWidget('one',sample.id,block.id,'chat.panel',[9,2]));
  store.setWidget('one',sample.id,block.id,'chat.panel',null);
  assert.deepEqual(store.list('one')[0].placements,{});
});
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-app-unit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('rail moves persist per owner, preserve catalog order and reject stale drop targets', t => {
  const root = fixture(t);
  const store = createStore(root);
  const ids = ['alpha', 'beta', 'gamma'];
  for (const owner of ['one', 'two']) {
    for (const id of ids) {
      store.install(owner, JSON.stringify({ ...pkg, id }));
      store.setPinned(owner, id, true);
    }
  }
  const rail = (owner, db = store) => db.list(owner).filter(app => app.pinned)
    .sort((a, b) => a.railIndex - b.railIndex).map(app => app.id);
  const [alpha, beta, gamma] = ids.map(id => store.read('one', id).generation);
  const originalList = store.list('one').map(app => app.id);
  store.movePinned('one', gamma, alpha, 'before');
  store.movePinned('one', alpha, beta, 'after');
  store.movePinned('one', alpha, beta, 'after');
  assert.deepEqual(rail('one', createStore(root)), ['gamma', 'beta', 'alpha']);
  assert.deepEqual(rail('two'), ids);
  assert.deepEqual(store.list('one').map(app => app.id), originalList);
  store.setPinned('one', 'beta', false);
  assert.throws(() => store.movePinned('one', alpha, beta, 'before'));
  store.setPinned('one', 'beta', true);
  assert.deepEqual(rail('one'), ['gamma', 'beta', 'alpha']);
  store.remove('one', 'gamma');
  store.install('one', JSON.stringify({ ...pkg, id: 'gamma' }));
  store.setPinned('one', 'gamma', true);
  assert.throws(() => store.movePinned('one', gamma, beta, 'before'));
  assert.deepEqual(rail('one'), ['beta', 'alpha', 'gamma']);
});
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
test('a catalog update requires the same listing and preserves account data', t => {
  const store = createStore(fixture(t));
  const id = 'published-board';
  const publication = 'c4ab1798-0116-40a9-96db-452540ead930';
  const packageAt = version => JSON.stringify({ ...pkg, id, version });
  store.install('reader', packageAt('1.0.0'), undefined, publication);
  const previous = store.read('reader', id).generation;
  store.save('reader', id, previous, 0, { cards: ['keep me'] });
  store.setPinned('reader', id, true);
  assert.throws(() => store.install('reader', packageAt('1.1.0'), previous, 'another-listing'));
  assert.throws(() => store.install('reader', packageAt('1.0.0'), previous, publication));
  assert.throws(() => store.install('reader', packageAt('0.9.0'), previous, publication));
  store.install('reader', packageAt('1.1.0'), previous, publication);
  const updated = store.read('reader', id);
  assert.equal(updated.pkg.version, '1.1.0');
  assert.equal(updated.sourcePublication, publication);
  assert.equal(updated.pinned, true);
  assert.deepEqual(updated.value, { cards: ['keep me'] });
  assert.notEqual(updated.generation, previous);
  assert.throws(() => store.install('reader', packageAt('1.2.0'), previous, publication));
  assert.deepEqual(store.list('another-account'), []);
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
