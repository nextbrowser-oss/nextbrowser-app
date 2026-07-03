const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nextbrowser", {
  invoke: (command, args = {}) => ipcRenderer.invoke("nextbrowser:invoke", command, args),
  on: (channel, listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
