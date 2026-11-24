import assert from 'node:assert/strict';
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
  const userDir = path.join(dest,imported.id,'browser');
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
  console.log('Passed native profile import, bookmarks, SQLite history, two restored tabs and unfinished database rollback.');
} finally {
  if (context) await context.close();
  server.close();
  await rm(temp,{force:true,recursive:true,maxRetries:5,retryDelay:150});
}
async function assertEventually(check) {
  for (let i=0; i<100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve,100)); }
  throw Error('Expected imported tab did not open in the native browser.');
}
