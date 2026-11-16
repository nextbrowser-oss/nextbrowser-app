import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import serverModule from '../electron/start-page-server.cjs';

const temporary = await mkdtemp(path.join(os.tmpdir(), 'nextbrowser-start-ui-'));
const calls = [];
let theme = 'dark';
const server = serverModule.createStartPageServer({ distDir: path.resolve('dist'), storageDir: temporary, requestDesktop: async (_, action) => {
  calls.push(action);
  if (action.type === 'draft' || action.type === 'resume') return { opened: true };
  return { profile: 'Research profile', workspace: 'Product research', runtime: 'ClawBrowser', theme, agent: 'Codex', connection: 'Personal proxy', country: 'US', ip: '203.0.113.2', verified: true, status: 'running',
    sessions: [{ id: 'test-research', title: 'Compare product options', updatedAt: 1794800000000, preview: 'Compare the available options and collect a shortlist with sources.', messages: 12 }] };
} });
let browser;
try {
  const url = await server.open({ sender: { isDestroyed: () => false }, workspaceId: 'ui-test', runtime: 'clawbrowser', profile: 'test' });
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || (process.platform === 'win32' ? path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe') : '/usr/bin/google-chrome'), headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const external = [];
  await page.route('**/*', route => {
    if (route.request().url().startsWith(new URL(url).origin)) return route.continue();
    external.push(route.request().url()); return route.fulfill({ contentType: 'text/plain', body: 'Navigation test target' });
  });
  await page.goto(url);
  await page.getByRole('heading', { name: 'Continue where you left off' }).waitFor();
  for (const [name, site] of [['Documentation', 'https://example.com/docs'], ['Workspace', 'https://example.org/'], ['Research', 'https://example.net/']]) {
    await page.getByRole('button', { name: /Add a site/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a site' });
    await dialog.getByLabel('Name', { exact: true }).fill(name);
    await dialog.getByLabel('Website', { exact: true }).fill(site);
    await dialog.getByRole('button', { name: 'Save shortcut' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByRole('link', { name: new RegExp(name) }).waitFor();
  }
  await page.reload();
  await page.getByRole('link', { name: /Documentation/ }).waitFor();
  await page.getByRole('button', { name: 'Options for Documentation' }).focus();
  await page.getByRole('button', { name: 'Options for Documentation' }).click();
  await page.getByRole('button', { name: 'Move later' }).click();
  await page.waitForFunction(() => document.querySelector('.start-pin strong')?.textContent === 'Workspace');
  await page.locator('.start-pin').filter({ hasText: 'Research' }).dragTo(page.locator('.start-pin').filter({ hasText: 'Workspace' }));
  await page.waitForFunction(() => document.querySelector('.start-pin strong')?.textContent === 'Research');
  await page.getByRole('tab', { name: 'Ask your agent' }).click();
  await page.getByRole('textbox', { name: 'Task for your agent' }).fill('Collect sources for the article');
  await page.getByRole('button', { name: 'Continue in chat' }).click();
  await page.getByText('Your draft is ready in Nextbrowser chat.').waitFor();
  assert.ok(calls.some(c => c.type === 'draft' && c.text === 'Collect sources for the article'));
  await page.getByRole('button', { name: /Compare product options/ }).click();
  await page.getByText('Session opened in Nextbrowser.').waitFor();
  assert.ok(calls.some(c => c.type === 'resume' && c.id === 'test-research'));
  await page.getByRole('button', { name: 'Research profile', exact: true }).click();
  await page.getByText('203.0.113.2', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Refresh browser status' }).click();
  await page.getByText('Browser status updated.', { exact: false }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(external.length, 0, 'no third-party requests until the user navigates');
  await mkdir('e2e-out', { recursive: true });
  for (theme of ['dark', 'light']) {
    await page.reload();
    await page.getByRole('link', { name: /Documentation/ }).waitFor();
    await page.screenshot({ path: `e2e-out/start-page-${theme}.png`, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'e2e-out/start-page-mobile.png', fullPage: true });
  await page.getByRole('textbox', { name: 'Search or enter an address' }).fill('release notes');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.waitForURL('https://www.google.com/search?q=release%20notes');
  assert.deepEqual(errors, []);
  console.log('Start page passed: saved shortcuts, keyboard reorder, drag/drop, agent draft, resume, profile status, search navigation, themes and narrow layout.');
} finally { await browser?.close(); await server.close(); await rm(temporary, { recursive: true, force: true }); }
