import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';
import { createServer } from 'vite';
import sources from '../electron/personal-sources.cjs';

const root = path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const fixture = await mkdtemp(path.join(tmpdir(),'nb-account-ui-'));
const scanEnv = {LOCALAPPDATA:fixture,APPDATA:fixture,XDG_CONFIG_HOME:fixture,HOME:fixture,USERPROFILE:fixture};
const source = path.join(sources.browserRoots(process.platform,fixture,scanEnv)[0].dir,'Default');
await mkdir(source,{recursive:true});
const { DatabaseSync } = await import('node:sqlite');
const fixtureHistory = new DatabaseSync(path.join(source,'History'));
fixtureHistory.exec('CREATE TABLE urls (id INTEGER); INSERT INTO urls VALUES (1)'); fixtureHistory.close();
await writeFile(path.join(source,'Bookmarks'),JSON.stringify({version:1,roots:{bookmark_bar:{type:'folder',id:'1',children:[{type:'url',name:'Test',url:'https://example.test/'}]}}}));
const modules = await realpath(path.join(root,'node_modules'));
const server = await createServer({root,server:{host:'127.0.0.1',port:0,fs:{allow:[root,modules]}},logLevel:'error'});
let app;
try {
  await server.listen();
  const url = server.resolvedUrls.local[0] + '?preview=main';
  const env = {...process.env,VITE_DEV_SERVER_URL:url,NEXTBROWSER_DEV_DATA_ROOT:fixture,NBC_AUTO_UPDATE:'0',NEXTBROWSER_ERROR_REPORTING:'0',NEXTBROWSER_DEVICE_REPORTING:'0'};
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({args:[root,'--user-data-dir=' + path.join(fixture,'app')],executablePath:createRequire(import.meta.url)('electron'),env,timeout:20000});
  const page = await app.firstWindow({timeout:20000});
  page.setDefaultTimeout(14000);
  await page.locator('.app > .sidebar').waitFor();
  await page.evaluate(async () => {
    const {useStore} = await import('/src/store.ts');
    useStore.setState({accountOwnerId:'account-ui-fixture',tab:'account'});
  });
  await page.getByRole('heading',{name:'My account'}).waitFor();
  await page.getByRole('heading',{name:'Time in Nextbrowser'}).waitFor();
  await page.getByRole('heading',{name:'Visits',exact:true}).waitFor();
  assert.equal(await page.locator('.account-trend svg:visible').count(),2);
  assert.equal(await page.locator('.account-trend g[tabindex]').count(),2, 'each chart shows its one recorded day');
  assert.equal(await page.locator('.tabbar:visible,.main-view-navigation:visible,.content > .divider:visible').count(),0);
  const activityHeight = await page.locator('.account-activity-grid').evaluate(el => el.getBoundingClientRect().height);
  assert.ok(activityHeight < 80, `activity summary occupies ${activityHeight}px`);
  await page.evaluate(async () => {
    const { localDay } = await import('/src/lib/accountActivity.ts');
    const { settingsStorage } = await import('/src/lib/settingsStorage.ts');
    const { useStore } = await import('/src/store.ts');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const first = localDay(yesterday.getTime());
    const today = localDay(Date.now());
    settingsStorage.setItem('nextbrowser.accountActivity.account-history-fixture',JSON.stringify({
      first, lastVisit:Date.now(), days:{[first]:{ms:120000,sessions:2},[today]:{ms:60000,sessions:1}},
    }));
    useStore.setState({accountOwnerId:'account-history-fixture'});
  });
  const visits = page.getByRole('region',{name:'Visits',exact:true});
  await visits.getByRole('group',{name:'Visits by day'}).locator('g[tabindex]').first().focus();
  assert.equal(await visits.locator('b').innerText(),'2');
  await app.evaluate((_electron,env) => { Object.assign(process.env,env); },scanEnv);
  await page.getByRole('button',{name:'Import browser data'}).click();
  await page.getByText('Chrome · Default',{exact:true}).waitFor();
  const bookmarks = page.getByRole('checkbox',{name:'Bookmarks',exact:true});
  assert.equal(await bookmarks.isChecked(),false);
  assert.equal(await page.getByRole('checkbox',{name:'Browsing and download history'}).isEnabled(),true);
  assert.equal(await page.getByRole('checkbox',{name:'Open tabs'}).isDisabled(),true);
  await page.getByLabel('New personal profile name').fill('Local fixture');
  await bookmarks.check();
  await page.getByRole('button',{name:'Import selected data'}).click();
  await page.getByText('Personal · This device',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Open profile',exact:true}).count(),1);
  assert.match(await page.locator('.personal-profiles [role=status]').innerText(),/Imported: Bookmarks/);
  await page.getByText('Imported',{exact:true}).waitFor();
  assert.ok(await bookmarks.isChecked() && await bookmarks.isDisabled());
  await page.getByRole('button',{name:'Close import'}).click();
  const recovery = page.getByRole('region',{name:'Recovery files'});
  await recovery.waitFor();
  const paths = await recovery.locator('code').allTextContents();
  assert.match(paths[0],/\.nbarchive$/); assert.match(paths[1],/\.nbkey$/);
  await app.evaluate(({dialog},files) => { dialog.showOpenDialog = async (_window,opts) => ({canceled:false,filePaths:[files[opts.filters[0].extensions[0] === 'nbkey' ? 1 : 0]]}); },paths);
  await page.getByRole('button',{name:'Import browser data'}).click();
  await page.getByText('Imported',{exact:true}).waitFor();
  assert.ok(await bookmarks.isChecked() && await bookmarks.isDisabled());
  assert.ok(await page.getByRole('button',{name:'Import selected data'}).isDisabled());
  await page.getByRole('button',{name:'Restore from archive…'}).click();
  await page.getByText('Restored into a separate personal profile.').waitFor();
  assert.equal(await page.getByRole('button',{name:'Open profile',exact:true}).count(),2);
  const backdrop = await page.evaluate(() => {
    document.documentElement.style.setProperty('--chat-bg','#314b58');
    document.documentElement.style.setProperty('--chat-wallpaper','radial-gradient(circle, red 1px, transparent 1px)');
    const css = node => getComputedStyle(document.querySelector(node));
    return [css('.desktop-shell').backgroundColor,css('.desktop-shell').backgroundImage,css('.app > .content').backgroundColor,css('.app-titlebar').backgroundColor];
  });
  assert.equal(backdrop[0],'rgb(49, 75, 88)');
  assert.match(backdrop[1],/radial-gradient/);
  assert.deepEqual(backdrop.slice(2),['rgba(0, 0, 0, 0)','rgba(0, 0, 0, 0)']);
  await page.getByRole('button',{name:/^Settings(, update available)?$/}).click();
  await page.locator('.settings-modal').waitFor();
  assert.equal(await page.locator('.tabbar:visible,.main-view-navigation:visible').count(),0);
  assert.match(await page.locator('.settings-modal').evaluate(el => getComputedStyle(el).backgroundImage),/radial-gradient/);
  console.log('Passed account charts, automatic discovery, selected encrypted import, persistent checkbox state, archive recovery, wallpaper and settings navigation.');
} finally {
  try { await app?.close(); } finally { await server.close(); await rm(fixture,{force:true,recursive:true,maxRetries:5,retryDelay:150}); }
}
