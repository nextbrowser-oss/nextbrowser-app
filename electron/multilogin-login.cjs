const { randomUUID } = require("node:crypto");
const { userError } = require("./user-error.cjs");
const { normalizeBearerToken } = require("./multilogin-credential.cjs");

const ORIGIN = "https://app.multilogin.com";
// Read only the documented token key, only in the Multilogin origin. Never
// return the token to the Nextbrowser renderer or inspect another app's files.
const READ_TOKEN = `(() => {
  if (location.origin !== ${JSON.stringify(ORIGIN)}) return "";
  return sessionStorage.getItem("token") || localStorage.getItem("token") || "";
})()`;

function createMultiloginLogin({ BrowserWindow, timeoutMs = 10 * 60_000 }) {
  let pending;
  function dispose(entry) {
    if (!entry || entry.disposed) return;
    entry.disposed = true;
    if (pending === entry) pending = undefined;
    clearTimeout(entry.timer);
    entry.owner.removeListener("destroyed", entry.onOwnerClosed);
    if (!entry.window.isDestroyed()) entry.window.destroy();
    void entry.session.clearStorageData().catch(() => {});
  }
  function owned(owner) {
    if (!pending || pending.owner !== owner || pending.window.isDestroyed()) {
      throw userError("Open Multilogin sign-in again, or connect with a token below.");
    }
    return pending;
  }
  return {
    async open(owner) {
      if (pending?.owner === owner && !pending.window.isDestroyed()) {
        pending.window.show();
        pending.window.focus();
        return;
      }
      dispose(pending);
      const window = new BrowserWindow({
        parent: BrowserWindow.fromWebContents(owner),
        title: "Multilogin — sign in and select a workspace",
        width: 1100, height: 800, autoHideMenuBar: true,
        webPreferences: { partition: `multilogin-connect-${randomUUID()}`, nodeIntegration: false, contextIsolation: true, sandbox: true },
      });
      const entry = { window, owner, session: window.webContents.session };
      entry.onOwnerClosed = () => dispose(entry);
      owner.once("destroyed", entry.onOwnerClosed);
      pending = entry;
      entry.timer = setTimeout(() => dispose(entry), timeoutMs);
      entry.timer.unref?.();
      // The temporary sign-in surface has no Nextbrowser preload or IPC bridge.
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      window.webContents.on("will-navigate", (event, url) => {
        try { if (new URL(url).protocol === "https:") return; } catch {}
        event.preventDefault();
      });
      window.once("closed", () => dispose(entry));
      try { await window.loadURL(ORIGIN); }
      catch { dispose(entry); throw userError("Couldn't open Multilogin sign-in. Try again or connect with a token below."); }
    },
    async complete(owner, connect) {
      const entry = owned(owner);
      if (entry.connecting) throw userError("Multilogin is already connecting.");
      let url;
      try { url = new URL(entry.window.webContents.getURL()); } catch {}
      if (url?.origin !== ORIGIN) throw userError("Finish signing in to Multilogin and select your workspace first.");
      entry.connecting = true;
      try {
        let value;
        try { value = await entry.window.webContents.executeJavaScript(READ_TOKEN); }
        catch { throw userError("Couldn't read this Multilogin session. Reopen sign-in or connect with a token below."); }
        if (typeof value !== "string" || !value.trim()) throw userError("Finish signing in to Multilogin and select your workspace first.");
        const token = normalizeBearerToken(value);
        if (pending !== entry) throw userError("Multilogin sign-in was closed. Open it again to connect.");
        const status = await connect(token);
        dispose(entry);
        return status;
      } finally { entry.connecting = false; }
    },
    cancel(owner) {
      if (pending?.owner === owner) dispose(pending);
    },
  };
}

module.exports = { createMultiloginLogin };
