const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const {findSources,browserRoots} = require('./personal-sources.cjs');
const {personalCommand,ownerRoot,importProfile} = require('./personal-profiles.cjs');

test('discovery, partial imports, historical matches, account isolation and a changing source',async t => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(),'nb-discovery-'));
  t.after(() => fs.rm(tmp,{recursive:true,force:true}));
  const [chrome] = browserRoots('win32',tmp,{LOCALAPPDATA:tmp});
  const source = path.join(chrome.dir,'Profile 2');
  await fs.mkdir(source,{recursive:true});
  await fs.mkdir(path.join(chrome.dir,'System Profile'));
  await fs.mkdir(path.join(chrome.dir,'Default'));
  const writeBookmarks = text => fs.writeFile(path.join(source,'Bookmarks'),JSON.stringify({roots:{bookmark_bar:{type:'folder',children:[{type:'url',url:'https://fixture.invalid/'+text}]}}}));
  await writeBookmarks('first');
  const { DatabaseSync } = require('node:sqlite');
  const history = new DatabaseSync(path.join(source,'History'));
  history.exec('CREATE TABLE urls (id INTEGER); INSERT INTO urls VALUES (1)'); history.close();
  const bookmarksOnly = await findSources([chrome]);
  assert.deepEqual(bookmarksOnly.sources.map(s => s.name).sort(),['Default','Profile 2']);
  await fs.writeFile(path.join(source,'Preferences'),JSON.stringify({profile:{name:'Work'}}));
  const base = path.join(tmp,'personal');
  function client(owner) {
    const scope = {owner:'account/'+owner};
    return (action,args={}) => personalCommand({scope,base,current:()=>true,args,command:'personal_profiles_'+action,
      dialog:{showOpenDialog:async () => ({filePaths:[source]})}});
  }
  const user = client('one');
  let info = await user('choose_source');
  assert.equal(info.name,'Work (Profile 2)');
  assert.deepEqual(Object.keys(info.items).sort(),['bookmarks','history']);
  assert.equal(info.items.bookmarks.imported,false);
  const args = {sourceId:info.id,selected:['bookmarks'],name:'My source'};
  const both = await Promise.allSettled([user('import_source',args),user('import_source',args)]);
  assert.equal(both.filter(r => r.status === 'fulfilled').length,1);
  assert.equal((await user('list')).length,1);
  info = await client('one')('choose_source');
  assert.equal(info.items.bookmarks.imported,true); assert.equal(info.items.history.imported,false);
  await assert.rejects(user('import_source',args),/already been imported/);
  const other = client('two');
  assert.equal((await other('choose_source')).items.bookmarks.imported,false);
  // A profile from before the scanner has no source metadata.
  await importProfile(ownerRoot(base,'account/two'),source,'Older profile',['bookmarks']);
  assert.equal((await other('choose_source')).items.bookmarks.imported,true);
  await writeBookmarks('second-and-different');
  await assert.rejects(user('import_source',args),/changed/);
  info = await user('choose_source');
  assert.ok(info.items.bookmarks.updated && !info.items.bookmarks.imported);
  assert.equal((await other('choose_source')).items.bookmarks.imported,false);
  await fs.writeFile(path.join(source,'History-wal'),'test busy');
  assert.equal((await user('choose_source')).items.history.busy,true);
  await assert.rejects(user('import_source',{...args,selected:['history']}),/Close that browser/);
  await assert.rejects(user('import_source',{...args,sourceId:tmp}),/Scan again/);
});
