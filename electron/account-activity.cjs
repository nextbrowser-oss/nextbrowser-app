const { Worker } = require('node:worker_threads');
const path = require('node:path');

function createAccountActivity({ settings, workerFile = path.join(__dirname, 'account-activity-worker.cjs'), warn = console.warn }) {
  const windows = new Map();
  const pending = new Map();
  let worker, sequence = 0, lastOwner = null, lastCheckpoint = 0, timer, locked = false, suspended = false;
  const key = owner => 'nextbrowser.accountActivity.' + owner;
  function startWorker() {
    const thread = new Worker(workerFile);
    thread.on('message', ({ id, updates, persist }) => {
      if (updates.length) {
        if (persist) {
          const values = Object.fromEntries(updates.map(([owner, log]) => [key(owner), JSON.stringify(log)]));
          void settings().update({ values }).catch(warn);
        }
        for (const [win, state] of windows) {
          const item = updates.find(([owner]) => owner === state.owner);
          if (item && !win.isDestroyed()) win.webContents.send('account-activity:snapshot', { owner: item[0], log: item[1] });
        }
      }
      pending.get(id)?.();
      pending.delete(id);
      if (!pending.size) thread.unref();
    });
    thread.on('error', warn);
    thread.on('exit', () => {
      if (worker !== thread) return;
      worker = undefined;
      lastOwner = null;
      for (const resolve of pending.values()) resolve();
      pending.clear();
    });
    thread.unref();
    return thread;
  }
  function sample(force = false, flush = false) {
    let owner = null;
    if (!locked && !suspended) for (const [win, state] of windows) {
      if (state.owner && !win.isDestroyed() && state.visible && !state.minimized && (state.focused || state.live)) {
        owner = state.owner;
        break;
      }
    }
    if (!force && owner === lastOwner) return;
    if (!worker && !owner) return;
    const at = Date.now(), monotonic = performance.now();
    worker ??= startWorker();
    const id = ++sequence;
    if (flush) worker.ref();
    const result = flush ? new Promise(resolve => pending.set(id, resolve)) : undefined;
    const seed = owner && owner !== lastOwner ? settings().snapshot().values[key(owner)] : undefined;
    // Update the visible clock every second. Checkpoint on transitions, flush and the regular 15s cadence.
    const persist = flush || owner !== lastOwner || monotonic - lastCheckpoint >= 15_000;
    if (persist) lastCheckpoint = monotonic;
    lastOwner = owner;
    worker.postMessage({ id, owner, at, monotonic, seed, persist });
    if (owner && !timer) timer = setInterval(() => sample(true), 1000).unref();
    if (!owner && timer) { clearInterval(timer); timer = undefined; }
    return result;
  }
  return {
    bind(win) {
      const state = { owner: null, live: false, visible: win.isVisible(), minimized: win.isMinimized(), focused: win.isFocused() };
      windows.set(win, state);
      for (const [event, field, value] of [
        ['focus','focused',true], ['blur','focused',false], ['minimize','minimized',true],
        ['restore','minimized',false], ['show','visible',true], ['hide','visible',false],
      ]) win.on(event, () => { state[field] = value; sample(); });
      win.once('closed', () => { windows.delete(win); sample(); });
    },
    owner(win, owner) {
      const state = windows.get(win);
      if (!state) return;
      state.owner = owner;
      if (owner) {
        const saved = settings().snapshot().values[key(owner)];
        if (saved) {
          try { win.webContents.send('account-activity:snapshot', { owner, log: JSON.parse(saved) }); }
          catch { /* An invalid local log will be replaced by the next sample. */ }
        }
      }
      sample();
    },
    live(win, focused) {
      const state = windows.get(win);
      if (state) { state.live = focused; sample(); }
    },
    bindPower(monitor) {
      for (const [event, value] of [['suspend',true],['resume',false]]) monitor.on(event, () => { suspended = value; sample(); });
      for (const [event, value] of [['lock-screen',true],['unlock-screen',false]]) monitor.on(event, () => { locked = value; sample(); });
    },
    async flush() { await sample(true, true); await settings().flush(); },
  };
}
module.exports = { createAccountActivity };
