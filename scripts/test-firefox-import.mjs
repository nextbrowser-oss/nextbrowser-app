import assert from 'node:assert/strict';
import { access,mkdtemp,mkdir,readFile,rm,writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import sources from '../electron/personal-sources.cjs';
import profiles from '../electron/personal-profiles.cjs';
import browser from '../electron/personal-browser.cjs';

const root = await mkdtemp(path.join(tmpdir(),'nextbrowser-firefox-test-'));
const server = createServer((_req,res) => res.end('test'));
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const host = 'http://127.0.0.1:'+server.address().port;
let context;
try {
  const registry = path.join(root,'Firefox');
  const dir = path.join(registry,'Profiles','xy.work');
  const alternate = path.join(root,'portable');
  await mkdir(dir,{recursive:true});
  await mkdir(alternate);
  await writeFile(path.join(registry,'profiles.ini'),[
    '[Profile1]','Name=Work','IsRelative=1','Path=Profiles/xy.work','[Profile2]','Name=Portable','IsRelative=0','Path='+alternate,
    '[Install111]','Default=Profiles/xy.work','[Profile3]','Path=Profiles/gone',
  ].join('\n'));
  const db = new DatabaseSync(path.join(dir,'places.sqlite'));
  db.exec('CREATE TABLE moz_places(id INTEGER PRIMARY KEY,url TEXT,title TEXT); CREATE TABLE moz_bookmarks(id INTEGER PRIMARY KEY,parent INTEGER,type INTEGER,position INTEGER,title TEXT,guid TEXT,dateAdded INTEGER,lastModified INTEGER,fk INTEGER); CREATE TABLE moz_historyvisits(id INTEGER PRIMARY KEY,place_id INTEGER,visit_type INTEGER,visit_date INTEGER)');
  db.prepare('INSERT INTO moz_places VALUES(1,?,?)').run(host+'/saved','Bookmark');
  db.prepare('INSERT INTO moz_places VALUES(2,?,?)').run(host+'/past','Page title');
  db.prepare('INSERT INTO moz_places VALUES(3,?,?)').run(host+'/download','Download');
  db.exec("INSERT INTO moz_bookmarks VALUES(1,0,2,0,'toolbar','toolbar_____',0,0,NULL),(2,1,2,0,'Research','test-folder',0,0,NULL),(3,2,1,0,'Saved example','test-bookmark',4,5,1); INSERT INTO moz_historyvisits VALUES(1,2,2,1700000000000000),(2,2,1,1700000001000000),(3,3,7,1700000002000000)");
  db.close();
  const session = JSON.stringify({padding:'aaaaaaaaa',windows:[{tabs:[{index:2,entries:[{url:host+'/old'},{url:host+'/open',formdata:'private-text'}]},
    {entries:[{url:'about:preferences'}]},{entries:[{url:'https://user:password@example.test/'}]}]},
    {isPrivate:true,tabs:[{entries:[{url:host+'/private'}]}]}]});
  const bytes = Buffer.from(session), header = Buffer.alloc(12);
  header.write('mozLz40\0'); header.writeUInt32LE(bytes.length,8);
  // Nine repeated bytes are one literal plus an eight-byte overlapping match.
  const prefix = bytes.indexOf('aaaaaaaaa')+1;
  const first = Buffer.concat([Buffer.from([(prefix << 4) | 4]),bytes.subarray(0,prefix),Buffer.from([1,0])]);
  const remaining = bytes.subarray(prefix+8);
  const lengths = [0xf0];
  let tail = remaining.length-15;
  while (tail>=255) {lengths.push(255); tail-=255;}
  lengths.push(tail);
  await mkdir(path.join(dir,'sessionstore-backups'));
  await writeFile(path.join(dir,'sessionstore-backups','recovery.jsonlz4'),Buffer.concat([header,first,Buffer.from(lengths),remaining]));
  await writeFile(path.join(dir,'cookies.sqlite'),'unrelated cookie');
  const found = await sources.findSources([{dir:registry,browser:'Firefox'}]);
  assert.deepEqual(found.sources.map(p=>p.name),['Work','Portable']);
  assert.deepEqual(found.unavailable,[]);
  const scope = {owner:'account/test'};
  const cmd = (action,args={}) => profiles.personalCommand({base:root,scope,current:()=>true,args,command:'personal_profiles_'+action,
    dialog:{showOpenDialog:async()=>({filePaths:[dir],canceled:false})}});
  let info = await cmd('choose_source');
  assert.equal(info.browser,'Firefox');
  assert.deepEqual(Object.keys(info.items).sort(),['bookmarks','history','tabs']);
  const selected = ['bookmarks','history','tabs'];
  const imported = await cmd('import_source',{sourceId:info.id,name:'Firefox fixture',selected});
  assert.deepEqual(imported.imported,selected);
  info = await cmd('choose_source'); assert.ok(Object.values(info.items).every(s=>s.imported));
  await assert.rejects(cmd('import_source',{sourceId:info.id,name:'dup',selected}),/already been imported/);
  const restoredRoot = path.join(root,'restore');
  const result = await profiles.restoreProfile(restoredRoot,imported.backup.archivePath,imported.backup.keyPath,()=>true);
  const profileDir = path.join(restoredRoot,result.id,'browser');
  const output = path.join(profileDir,'Default');
  const tree = JSON.parse(await readFile(path.join(output,'Bookmarks'),'utf8'));
  assert.equal(tree.roots.bookmark_bar.children[0].children[0].url,host+'/saved');
  context = await chromium.launchPersistentContext(profileDir,{executablePath:await browser.findBrowser(),headless:true,
    ignoreDefaultArgs:['about:blank'],args:['--restore-last-session','--disable-background-networking']});
  await Promise.any(context.pages().map(page => page.waitForURL(host+'/open',{timeout:10000})));
  assert.ok(!context.pages().some(p=>p.url().includes('/private') || p.url().includes('/old')));
  await context.close(); context = undefined;
  const history = new DatabaseSync(path.join(output,'History'),{readOnly:true});
  try {
    const row = history.prepare('SELECT title,visit_count,typed_count FROM urls WHERE url=?').get(host+'/past');
    assert.deepEqual({...row},{title:'Page title',visit_count:2,typed_count:1});
    assert.equal(history.prepare('SELECT COUNT(*) AS n FROM visits v JOIN urls u ON u.id=v.url WHERE u.url=?').get(host+'/past').n,2);
    assert.equal(history.prepare('SELECT id FROM urls WHERE url=?').get(host+'/download'),undefined);
  } finally { history.close(); }
  console.log('Passed Firefox registry, bookmarks, visit history, live-session LZ4, receipts, encrypted recovery and restored tab in Chromium.');
  const nativePaths = [process.env.FIREFOX_BIN,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles,'Mozilla Firefox','firefox.exe'),
    '/Applications/Firefox.app/Contents/MacOS/firefox','/usr/bin/firefox'].filter(Boolean);
  for (const binary of nativePaths) {
    if (!await access(binary).then(()=>true,()=>false)) continue;
    const nativeDir = path.join(root,'native-firefox');
    await mkdir(nativeDir);
    await promisify(execFile)(binary,['-wait-for-browser','-no-remote','-headless','-profile',nativeDir,'-screenshot',path.join(root,'fixture.png'),host+'/native'],
      {windowsHide:true,timeout:45000,env:{...process.env,MOZ_CRASHREPORTER_DISABLE:'1'}});
    await access(path.join(root,'fixture.png'));
    const native = await sources.inspectSource(nativeDir,'Selected folder');
    assert.equal(native.browser,'Firefox');
    const places = new DatabaseSync(path.join(nativeDir,'places.sqlite'));
    try {
      assert.ok(places.prepare("SELECT id FROM moz_bookmarks WHERE guid='toolbar_____'").get());
      const id = places.prepare("INSERT INTO moz_places(url,title,guid) VALUES(?,?,'NextBrowser1_')").run(host+'/native-history','Firefox page').lastInsertRowid;
      places.prepare('INSERT INTO moz_historyvisits(place_id,visit_type,visit_date) VALUES(?,1,1700000002000000)').run(id);
    } finally { places.close(); }
    const scanned = await sources.inspectSource(nativeDir,'Selected folder');
    assert.ok(scanned.items.history?.version && !scanned.items.history.unreadable);
    console.log('Isolated profile created by installed Firefox: scanner recognizes native Places schema and visit.');
    break;
  }
} finally {
  await context?.close(); server.close();
  await rm(root,{force:true,recursive:true,maxRetries:8,retryDelay:150});
}
