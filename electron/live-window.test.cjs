const { test } = require("node:test");
const assert = require("node:assert/strict");
const { managedBrowserPID, nativeLayout, macLayout } = require("./live-window.cjs");

test("native Live accepts only matching local managed sessions", () => {
  const session = { source: "state_file", runtime: "clawbrowser", endpoint: "http://127.0.0.1:9222" };
  const status = { status: "running", pid: "1234", session };
  assert.equal(managedBrowserPID(status), 1234);
  assert.equal(managedBrowserPID({ ...status, status: "stopped" }), null);
  assert.equal(managedBrowserPID({ ...status, pid: "1234.5" }), null);
  assert.equal(managedBrowserPID({ ...status, session: { ...session, runtime: "dasbrowser" } }), null);
  assert.equal(managedBrowserPID({ ...status, session: { ...session, runtime: "chromium" } }, "dasbrowser"), 1234);
  assert.equal(managedBrowserPID({ ...status, session: { ...session, runtime: "camoufox" } }, "camoufox"), 1234);
  assert.equal(managedBrowserPID({ ...status, session: { ...session, runtime: "chromium" } }, "camoufox"), null);
  assert.equal(managedBrowserPID({ ...status, session: { ...session, runtime: "multilogin" } }, "multilogin"), null);
  assert.equal(managedBrowserPID({ ...status, session: { ...session, source: "explicit" } }), null);
  assert.equal(managedBrowserPID({ ...status, session: { ...session, endpoint: "http://example.com:9222" } }), null);
});

test("native coordinates follow desktop zoom and hidden views expose no native area", () => {
  const bounds = { x: 0, y: 40, width: 800, height: 600 };
  const hole = { x: 10, y: 520, width: 40, height: 40, radius: 20 };
  assert.deepEqual(nativeLayout({ bounds, holes: [hole, { ...hole, x: Infinity }], fill: true }, 1.25), {
    bounds: { x: 0, y: 50, width: 1000, height: 750 },
    holes: [{ x: 13, y: 650, width: 50, height: 50, radius: 25 }],
    fill: true,
  });
  assert.deepEqual(nativeLayout({ bounds, hidden: true }, 1), { hidden: true });
});

test("macOS layout moves the panel and its controls into host window points", () => {
  const bounds = { x: 100, y: 40, width: 600, height: 800 };
  const button = { x: 116, y: 784, width: 40, height: 40, radius: 20 };
  assert.deepEqual(macLayout({ bounds, holes: [button] }, 1.25, { x: 0, y: 28 }), {
    bounds: { x: 125, y: 78, width: 750, height: 1000 },
    controls: [{ x: 145, y: 1008, width: 50, height: 50 }],
  });
  assert.deepEqual(macLayout({ bounds, hidden: true }, 1), { hidden: true });
});
