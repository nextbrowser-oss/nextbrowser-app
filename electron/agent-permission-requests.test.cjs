const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createPermissionRequests } = require('./agent-permission-requests.cjs');

function fixture({ foreground = true, canRemember = false, notificationDetail } = {}) {
  const sent = [], toasts = [], flashes = [];
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, isMinimized: () => !foreground, isVisible: () => foreground, isFocused: () => foreground,
    restore() {}, show() {}, focus() {}, flashFrame: flag => flashes.push(flag),
    webContents: { isDestroyed: () => false, send: (...args) => sent.push(args) },
  });
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); this.options = options; toasts.push(this); }
    show() {}
    close() { this.closed = true; }
  }
  const scope = { owner: 'account', workspaceId: 'work', window };
  let current = scope;
  const broker = createPermissionRequests({ Notification, isCurrent: candidate => current === candidate });
  const controller = new AbortController();
  const result = broker.request(scope, 'chat', { title: 'Agent permission', detail: 'private command', canRemember, notificationDetail }, controller.signal);
  const target = broker.get(scope);
  return { broker, scope, window, controller, result, target, sent, toasts, flashes, switchOwner() { current = null; } };
}

test('a foreground approval belongs to one window, workspace, chat and operation', async () => {
  const { broker, scope, result, target, toasts } = fixture();
  const answer = { ...target, decision: 'once' };
  assert.equal(toasts.length, 0);
  assert.equal(broker.get({ ...scope }), null);
  assert.equal(broker.answer({ ...scope }, answer), false);
  for (const patch of [{ conversationId: 'other' }, { id: 'old' }, { decision: 'remember' }, { decision: 'yes' }]) {
    assert.equal(broker.answer(scope, { ...answer, ...patch }), false);
  }
  assert.equal(broker.answer(scope, answer), true);
  assert.equal(await result, 'once');
  assert.equal(broker.answer(scope, answer), false);
  assert.equal(broker.get(scope), null);
});

test('a private toast opens the originating chat and only its explicit Deny cancels the operation', async () => {
  const { broker, scope, result, target, sent, toasts, window } = fixture();
  window.emit('blur');
  window.emit('minimize');
  assert.equal(toasts.length, 1);
  const toast = toasts[0];
  assert(!toast.options.body.includes(target.detail));
  assert.equal(toast.options.actions[0].text, 'Review');
  toast.emit('close', {});
  toast.emit('action', { actionIndex: 0 });
  assert.deepEqual(sent.at(-1), ['stock-mcp:permission-open', { id: target.id, workspaceId: 'work', owner: 'account', conversationId: 'chat' }]);
  assert.equal(broker.get(scope), target);
  toast.emit('action', { actionIndex: 1 });
  assert.equal(await result, 'deny');
  assert.equal(toast.closed, true);
  toast.emit('click');
  assert.deepEqual(sent.at(-1), ['stock-mcp:permission-changed']);
});

test('an explicit background approval is single-use, even when remembering is available', async () => {
  const { result, toasts } = fixture({ foreground: false, canRemember: true, notificationDetail: 'Read folder example' });
  assert.equal(toasts[0].options.actions[0].text, 'Allow once');
  toasts[0].emit('action', { actionIndex: 0 });
  assert.equal(await result, 'once');
});

test('an expired or switched account cannot approve a stale request', async () => {
  const { broker, scope, target, switchOwner, controller, result, toasts, flashes } = fixture({ foreground: false, notificationDetail: 'Read folder' });
  toasts[0].emit('failed');
  assert.deepEqual(flashes, [true]);
  switchOwner();
  assert.equal(broker.get(scope), null);
  toasts[0].emit('action', { actionIndex: 0 });
  assert.equal(broker.answer(scope, { ...target, decision: 'once' }), false);
  controller.abort();
  await assert.rejects(result, /expired/);
  assert.equal(toasts[0].closed, true);
});
