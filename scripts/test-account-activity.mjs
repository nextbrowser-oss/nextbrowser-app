import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const script = fileURLToPath(import.meta.url);
const owner = 'account-clock-fixture';

async function until(condition) {
  const deadline = performance.now() + 20000;
  while (!await condition()) {
    assert.ok(performance.now() < deadline, 'Timed out waiting for ' + condition);
    await wait(50);
  }
}

async function measure() {
  // Drive the actual window without Playwright or DevTools forcing document.hasFocus().
  const {app} = require('electron');
  app.setAppPath(root);
  const created = once(app, 'browser-window-created');
  require('../electron/bootstrap.cjs');
  const [,win] = await created;
  const evaluate = source => win.webContents.executeJavaScript(source);
  await once(win.webContents, 'did-finish-load');
  await until(() => evaluate("!!document.querySelector('.app > .sidebar')"));
  const read = () => evaluate(`import('/src/lib/accountActivity.ts').then(({readActivity}) =>
    Object.values(readActivity('${owner}').days).reduce((sum, day) => sum + day.ms, 0))`);
  if (process.env.CLOCK_VERIFY_MS) {
    const actual = await read();
    const expected = Number(process.env.CLOCK_VERIFY_MS);
    console.log('After restart (ms): stored', actual, 'stopwatch total', expected);
    assert.ok(Math.abs(actual - expected) < 1200, 'restart kept the final partial interval');
    if (process.env.CLOCK_PHASE === 'verify') { app.quit(); return; }
  }
  win.show();
  win.focus();
  win.webContents.focus();
  await until(() => evaluate('document.hasFocus() && !document.hidden'));
  const baseline = await read();
  const start = performance.now();
  // Other apps on the real desktop can briefly take focus during a run.
  let foregroundFrom = start, foregroundMs = 0;
  const pauseClock = () => {
    if (foregroundFrom !== undefined) foregroundMs += performance.now() - foregroundFrom;
    foregroundFrom = undefined;
  };
  win.on('blur', pauseClock);
  win.on('minimize', pauseClock);
  win.on('focus', () => { foregroundFrom ??= performance.now(); });
  // The offline preview omits account tracking. Attach the production observer to the fixture account.
  await evaluate(`Promise.all([import('/src/store.ts'),import('/src/lib/accountActivity.ts')]).then(([{useStore},{observeAccountActivity}]) => {
    useStore.setState({accountOwnerId:'${owner}', tab:'account'});
    observeAccountActivity('${owner}');
  })`);
  console.log('Timing focused account window...');
  await until(() => evaluate("!!document.querySelector('.account-metric-value b')"));
  if (process.env.CLOCK_PHASE === 'partial') {
    await evaluate('new Promise(resolve => setTimeout(resolve, 4000))');
    assert.ok(win.isFocused() && await evaluate('document.hasFocus()'));
    process.send({expected:Math.round(baseline + performance.now() - start)});
    app.quit();
    return;
  }
  await evaluate('new Promise(resolve => setTimeout(resolve, 65000))');
  console.log('Minimizing after', Math.round(performance.now() - start), 'ms of foreground');
  win.minimize();
  await until(() => win.isMinimized());
  pauseClock();
  const active = foregroundMs;
  await until(async () => Math.abs((await read()) - baseline - active) < 1200);
  const before = await read();
  console.log('Foreground (ms): stopwatch', Math.round(active), 'account', before - baseline);
  assert.ok(Math.abs(before - baseline - active) < 1200);
  if (before >= 60000 && before < 120000) assert.equal(await evaluate("document.querySelector('.account-metric-value b').textContent"), '1 min');
  console.log('Minimized:',win.isMinimized(),'renderer focused:',await evaluate('document.hasFocus()'));
  await wait(16000);
  const after = await read();
  console.log('Minimized (16 s): added', after - before, 'ms');
  assert.equal(after, before);
  process.send({expected:after});
  app.quit();
}

async function test() {
  const {createServer} = await import('vite');
  const fixture = await mkdtemp(path.join(tmpdir(), 'nb-account-clock-'));
  const modules = await realpath(path.join(root, 'node_modules'));
  const server = await createServer({root, cacheDir:path.join(fixture,'vite-cache'), server:{host:'127.0.0.1',strictPort:false,watch:null,hmr:false,fs:{allow:[root, modules]}},logLevel:'error'});
  try {
    await server.listen();
    let expected;
    for (const phase of ['partial','measure','verify']) {
      const env = {...process.env, VITE_DEV_SERVER_URL:server.resolvedUrls.local[0] + '?preview=main',
        CLOCK_PHASE:phase, NEXTBROWSER_DEV_DATA_ROOT:fixture, NBC_AUTO_UPDATE:'0', NEXTBROWSER_ERROR_REPORTING:'0', NEXTBROWSER_DEVICE_REPORTING:'0'};
      if (phase !== 'partial') {
        assert.ok(expected > 0);
        env.CLOCK_VERIFY_MS = String(expected);
      }
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(require('electron'), [script, '--user-data-dir=' + path.join(fixture,'app')], {cwd:root, env, timeout:150000, stdio:['ignore','inherit','inherit','ipc']});
      child.on('message', message => { expected = message.expected; });
      const [code] = await once(child, 'exit');
      assert.equal(code, 0, phase);
    }
  } finally {
    await server.close();
    await rm(fixture,{recursive:true,force:true,maxRetries:5,retryDelay:150});
  }
}

if (process.versions.electron) {
  measure().catch(error => { console.error(error); require('electron').app.exit(1); });
} else {
  await test();
}
