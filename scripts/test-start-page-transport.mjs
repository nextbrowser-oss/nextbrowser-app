import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import serverModule from '../electron/start-page-server.cjs';
import transportModule from '../electron/start-page-transport.cjs';

const directory = await mkdtemp(path.join(os.tmpdir(), 'nextbrowser-start-proxy-'));
const requests = [];
const actions = [];
const proxy = http.createServer((req, res) => { requests.push(req.url); res.writeHead(403); res.end('Proxy refuses local destinations'); });
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
const reservation = http.createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const debugPort = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
let authorized = true;
const server = serverModule.createStartPageServer({ distDir: path.resolve('dist'), storageDir: directory, requestDesktop: async (_, action) => {
  if (!authorized) throw new Error('Profile is unavailable.');
  actions.push(action);
  return { profile: 'Proxy profile', workspace: 'Local test', runtime: 'ClawBrowser', theme: 'dark', agent: 'Codex', connection: 'Managed proxy', verified: false, status: 'running', sessions: [] };
} });
let browser, transport;
try {
  const url = await server.open({ sender: { isDestroyed: () => false }, workspaceId: 'proxy-test', runtime: 'clawbrowser', profile: 'test' });
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'), headless: true,
    proxy: { server: `http://127.0.0.1:${proxy.address().port}` }, args: [`--remote-debugging-port=${debugPort}`, '--proxy-bypass-list=<-loopback>'] });
  const page = await browser.newPage();
  assert.equal((await page.goto(url)).status(), 403, 'reproduce a browser that proxies loopback');
  transport = await transportModule.connectStartPageTransport(`http://127.0.0.1:${debugPort}`, url);
  requests.length = 0;
  assert.equal((await page.reload()).status(), 200);
  await page.getByRole('tab', { name: 'Ask your agent' }).click();
  await page.getByRole('textbox', { name: 'Task for your agent' }).fill('Local transport draft test');
  await page.getByRole('button', { name: 'Continue in chat' }).click();
  await page.getByText('Your draft is ready in Nextbrowser chat.').waitFor();
  assert.ok(actions.some(a => a.type === 'draft' && a.text === 'Local transport draft test'));
  assert.equal(requests.filter(r => r.startsWith(new URL(url).origin)).length, 0, 'start-page contents and actions must never reach the proxy');
  assert.equal((await page.goto('http://website.invalid/ordinary-page')).status(), 403);
  assert.ok(requests.includes('http://website.invalid/ordinary-page'), 'normal websites still use the profile proxy');
  const second = await browser.newPage();
  assert.equal((await second.goto(url)).status(), 200, 'new tabs also use local page delivery');
  assert.equal((await second.goto(url.replace(/\/start\/[^/]+\//, '/start/' + '0'.repeat(32) + '/') + 'state')).status(), 503, 'other profile tokens cannot be forwarded');
  authorized = false;
  await page.goto(url);
  await page.getByText('Profile is unavailable.').waitFor();
  console.log('PASS: proxied loopback reproduction, local delivery, draft action, new tabs, scope isolation, revocation, unchanged website proxy routing.');
} finally {
  transport?.close();
  await browser?.close();
  await server.close();
  proxy.closeAllConnections();
  await new Promise(resolve => proxy.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
