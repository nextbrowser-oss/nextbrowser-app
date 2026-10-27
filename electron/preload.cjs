const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("nextbrowser", {
  invoke: (command, args = {}) => ipcRenderer.invoke("nextbrowser:invoke", command, args),
  filePathForFile: (file) => webUtils.getPathForFile(file),
  on: (channel, listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  // Error reporting is fire-and-forget: a report must never wait on, or fail
  // with, the main process. The main process validates and scrubs both.
  reportError: (event) => { ipcRenderer.send("nextbrowser:client-error", event); },
  breadcrumb: (crumb) => { ipcRenderer.send("nextbrowser:client-breadcrumb", crumb); },
  // The settings file the main process keeps (electron/app-settings.cjs),
  // read synchronously so the window has them before its first render.
  readSettings: () => ipcRenderer.sendSync("nextbrowser:settings-read"),
  updateSettings: (patch) => { ipcRenderer.send("nextbrowser:settings-update", patch); },
});
