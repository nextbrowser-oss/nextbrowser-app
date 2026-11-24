import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';
import { createRequire } from 'node:module';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const profile = await mkdtemp(path.join(tmpdir(), 'nb-mini-qa-'));
const pkg = JSON.parse(await readFile(path.join(root, 'electron/mini-apps/catalog/kanban.nbmini.json'), 'utf8'));
const second = path.join(profile, 'second.nbmini.json');
await writeFile(second, JSON.stringify({ ...pkg, name: 'Work board', id: 'work-board' }));
let app, page;
async function start() {
  const env = { ...process.env, NEXTBROWSER_DEV_DATA_ROOT: profile, NBC_AUTO_UPDATE: '0', NEXTBROWSER_ERROR_REPORTING: '0', NEXTBROWSER_DEVICE_REPORTING: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ args: [root, '--user-data-dir=' + path.join(profile, 'app')], executablePath: createRequire(import.meta.url)('electron'), env });
  page = await app.firstWindow();
  const url = new URL('dist/index.html', new URL('../', import.meta.url));
  url.searchParams.set('preview', 'main');
  await page.goto(url.href);
  await page.getByRole('button', { name: 'Open Mini Apps', exact: true }).click();
}
async function waitForBoard() {
  await until(() => board(() => document.getElementById('add')?.disabled === false));
}
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
  const downloaded = path.join(profile, 'download.nbmini.json');
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, downloaded);
  await page.getByRole('button', { name: 'Download package' }).click();
  await until(async () => JSON.parse(await readFile(downloaded, 'utf8')).html === pkg.html);
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await page.getByRole('button', { name: 'Install mini app', exact: true }).click();
  await waitForBoard();
  assert.equal(await board(() => typeof window.nextbrowser), 'undefined');
  assert.equal(await board(() => typeof window.require), 'undefined');
  const viewport = await page.locator('webview.mini-apps-guest').boundingBox();
  const addButton = await board(() => document.querySelector('#add').getBoundingClientRect().toJSON());
  await page.mouse.click(viewport.x + addButton.x + addButton.width / 2, viewport.y + addButton.y + addButton.height / 2);
  await until(() => board(() => document.activeElement.id === 'task-title'));
  await page.keyboard.type('Review mini apps');
  await page.keyboard.press('Enter');
  await waitForCard('Review mini apps');
  await board(() => {
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Edit').click();
    document.querySelector('#notes').value = 'Check the author guide';
    document.querySelector('#task-form').requestSubmit();
  });
  await until(async () => await board(() => document.querySelector('article p')?.textContent) === 'Check the author guide');
  await board(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Move to In progress').click());
  await until(async () => await board(() => document.querySelectorAll('.lane')[1].querySelector('strong')?.textContent) === 'Review mini apps');
  await page.getByLabel('Mini app package').setInputFiles(second);
  await page.getByRole('button', { name: 'Install mini app', exact: true }).click();
  await page.getByRole('heading', { name: 'Work board', exact: true }).waitFor();
  await waitForBoard();
  assert.equal(await board(() => document.querySelectorAll('.card').length), 0);
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await waitForCard('Review mini apps');
  await app.close();
  await start();
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await waitForCard('Review mini apps');
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
  await page.getByRole('button', { name: 'Install', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Kanban', exact: true }).count(), 0);
  console.log('Passed catalog and file installs, card creation and move, isolated guest state, switching, restart and uninstall.');
} catch (error) {
  if (page && !page.isClosed()) {
    console.error(await board(() => document.body.innerText).catch(() => 'Guest unavailable.'));
    console.error(await page.locator('.mini-apps').innerText({ timeout: 1000 }).catch(() => 'Mini Apps did not mount.'));
    console.error(await app.evaluate(({ webContents }) => webContents.getAllWebContents().map(w => ({ type: w.getType(), url: w.getURL() }))).catch(() => []));
  }
  throw error;
} finally { await app?.close(); }
