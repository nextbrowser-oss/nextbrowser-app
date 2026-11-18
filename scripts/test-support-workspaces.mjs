import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, chromium } from 'playwright-core';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const out = path.join(root, 'e2e-out');
await mkdir(out, { recursive: true });
const evidence = {};

// Actual Electron main process, fresh app/runtime storage, real compiled nbc.
// No personal workspace, auth key, customer message or production write.
if (!process.env.NEXTCTL_BIN) throw new Error('Set NEXTCTL_BIN to the CLAW-522 CLI binary.');
const qaRoot = await mkdtemp(path.join(tmpdir(), 'nextbrowser-claw522-'));
let app;
try {
  app = await _electron.launch({ args: [root, `--user-data-dir=${path.join(qaRoot, 'app')}`], env: { ...process.env,
    NEXTBROWSER_DEV_DATA_ROOT: qaRoot, NBC_AUTO_UPDATE: '0', NEXTBROWSER_ERROR_REPORTING: '0', NEXTBROWSER_DEVICE_REPORTING: '0' }, timeout: 60_000 });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const url = new URL(page.url()); url.searchParams.set('preview', 'main');
  await page.goto(url.toString());
  await page.locator('.sidebar-mini').getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('button', { name: 'Copy diagnostics', exact: true }).click();
  await settings.getByText('Diagnostics copied.', { exact: true }).waitFor({ timeout: 20_000 });
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert.ok(copied.startsWith('Nextbrowser diagnostics\n'));
  const report = JSON.parse(copied.split('\n').slice(1).join('\n'));
  assert.equal(report.cli.status, 'available');
  assert.equal(report.config.source, 'NEXTBROWSER_CONFIG_DIR');
  assert.equal(report.authorization.status, 'not_configured');
  assert.equal(report.config.key_configured, false);
  evidence.desktop = { copied: true, cliStatus: report.cli.status, authStatus: report.authorization.status, isolatedStorage: true };
  await page.screenshot({ path: path.join(out, 'support-diagnostics-native.png') });
} finally { await app?.close(); }

const url = 'http://127.0.0.1:1428';
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '1428', '--strictPort'], { cwd: root, windowsHide: true, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i > 150) throw new Error('QA renderer did not start');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || (process.platform === 'win32' ? path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe') : '/usr/bin/google-chrome'), headless: true });
  const page = await browser.newPage();
  await page.route('**/*', (route) => route.request().url().startsWith(url) || route.request().url().startsWith('data:') ? route.continue() : route.abort());
  await page.addInitScript(() => {
    window.__cleanupQA = { active: 0, peak: 0, removed: [], calls: [] };
    window.nextbrowser = { on() { return () => {}; }, async invoke(command, args = {}) {
      const state = window.__cleanupQA;
      state.calls.push(command);
      if (command === 'nextctl_run') {
        if (args.args?.[0] === 'profiles' && args.args?.[1] === 'rm') {
          state.peak = Math.max(state.peak, ++state.active);
          await new Promise((resolve) => setTimeout(resolve, 25));
          state.removed.push(args.args[2]); state.active--;
        }
        return { code: 0, stdout: JSON.stringify({ ok: true, data: { profiles: [] } }), stderr: '' };
      }
      if (command === 'browser_runtime_update_status') return { status: 'ready', runtimes: [] };
      if (command === 'browser_runtime_install_status' || command === 'browser_runtime_update_install_status') return { status: 'idle' };
      if (command === 'error_reporting_status') return { enabled: false, available: false };
      if (command === 'nextctl_version') return '1.2.41';
      if (command === 'nextctl_supports_skill') return true;
      if (command === 'github_stars') return 0;
      if (command === 'manual_proxies_list') return [];
      return { revision: 1 };
    } };
  });
  await page.goto(`${url}/?preview=main`);
  await page.locator('.sidebar-mini').waitFor();
  const result = await page.evaluate(async () => {
    const { useStore } = await import('/src/store.ts');
    const names = Array.from({ length: 120 }, (_, i) => `fixture-${i}`);
    const seed = () => {
      useStore.setState({ authed: false, workspaces: [
        { id: 'fixture', name: 'Large test workspace', profileNames: [...names, 'shared'], profileToolsets: {}, createdAt: 1, updatedAt: 1 },
        { id: 'keep', name: 'Keep workspace', profileNames: ['shared'], profileToolsets: {}, createdAt: 1, updatedAt: 1 },
      ], activeWorkspaceId: 'keep', statuses: Object.fromEntries([...names, 'shared'].map((name) => [name, 'stopped'])), conversations: [], scheduledRuns: [],
        loadProfiles: async () => {}, syncProjects: async () => {}, projectsSyncing: false });
    };
    seed();
    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    let start = performance.now();
    // Same mocked IPC operations, sequential reference matching the old loop.
    for (const name of names) await useStore.getState().deleteProfile(name, { deletingWorkspace: true });
    const serialMs = performance.now() - start;
    seed();
    window.__cleanupQA.active = 0; window.__cleanupQA.peak = 0; window.__cleanupQA.removed = [];
    ticks = 0;
    const progress = [];
    start = performance.now();
    await useStore.getState().deleteWorkspace('fixture', (message) => progress.push(message));
    const boundedMs = performance.now() - start;
    clearInterval(timer);
    return { serialMs, boundedMs, ticks, peak: window.__cleanupQA.peak, removed: window.__cleanupQA.removed,
      remaining: useStore.getState().workspaces.map((item) => item.id), progress: progress.at(-1), simulatedLatencyMs: 25 };
  });
  assert.equal(result.peak, 3);
  assert.equal(result.removed.length, 120);
  assert.equal(new Set(result.removed).size, 120);
  assert.deepEqual(result.remaining, ['keep']);
  assert.ok(result.ticks > 20, 'renderer should remain responsive');
  assert.ok(result.boundedMs < result.serialMs * 0.65, 'bounded cleanup should improve over the sequential reference');
  evidence.workspace = { profileCount: result.removed.length, peakConcurrency: result.peak, serialMs: Math.round(result.serialMs), boundedMs: Math.round(result.boundedMs), rendererTicks: result.ticks, simulatedIPCLatencyMs: 25, sharedProfilePreserved: true };
  await page.screenshot({ path: path.join(out, 'workspace-cleanup-qa.png') });
} finally { await browser?.close(); vite.kill(); }
await writeFile(path.join(out, 'support-workspaces-qa.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
