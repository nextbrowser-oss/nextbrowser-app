import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';
import { createRequire } from 'node:module';
import { checkMiniAppAgent } from './test-mini-app-agent.mjs';
import { checkMusicWidget } from './test-music-widget.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const profile = await mkdtemp(path.join(tmpdir(), 'nb-mini-qa-'));
const pkg = JSON.parse(await readFile(path.join(root, 'electron/mini-apps/catalog/kanban.nbmini.json'), 'utf8'));
const second = path.join(profile, 'second.nbmini.json');
await writeFile(second, JSON.stringify({ ...pkg, name: 'Work board', id: 'work-board', icon: 'notebook' }));
let app, page;
async function start() {
  const env = { ...process.env, NEXTBROWSER_DEV_DATA_ROOT: profile, NBC_AUTO_UPDATE: '0', NEXTBROWSER_ERROR_REPORTING: '0', NEXTBROWSER_DEVICE_REPORTING: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ args: [root, '--user-data-dir=' + path.join(profile, 'app')], executablePath: createRequire(import.meta.url)('electron'), env });
  page = await app.firstWindow();
  const url = new URL('dist/index.html', new URL('../', import.meta.url));
  url.searchParams.set('preview', 'main');
  await page.goto(url.href);
  await page.getByRole('button', { name: 'Open Extensions', exact: true }).click();
  await page.getByRole('dialog', { name: 'Extensions' }).getByRole('button', { name: 'Open Mini Apps', exact: true }).click();
}
async function waitForBoard() {
  await until(() => board(() => document.getElementById('add')?.disabled === false));
}
async function checkWindowLayout(railVisible = true) {
  const area = page.locator('.desktop-shell-body');
  const guest = page.locator('webview.mini-apps-guest');
  const rail = page.locator('#app-sidebar');
  await until(async () => {
    const [content, view, sidebar] = await Promise.all([area.boundingBox(), guest.boundingBox(), rail.boundingBox()]);
    if (!content || !view || Boolean(sidebar) !== railVisible) return false;
    return (sidebar ? view.x >= sidebar.x + sidebar.width - 1 : Math.abs(content.x - view.x) <= 1)
      && Math.abs(content.x + content.width - view.x - view.width) <= 1
      && Math.abs(content.y - view.y) <= 1 && Math.abs(content.height - view.height) <= 1;
  });
  const toggle = page.getByRole('button', { name: railVisible ? 'Hide navigation rail' : 'Show navigation rail' });
  assert.equal(await toggle.getAttribute('aria-expanded'), String(railVisible));
  assert.equal(await page.getByRole('navigation', { name: 'Installed mini apps' }).isVisible(), false);
  assert.equal(await page.getByRole('button', { name: 'Back to Mini Apps' }).isVisible(), true);
}
async function backToCatalog() {
  await page.getByRole('button', { name: 'Back to Mini Apps' }).click();
  await catalogCard('Kanban').getByRole('button', { name: 'Download package' }).waitFor();
  assert.equal(await page.locator('#app-sidebar').isVisible(), true);
}
const catalogCard = name => page.locator('.mini-apps-catalog article').filter({has:page.getByRole('heading',{name,exact:true})});
async function until(check) {
  const deadline = Date.now() + 15000;
  do {
    if (await check().catch(() => false)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw Error('Timed out waiting for the guest UI.');
}
async function board(fn) {
  return page.locator('webview.mini-apps-guest').evaluate((guest, script) => guest.executeJavaScript(script), '(' + fn.toString() + ')()');
}
async function waitForCard(text) {
  await until(async () => await board(() => document.querySelector('article strong')?.textContent) === text);
}
try {
  await start();
  const install = raw => page.evaluate(raw => window.nextbrowser.invoke('mini_apps_install', { owner: 'preview', raw }), JSON.stringify(raw));
  for (const tools of [pkg.tools.slice(1), [...pkg.tools, 'unimplemented_action']]) {
    await assert.rejects(install({ ...pkg, id: 'invalid-board', tools }), /register every declared WebMCP tool/);
  }
  const guide = await readFile(path.join(root, 'docs/mini-apps.md'), 'utf8');
  const counter = JSON.parse(guide.match(/`{3}json\s*([\s\S]*?)`{3}/)[1]);
  await install(counter);
  const library = await page.evaluate(() => window.nextbrowser.invoke('mini_apps_list', { owner: 'preview' }));
  assert.deepEqual(library.installed.map(app => app.id), ['counter']);
  await page.evaluate(() => window.nextbrowser.invoke('mini_apps_remove', { owner: 'preview', id: 'counter' }));
  console.log('Passed rejection of missing and extra handlers and installation of the documented counter.');
  const downloaded = path.join(profile, 'download.nbmini.json');
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, downloaded);
  await catalogCard('Kanban').getByRole('button', { name: 'Download package' }).click();
  await until(async () => JSON.parse(await readFile(downloaded, 'utf8')).html === pkg.html);
  await catalogCard('Kanban').getByRole('button', { name: 'Install', exact: true }).click();
  await page.getByRole('button', { name: 'Install mini app', exact: true }).click();
  await waitForBoard();
  await checkWindowLayout();
  if (process.env.NEXTCTL_BIN) {
    await backToCatalog();
    await checkMiniAppAgent(page);
  } else console.log('Set NEXTCTL_BIN to include the full agent-to-WebMCP turn test.');
  const guestId = () => page.locator('webview.mini-apps-guest').evaluate(view => view.getWebContentsId());
  const originalGuest = await guestId();
  await page.getByRole('button', { name: 'Hide navigation rail' }).click();
  await checkWindowLayout(false);
  await page.getByRole('button', { name: 'Show navigation rail' }).click();
  await checkWindowLayout();
  assert.equal(await guestId(), originalGuest);
  const initialWidth = await page.evaluate(() => innerWidth);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1050, 700));
  await until(async () => await page.evaluate(() => innerWidth) !== initialWidth);
  await checkWindowLayout();
  const pin = () => page.getByRole('switch', { name: 'Show in rail' });
  const shortcut = name => page.getByRole('button', { name: 'Open pinned app ' + name, exact: true });
  assert.equal(await pin().isChecked(), false);
  assert.equal(await shortcut('Kanban').count(), 0);
  await pin().check();
  await backToCatalog();
  await shortcut('Kanban').waitFor();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await waitForBoard();
  await checkWindowLayout();
  assert.equal(await board(() => typeof window.nextbrowser), 'undefined');
  assert.equal(await board(() => typeof window.require), 'undefined');
  const viewport = await page.locator('webview.mini-apps-guest').boundingBox();
  const addButton = await board(() => document.querySelector('#add').getBoundingClientRect().toJSON());
  await page.mouse.click(viewport.x + addButton.x + addButton.width / 2, viewport.y + addButton.y + addButton.height / 2);
  await until(() => board(() => document.activeElement.id === 'task-title'));
  // A webview owns a separate Chromium input target from the Playwright host page.
  await app.evaluate(async ({ webContents }) => {
    const guest = webContents.getAllWebContents().find(contents => contents.getType() === 'webview' && contents.getURL() === 'https://mini-app.invalid/index.html');
    await guest.insertText('Review mini apps');
  });
  const saveButton = await board(() => document.querySelector('button[type=submit]').getBoundingClientRect().toJSON());
  await page.mouse.click(viewport.x + saveButton.x + saveButton.width / 2, viewport.y + saveButton.y + saveButton.height / 2);
  await waitForCard('Review mini apps');
  await board(() => {
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Edit').click();
    document.querySelector('#notes').value = 'Check the author guide';
    document.querySelector('#task-form').requestSubmit();
  });
  await until(async () => await board(() => document.querySelector('article p')?.textContent) === 'Check the author guide');
  await board(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Move to In progress').click());
  await until(async () => await board(() => document.querySelectorAll('.lane')[1].querySelector('strong')?.textContent) === 'Review mini apps');
  await backToCatalog();
  await page.getByLabel('Mini app package').setInputFiles(second);
  await page.getByRole('button', { name: 'Install mini app', exact: true }).click();
  await page.getByRole('heading', { name: 'Work board', exact: true }).waitFor();
  await waitForBoard();
  assert.equal(await board(() => document.querySelectorAll('.card').length), 0);
  assert.equal(await pin().isChecked(), false);
  await pin().check();
  await backToCatalog();
  await shortcut('Work board').waitFor();
  await shortcut('Work board').click();
  await waitForBoard();
  await checkWindowLayout();
  await pin().uncheck();
  await backToCatalog();
  await shortcut('Work board').waitFor({ state: 'detached' });
  await shortcut('Kanban').click();
  await waitForCard('Review mini apps');
  await checkWindowLayout();
  await page.getByRole('button', { name: 'Hide navigation rail' }).click();
  await checkWindowLayout(false);
  await app.close();
  await start();
  await page.getByRole('button', { name: 'Open Extensions', exact: true }).click();
  await page.getByRole('dialog', { name: 'Extensions' }).getByRole('button', { name: /^Open Skills/ }).click();
  await shortcut('Kanban').click();
  await waitForCard('Review mini apps');
  assert.equal(await pin().isChecked(), true);
  await checkWindowLayout(false);
  await page.getByRole('button', { name: 'Show navigation rail' }).click();
  await checkWindowLayout();
  if (process.env.MINI_APP_SCREENSHOT) {
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
    await writeFile(process.env.MINI_APP_SCREENSHOT, Buffer.from(png, 'base64'));
  }
  await board(() => {
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Delete').click();
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Confirm delete').click();
  });
  await until(async () => await board(() => document.querySelector('#counts').textContent === '0 tasks'));
  await page.getByRole('button', { name: 'Uninstall', exact: true }).click();
  await page.getByRole('button', { name: 'Uninstall and delete data' }).click();
  await catalogCard('Kanban').getByRole('button', { name: 'Install', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Kanban', exact: true }).count(), 0);
  await shortcut('Kanban').waitFor({ state: 'detached' });
  await checkMusicWidget(app, page, path.join(profile,'music.nbmini.json'));
  console.log('Passed catalog and file installs, card creation and move, isolated guest state, switching, restart and uninstall.');
} catch (error) {
  if (page && !page.isClosed()) {
    console.error(await board(() => document.body.innerText).catch(() => 'Guest unavailable.'));
    console.error(await page.locator('.mini-apps').innerText({ timeout: 1000 }).catch(() => 'Mini Apps did not mount.'));
    console.error(await app.evaluate(({ webContents }) => webContents.getAllWebContents().map(w => ({ type: w.getType(), url: w.getURL() }))).catch(() => []));
  }
  throw error;
} finally { await app?.close(); }
