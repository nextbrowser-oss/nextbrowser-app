const { test } = require("node:test");
const assert = require("node:assert/strict");
const { windowChromeOptions, applyWindowChrome, applyWindowZoom } = require("./window-chrome.cjs");

test("Windows and Linux retain native caption buttons above the renderer", () => {
  for (const platform of ["win32", "linux"]) {
    const options = windowChromeOptions(platform, false);
    assert.equal(options.titleBarStyle, "hidden");
    assert.equal(options.titleBarOverlay.height, 40);
    assert.equal(options.titleBarOverlay.symbolColor, "#17171c");
    assert.equal(options.frame, undefined);
  }
});
test("macOS retains its native inset traffic lights", () => {
  const options = windowChromeOptions("darwin");
  assert.equal(options.titleBarStyle, "hiddenInset");
  assert.equal(options.titleBarOverlay, undefined);
  assert.deepEqual(options.trafficLightPosition, { x: 14, y: 13 });
});
test("palette updates theme native controls and follow renderer scale", () => {
  const calls = [];
  const window = { setBackgroundColor: value => calls.push(value), setTitleBarOverlay: value => calls.push(value) };
  assert.equal(applyWindowChrome(window, { background: "#20242b", foreground: "#f4f6fb", factor: 1.25 }, "win32"), true);
  assert.deepEqual(calls, ["#20242b", { color: "#20242b", symbolColor: "#f4f6fb", height: 50 }]);
  assert.equal(applyWindowChrome(window, { background: "url(https://example.com)", foreground: "#ffffff" }, "win32"), false);
  assert.equal(calls.length, 2);
});
test("secondary windows and macOS never receive unsupported overlay calls", () => {
  const calls = [];
  const window = { setBackgroundColor: value => calls.push(value), setTitleBarOverlay: () => assert.fail("No overlay on a secondary window") };
  for (const platform of ["win32", "darwin"]) applyWindowChrome(window, { background: "#20242b", foreground: "#f4f6fb" }, platform, false);
  assert.equal(calls.length, 2);
});
test("caption controls remain aligned at small and large interface scales", () => {
  const calls = [];
  const window = { setTitleBarOverlay: value => calls.push(value), setWindowButtonPosition: value => calls.push(value) };
  applyWindowZoom(window, 0.5, "win32");
  applyWindowZoom(window, 2, "win32");
  applyWindowZoom(window, 0.5, "darwin");
  assert.deepEqual(calls, [{ height: 20 }, { height: 80 }, { x: 14, y: 3 }]);
});
