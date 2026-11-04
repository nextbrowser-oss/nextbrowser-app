// Exercise the actual sandboxed Electron window with a synthetic Multilogin
// origin. Every HTTPS response is local; no real account or network is used.
const assert = require("node:assert/strict");
const { app, BrowserWindow } = require("electron");
const { createMultiloginLogin } = require("../electron/multilogin-login.cjs");

app.whenReady().then(async () => {
  const owner = new BrowserWindow({ show: false });
  let signIn;
  class TestWindow extends BrowserWindow {
    constructor(options) {
      super({ ...options, show: false });
      signIn = this;
      this.webContents.session.protocol.handle("https", () => new Response(`<!doctype html><title>QA sign-in</title><script>sessionStorage.setItem('token','qa-session');</script>`, { headers: { "content-type": "text/html" } }));
    }
  }
  const flow = createMultiloginLogin({ BrowserWindow: TestWindow });
  try {
    await flow.open(owner.webContents);
    assert.equal(signIn.webContents.getURL(), "https://app.multilogin.com/");
    assert.equal(await signIn.webContents.executeJavaScript("typeof window.nextbrowser"), "undefined");
    const result = await flow.complete(owner.webContents, async (token) => {
      assert.equal(token, "qa-session");
      return { connected: true };
    });
    assert.deepEqual(result, { connected: true });
    assert.equal(signIn.isDestroyed(), true);
    console.log("Sandboxed Multilogin sign-in window passed: origin, token capture, no app bridge, status-only result, cleanup.");
    app.exit(0);
  } catch (error) {
    flow.cancel(owner.webContents);
    console.error(error.message);
    app.exit(1);
  }
}).catch((error) => { console.error(error.message); app.exit(1); });
