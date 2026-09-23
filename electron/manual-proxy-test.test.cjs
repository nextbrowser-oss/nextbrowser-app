const assert = require("node:assert/strict");
const test = require("node:test");
const net = require("node:net");

const { testManualProxy } = require("./manual-proxy-test.cjs");

// Full CONNECT/SOCKS5-tunnel-plus-TLS round trips were manually verified
// against local fake proxy/target servers (HTTP CONNECT and SOCKS5, with and
// without auth) outside this suite. node's test runner reliably cancels a
// test whose socket is TLS-wrapped after being handed off through a piped
// TCP relay ("Promise resolution is still pending but the event loop has
// already resolved") even in a minimal repro with none of this module's own
// code involved, so that coverage isn't encoded as an automated test here.
// These tests only cover the parts that don't depend on that pattern.

test("validates the proxy shape before dialing anything", async () => {
  await assert.rejects(testManualProxy({ scheme: "https", host: "127.0.0.1", port: 8080 }), /Unsupported proxy scheme/);
  await assert.rejects(testManualProxy({ scheme: "http", host: "", port: 8080 }), /missing a host or port/);
  await assert.rejects(testManualProxy({ scheme: "socks5", host: "127.0.0.1", port: 0 }), /missing a host or port/);
});

test("rejects an unreachable HTTP proxy instead of hanging", async () => {
  // Nothing is listening on this port; the OS refuses the connection immediately.
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const deadPort = blocker.address().port;
  await new Promise((resolve) => blocker.close(resolve));
  await assert.rejects(
    testManualProxy({ scheme: "http", host: "127.0.0.1", port: deadPort }, { timeoutMs: 2000 }),
  );
});

test("rejects an HTTP proxy that answers with a non-200 CONNECT response", async () => {
  const proxy = net.createServer((client) => {
    client.on("data", () => client.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n"));
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  try {
    await assert.rejects(
      testManualProxy({ scheme: "http", host: "127.0.0.1", port: proxy.address().port }, { timeoutMs: 2000 }),
      /407/,
    );
  } finally {
    await new Promise((resolve) => proxy.close(resolve));
  }
});

test("rejects a proxy that doesn't speak SOCKS5", async () => {
  const proxy = net.createServer((client) => {
    client.on("data", () => client.end(Buffer.from([0x00, 0x00])));
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  try {
    await assert.rejects(
      testManualProxy({ scheme: "socks5", host: "127.0.0.1", port: proxy.address().port }, { timeoutMs: 2000 }),
      /did not speak SOCKS5/,
    );
  } finally {
    await new Promise((resolve) => proxy.close(resolve));
  }
});
