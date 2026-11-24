import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import profiles from '../electron/personal-profiles.cjs';
import browser from '../electron/personal-browser.cjs';

// Exercise a real Chromium session file, a real History DB, and a fresh profile.
// All visited URLs are served locally and neither browser uses the operator's data.
const temp = await mkdtemp(path.join(os.tmpdir(),'nextbrowser-import-e2e-'));
const server = createServer((_req,res) => { res.setHeader('Content-Type','text/html'); res.end('<title>Import fixture</title>'); });
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const executablePath = await browser.findBrowser();
const opts = { executablePath, headless:true, ignoreDefaultArgs:['about:blank'], args:['--disable-background-networking','--disable-sync','--disable-component-update'] };
let context;
try {
  const source = path.join(temp,'source');
  const dest = path.join(temp,'account');
  context = await chromium.launchPersistentContext(source,opts);
  const first = context.pages()[0] ?? await context.newPage();
  await first.goto(origin + '/history-only');
  await first.goto(origin + '/first');
  const second = await context.newPage();
  await second.goto(origin + '/second');
  await context.close(); context = undefined;
  const input = path.join(source,'Default');
  const node = { type:'url',name:'Saved fixture',url:origin+'/bookmarked',id:'4' };
  const folder = (id, children) => ({type:'folder', name:id, id, children});
  await writeFile(path.join(input,'Bookmarks'), JSON.stringify({version:1,roots:{bookmark_bar:folder('1',[node]),other:folder('2',[]),synced:folder('3',[])}}));
  const imported = await profiles.importProfile(dest,input,'Fixture',['history','tabs','bookmarks']);
  assert.deepEqual(imported.imported,['history','tabs','bookmarks']);
  const { archivePath, keyPath } = imported.backup;
  const archive = await readFile(archivePath);
  assert.ok(!archive.includes(Buffer.from('Fixture')) && !archive.includes(Buffer.from(origin)));
  assert.equal((await readFile(keyPath)).length,32);
  assert.ok(!path.relative(dest,keyPath).startsWith(imported.id));
  const recoveredRoot = path.join(temp,'restored-account');
  const wrongKey = path.join(temp,'other.nbkey');
  await writeFile(wrongKey,randomBytes(32));
  await assert.rejects(profiles.restoreProfile(recoveredRoot,archivePath,wrongKey,() => true),/Check the recovery key/);
  const invalidArchive = path.join(temp,'bad.nbarchive');
  const damaged = Buffer.from(archive);
  damaged[damaged.length - 1] ^= 1;
  for (const payload of [damaged,archive.subarray(0,archive.length - 19)]) {
    await writeFile(invalidArchive,payload);
    await assert.rejects(profiles.restoreProfile(recoveredRoot,invalidArchive,keyPath,() => true),/archive is intact/);
    assert.deepEqual(await readdir(recoveredRoot),[]);
  }
  const recovered = await profiles.restoreProfile(recoveredRoot,archivePath,keyPath,() => true);
  assert.deepEqual(recovered.imported,imported.imported);
  assert.equal(recovered.name,'Fixture');
  assert.notEqual(recovered.backup.keyPath,keyPath);
  // Profiles created by an earlier version or left pending by the browser wizard.
  const base = path.join(temp,'personal-profiles');
  const owner = 'account/archive-test';
  const legacyRoot = profiles.ownerRoot(base,owner);
  const legacyDir = path.join(legacyRoot,imported.id);
  const legacyBrowser = path.join(legacyDir,'browser','Default');
  await mkdir(legacyBrowser,{recursive:true});
  await writeFile(path.join(legacyBrowser,'Bookmarks'),await readFile(path.join(input,'Bookmarks')));
  await writeFile(path.join(legacyDir,'profile.json'),JSON.stringify({id:imported.id,name:'Wizard',kind:'personal',imported:[],pendingBackup:true}));
  const cmd = (action,scopeOwner=owner) => profiles.personalCommand({
    base,scope:{owner:scopeOwner},current:()=>true,command:'personal_profiles_'+ action,args:{id:imported.id}
  });
  assert.deepEqual(await cmd('list','account/other'),[]);
  const [backupA,backupB] = await Promise.all([cmd('backup'),cmd('backup')]);
  assert.equal(backupA.backup.archivePath,backupB.backup.archivePath);
  assert.equal(backupA.pendingBackup,false);
  assert.deepEqual(backupA.imported,['bookmarks']);
  assert.deepEqual(await cmd('list'),[backupA]);
  assert.deepEqual((await cmd('backup')).backup,backupA.backup);
  const userDir = path.join(recoveredRoot,recovered.id,'browser');
  const output = path.join(userDir,'Default');
  assert.deepEqual((await readdir(output)).sort(),['Bookmarks','History','Preferences','Sessions']);
  assert.equal(JSON.parse(await readFile(path.join(output,'Bookmarks'),'utf8')).roots.bookmark_bar.children[0].url,origin+'/bookmarked');
  context = await chromium.launchPersistentContext(userDir,{...opts,args:[...opts.args,'--restore-last-session']});
  await Promise.all(['/first','/second'].map(async suffix => {
    await assertEventually(() => context.pages().some(page => page.url() === origin+suffix));
  }));
  await context.close(); context = undefined;
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(output,'History'),{readOnly:true});
  try { assert.ok(db.prepare('SELECT visit_count FROM urls WHERE url = ?').get(origin+'/history-only').visit_count >= 1); } finally { db.close(); }
  const bad = path.join(temp,'incomplete');
  await mkdir(bad); await writeFile(path.join(bad,'History'),Buffer.from('SQLite format 3\0')); await writeFile(path.join(bad,'History-wal'),'pending');
  await assert.rejects(() => profiles.importProfile(dest,bad,'Retry',['history']),/Close that browser/);
  assert.deepEqual(await readdir(dest),[imported.id]);
  console.log('Passed encrypted local import and cross-account recovery of bookmarks, SQLite history and two Chromium tabs. Wrong keys, tampering and truncation left no restored profile.');
} finally {
  if (context) await context.close();
  server.close();
  await rm(temp,{force:true,recursive:true,maxRetries:5,retryDelay:150});
}
async function assertEventually(check) {
  for (let i=0; i<100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve,100)); }
  throw Error('Expected imported tab did not open in the native browser.');
}
