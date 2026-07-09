const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("nextbrowser", {
  invoke: (command, args = {}) => ipcRenderer.invoke("nextbrowser:invoke", command, args),
  filePathForFile: (file) => webUtils.getPathForFile(file),
  on: (channel, listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
