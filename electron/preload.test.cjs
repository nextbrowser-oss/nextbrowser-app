const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

// Loads the preload script against a stand-in for Electron's renderer API and
// returns what it exposes to the page.
function loadPreload() {
  const sent = [];
  const invoked = [];
  let exposed;
  const electron = {
    contextBridge: { exposeInMainWorld: (key, api) => { exposed = { key, api }; } },
    ipcRenderer: {
      send: (channel, payload) => { sent.push({ channel, payload }); return "ignored"; },
      sendSync: (channel) => { sent.push({ channel, sync: true }); return { migrated: [], values: { theme: "light" } }; },
      invoke: (...args) => { invoked.push(args); return Promise.resolve(null); },
      on: () => undefined,
      removeListener: () => undefined,
    },
    webUtils: { getPathForFile: () => "" },
  };
  const electronPath = require.resolve("electron");
  const preloadPath = path.join(__dirname, "preload.cjs");
  const previous = require.cache[electronPath];
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: electron };
  delete require.cache[preloadPath];
  try {
    require(preloadPath);
  } finally {
    if (previous) require.cache[electronPath] = previous;
    else delete require.cache[electronPath];
    delete require.cache[preloadPath];
  }
  return { exposed, sent, invoked };
}

test("the bridge sends error reports and breadcrumbs fire-and-forget on dedicated channels", () => {
  const { exposed, sent, invoked } = loadPreload();
  assert.equal(exposed.key, "nextbrowser");
  const report = { kind: "exception", name: "TypeError", message: "x" };
  assert.equal(exposed.api.reportError(report), undefined, "no promise to await or reject");
  exposed.api.breadcrumb({ category: "navigation", message: "chat" });
  assert.deepEqual(sent, [
    { channel: "nextbrowser:client-error", payload: report },
    { channel: "nextbrowser:client-breadcrumb", payload: { category: "navigation", message: "chat" } },
  ]);
  assert.deepEqual(invoked, []);
});

test("the bridge still exposes only functions", () => {
  const { exposed } = loadPreload();
  for (const [name, value] of Object.entries(exposed.api)) assert.equal(typeof value, "function", name);
  assert.deepEqual(Object.keys(exposed.api).sort(), ["breadcrumb", "filePathForFile", "invoke", "on", "readSettings", "reportError", "updateSettings"]);
});

test("the bridge reads the settings file synchronously and updates it fire-and-forget", () => {
  const { exposed, sent, invoked } = loadPreload();
  assert.deepEqual(exposed.api.readSettings(), { migrated: [], values: { theme: "light" } });
  assert.equal(exposed.api.updateSettings({ values: { theme: "dark" } }), undefined, "no promise to await or reject");
  assert.deepEqual(sent, [
    { channel: "nextbrowser:settings-read", sync: true },
    { channel: "nextbrowser:settings-update", payload: { values: { theme: "dark" } } },
  ]);
  assert.deepEqual(invoked, []);
});
