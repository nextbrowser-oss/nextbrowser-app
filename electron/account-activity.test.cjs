const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setTimeout: wait } = require('node:timers/promises');
const { createAccountActivity } = require('./account-activity.cjs');

test('the active timer publishes seconds without writing the settings file every tick', async () => {
  const values = {};
  const writes = [];
  const snapshots = [];
  const settings = {
    snapshot: () => ({values}), flush: async () => {},
    update: async patch => { writes.push(patch); Object.assign(values, patch.values); },
  };
  const tracker = createAccountActivity({settings: () => settings});
  const win = Object.assign(new EventEmitter(), {
    isFocused: () => true, isMinimized: () => false, isVisible: () => true, isDestroyed: () => false,
    webContents: { send(_channel, {log}) { snapshots.push(Object.values(log.days).reduce((sum, d) => sum + d.ms, 0)); } },
  });
  tracker.bind(win);
  try {
    tracker.owner(win, 'timer');
    const deadline = Date.now() + 5000;
    while ((snapshots.at(-1) ?? 0) < 1000 && Date.now() < deadline) await wait(50);
    assert.ok(snapshots.at(-1) >= 1000);
    assert.equal(writes.length, 1);
    win.emit('blur');
    await tracker.flush();
    const persisted = Object.values(JSON.parse(values['nextbrowser.accountActivity.timer']).days);
    assert.ok(persisted.reduce((sum, day) => sum + day.ms, 0) >= 1000);
  } finally { win.emit('closed'); await tracker.flush(); }
});

test('lock, sleep, hiding and detaching the Live window pause the worker independently', async () => {
  const values = {}, monitor = new EventEmitter();
  const settings = {snapshot: () => ({values}), update: async patch => Object.assign(values,patch.values), flush: async () => {}};
  const activity = createAccountActivity({settings: () => settings});
  const win = Object.assign(new EventEmitter(), {
    isFocused: () => false, isMinimized: () => false, isVisible: () => true, isDestroyed: () => false,
    webContents: {send() {}},
  });
  activity.bindPower(monitor);
  activity.bind(win);
  const read = async () => {
    await activity.flush();
    return Object.values(JSON.parse(values['nextbrowser.accountActivity.a']).days).reduce((sum, day) => sum + day.ms, 0);
  };
  const frozen = async () => { const before = await read(); await wait(30); assert.equal(await read(), before); };
  try {
    activity.owner(win, 'a');
    activity.live(win, true);
    await wait(35);
    assert.ok(await read() > 0);
    monitor.emit('lock-screen');
    monitor.emit('suspend');
    monitor.emit('unlock-screen');
    await frozen();
    monitor.emit('resume');
    const start = await read();
    await wait(35);
    assert.ok(await read() > start);
    win.emit('hide');
    await frozen();
    win.emit('show');
    activity.live(win, false);
    await frozen();
  } finally {
    win.emit('closed');
    await activity.flush();
  }
});
