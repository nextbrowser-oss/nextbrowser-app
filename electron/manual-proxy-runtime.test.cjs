const assert = require("node:assert/strict");
const test = require("node:test");

const { assertManualProxyRuntimeSupport, isLoopbackProxyHost } = require("./manual-proxy-runtime.cjs");

test("identifies local proxy listeners", () => {
  for (const host of ["localhost", "LOCALHOST", "127.0.0.1", "127.20.30.40", "::1", "[::1]", "::ffff:127.0.0.1"]) {
    assert.equal(isLoopbackProxyHost(host), true, host);
  }
  for (const host of ["proxy.example", "192.0.2.1", "::2"]) assert.equal(isLoopbackProxyHost(host), false, host);
});

test("blocks a local proxy only for ClawBrowser", () => {
  assert.throws(
    () => assertManualProxyRuntimeSupport("clawbrowser", { host: "127.0.0.1" }),
    /LOCAL_PROXY_UNSUPPORTED/,
  );
  assert.doesNotThrow(() => assertManualProxyRuntimeSupport("camoufox", { host: "127.0.0.1" }));
  assert.doesNotThrow(() => assertManualProxyRuntimeSupport("dasbrowser", { host: "localhost" }));
  assert.doesNotThrow(() => assertManualProxyRuntimeSupport("clawbrowser", { host: "proxy.example" }));
});
