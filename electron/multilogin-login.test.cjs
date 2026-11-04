const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createMultiloginLogin } = require("./multilogin-login.cjs");

function fixture(options = {}) {
  const windows = [];
  class Window extends EventEmitter {
    static fromWebContents(owner) { return owner; }
    constructor(config) {
      super(); this.config = config; this.destroyed = false; this.cleared = 0; this.reads = 0;
      this.webContents = new EventEmitter();
      this.webContents.session = {
        clearStorageData: async () => { this.cleared++; },
        setPermissionRequestHandler: (handler) => { this.permission = handler; },
      };
      this.webContents.setWindowOpenHandler = (handler) => { this.popups = handler; };
      this.webContents.getURL = () => this.url;
      this.webContents.executeJavaScript = async (script) => { this.reads++; this.script = script; if (this.readError) throw this.readError; return this.token ?? "session-token"; };
      windows.push(this);
    }
    async loadURL(url) { this.url = url; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit("closed"); }
    show() {}
    focus() {}
  }
  const owner = new EventEmitter();
  const flow = createMultiloginLogin({ BrowserWindow: Window, ...options });
  return { flow, owner, windows };
}

test("connect uses only the chosen Multilogin session and returns status, not its token", async () => {
  const { flow, owner, windows } = fixture();
  await flow.open(owner);
  const window = windows[0];
  assert.equal(window.url, "https://app.multilogin.com");
  assert.equal(window.config.webPreferences.nodeIntegration, false);
  assert.equal(window.config.webPreferences.contextIsolation, true);
  assert.equal(window.config.webPreferences.sandbox, true);
  assert.equal(window.config.webPreferences.preload, undefined);
  assert.ok(!window.config.webPreferences.partition.startsWith("persist:"));
  const status = await flow.complete(owner, async (token) => {
    assert.equal(token, "session-token");
    return { connected: true, valid: true };
  });
  assert.deepEqual(status, { connected: true, valid: true });
  assert.match(window.script, /location\.origin/);
  assert.match(window.script, /sessionStorage\.getItem\("token"\)/);
  assert.match(window.script, /localStorage\.getItem\("token"\)/);
  assert.equal(window.destroyed, true);
  assert.equal(window.cleared, 1);
  assert.equal(owner.listenerCount("destroyed"), 0);
});

test("unrelated origins, pages without a token, and other senders cannot connect", async () => {
  const { flow, owner, windows } = fixture();
  await flow.open(owner);
  const window = windows[0];
  let exchanged = 0;
  const connect = async () => { exchanged++; };
  window.url = "https://app.multilogin.com.evil.example";
  await assert.rejects(flow.complete(owner, connect), /Finish signing in/);
  assert.equal(window.reads, 0);
  await assert.rejects(flow.complete(new EventEmitter(), connect), /Open Multilogin/);
  window.url = "https://app.multilogin.com/dashboard";
  window.token = "";
  await assert.rejects(flow.complete(owner, connect), /Finish signing in/);
  window.token = "invalid token";
  await assert.rejects(flow.complete(owner, connect), /invalid format/);
  assert.equal(exchanged, 0);
  flow.cancel(owner);
});

test("load/read failures do not expose page error contents; a failed exchange can be retried", async () => {
  const { flow, owner, windows } = fixture();
  await flow.open(owner);
  const window = windows[0];
  window.readError = new Error("secret page data");
  await assert.rejects(flow.complete(owner, async () => {}), (error) => error.expected && !error.message.includes("secret"));
  window.readError = undefined;
  await assert.rejects(flow.complete(owner, async () => { throw new Error("Token expired"); }), /Token expired/);
  assert.equal(window.destroyed, false);
  await flow.complete(owner, async () => ({ connected: true }));
  assert.equal(window.cleared, 1);
});

test("cancel, expiry and parent close discard temporary sessions; repeated open reuses only its own window", async () => {
  const { flow, owner, windows } = fixture();
  await flow.open(owner); await flow.open(owner);
  assert.equal(windows.length, 1);
  flow.cancel(new EventEmitter());
  assert.equal(windows[0].destroyed, false);
  owner.emit("destroyed");
  assert.equal(windows[0].cleared, 1);
  await assert.rejects(flow.complete(owner, async () => {}), /Open Multilogin/);
  await flow.open(owner);
  flow.cancel(owner);
  assert.equal(windows[1].cleared, 1);
  const expired = fixture({ timeoutMs: 1 });
  await expired.flow.open(expired.owner);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(expired.windows[0].destroyed, true);
});

test("temporary sign-in blocks permissions, popups and navigation to non-HTTPS schemes", async () => {
  const { flow, owner, windows } = fixture(); await flow.open(owner);
  const window = windows[0];
  assert.deepEqual(window.popups(), { action: "deny" });
  window.permission(null, "media", (allowed) => assert.equal(allowed, false));
  for (const url of ["file:///secret", "javascript:alert(1)", "nextbrowser://auth", "garbage"]) {
    let blocked = false;
    window.webContents.emit("will-navigate", { preventDefault() { blocked = true; } }, url);
    assert.equal(blocked, true);
  }
  flow.cancel(owner);
});

test("an exchange in progress cannot start a second exchange", async () => {
  const { flow, owner } = fixture(); await flow.open(owner);
  let release;
  const first = flow.complete(owner, () => new Promise((resolve) => { release = resolve; }));
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(flow.complete(owner, async () => {}), /already connecting/);
  release({ connected: true }); await first;
});
