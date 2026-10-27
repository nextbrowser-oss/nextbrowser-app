const assert = require("node:assert/strict");
const test = require("node:test");
const { describeBackendRequest, setBackendTransport, tracedBackendFetch } = require("./backend-fetch.cjs");

const {
  CHILD_NO_PROXY,
  childProxyEnv,
  chromiumNetworkError,
  createSystemProxy,
  describeProxyRoute,
  isDirectList,
  isLoopbackProxyList,
  parseProxyList,
  proxyEnvNames,
} = require("./system-proxy.cjs");

// AbortSignal.timeout() and the probes' own timers do not keep Node's event loop
// alive. Node 22's test runner (CI) then cancels a test that is waiting on one,
// so this file keeps the loop alive until its tests are done.
const keepAlive = setInterval(() => {}, 1_000);
test.after(() => clearInterval(keepAlive));

function harness({ routes = {}, netFetch, fetchImpl, start = 1_000 } = {}) {
  let clock = start;
  const lookups = [];
  const nodeCalls = [];
  const chromiumCalls = [];
  const logs = [];
  const proxy = createSystemProxy({
    resolveProxy: async (url) => {
      lookups.push(url);
      const route = typeof routes === "function" ? routes(url) : routes[url];
      if (route instanceof Error) throw route;
      return route ?? "DIRECT";
    },
    netFetch: netFetch || (async (url, init) => {
      chromiumCalls.push({ url, init });
      return new Response("chromium", { status: 200 });
    }),
    fetchImpl: fetchImpl || (async (url, init) => {
      nodeCalls.push({ url, init });
      return new Response("node", { status: 200 });
    }),
    now: () => clock,
    log: (line) => logs.push(line),
  });
  return { proxy, lookups, nodeCalls, chromiumCalls, logs, advance: (ms) => { clock += ms; } };
}

test("proxy lists are parsed and judged the way Chromium returns them", () => {
  assert.deepEqual(parseProxyList("PROXY 127.0.0.1:8888; DIRECT"), [{ type: "PROXY", host: "127.0.0.1", port: "8888" }, { type: "DIRECT", host: "", port: "" }]);
  assert.deepEqual(parseProxyList("SOCKS5 [::1]:1080"), [{ type: "SOCKS5", host: "::1", port: "1080" }]);
  assert.equal(isDirectList("DIRECT"), true);
  assert.equal(isDirectList(""), true);
  assert.equal(isDirectList("PROXY 127.0.0.1:8888; DIRECT"), false, "a proxy first means Chromium uses it");
  assert.equal(isLoopbackProxyList("PROXY 127.0.0.1:10808"), true);
  assert.equal(isLoopbackProxyList("SOCKS5 localhost:7891"), true);
  assert.equal(isLoopbackProxyList("PROXY proxy.corp.example.com:3128"), false);
  assert.equal(isLoopbackProxyList("DIRECT"), false);
  assert.equal(describeProxyRoute("PROXY 127.0.0.1:8888; DIRECT"), "PROXY loopback:8888, DIRECT");
  assert.equal(describeProxyRoute("HTTPS proxy.corp.example.com:443"), "HTTPS host", "a log line names no host but this computer");
});

test("DIRECT keeps Node's fetch; a proxy sends the request through Electron's net.fetch", async () => {
  const h = harness({ routes: { "https://api.nextbrowser.com": "PROXY 127.0.0.1:8888", "https://direct.test": "DIRECT" } });
  const direct = await h.proxy.fetch("https://direct.test/v1/x", { method: "GET" });
  assert.equal(await direct.text(), "node");
  assert.equal(h.chromiumCalls.length, 0);
  const signal = AbortSignal.timeout(60_000);
  const proxied = await h.proxy.fetch("https://api.nextbrowser.com/v1/client-errors", {
    method: "POST",
    headers: { "content-type": "application/json", traceparent: "00-a-b-01" },
    body: "{\"events\":[]}",
    signal,
  });
  assert.equal(await proxied.text(), "chromium");
  assert.equal(h.chromiumCalls.length, 1);
  const [{ url, init }] = h.chromiumCalls;
  assert.equal(url, "https://api.nextbrowser.com/v1/client-errors");
  assert.equal(init.method, "POST");
  assert.equal(init.body, "{\"events\":[]}");
  assert.equal(init.headers.traceparent, "00-a-b-01");
  assert.equal(init.signal, signal, "the caller's signal reaches net.fetch");
  assert.equal(init.credentials, "omit", "no cookies from the window's session");
  assert.equal(init.cache, "no-store", "no HTTP cache, like Node's fetch");
  assert.deepEqual(h.lookups, ["https://direct.test", "https://api.nextbrowser.com"], "looked up by origin");
  assert.deepEqual(h.logs, ["[network] https://api.nextbrowser.com: main-process requests go through the system proxy (PROXY loopback:8888) with Electron net.fetch"]);
});

test("the route is cached per origin for 30 seconds; a failed lookup counts as DIRECT and is not cached", async () => {
  let route = "PROXY 127.0.0.1:8888";
  const h = harness({ routes: () => route });
  await Promise.all([h.proxy.fetch("https://api.test/a"), h.proxy.fetch("https://api.test/b")]);
  assert.equal(h.lookups.length, 1, "concurrent requests share one lookup");
  h.advance(29_000);
  await h.proxy.fetch("https://api.test/c");
  assert.equal(h.lookups.length, 1);
  route = "DIRECT";
  h.advance(2_000);
  await h.proxy.fetch("https://api.test/d");
  assert.equal(h.lookups.length, 2);
  assert.equal(h.chromiumCalls.length, 3);
  assert.equal(h.nodeCalls.length, 1);
  assert.equal(h.logs.at(-1), "[network] https://api.test: main-process requests go direct again");

  const failing = harness({ routes: () => new Error("The session is not ready") });
  await failing.proxy.fetch("https://api.test/a");
  await failing.proxy.fetch("https://api.test/b");
  assert.equal(failing.nodeCalls.length, 2, "without an answer the request goes direct");
  assert.equal(failing.lookups.length, 2, "and the next request asks again");
  assert.deepEqual(failing.logs, [], "a direct route is not worth a log line");
});

test("Chromium errors become the Node.js errors the report classification knows", async () => {
  const cases = {
    "net::ERR_NAME_NOT_RESOLVED": ["ENOTFOUND", "network"],
    "net::ERR_CONNECTION_REFUSED": ["ECONNREFUSED", "network"],
    "net::ERR_CONNECTION_RESET": ["ECONNRESET", "network"],
    "net::ERR_TIMED_OUT": ["ETIMEDOUT", "network"],
    "net::ERR_PROXY_CONNECTION_FAILED": ["ERR_PROXY_CONNECTION_FAILED", "network"],
    "net::ERR_TUNNEL_CONNECTION_FAILED": ["ERR_TUNNEL_CONNECTION_FAILED", "network"],
    "net::ERR_CERT_AUTHORITY_INVALID": ["SELF_SIGNED_CERT_IN_CHAIN", "network"],
    "net::ERR_CERT_REVOKED": ["ERR_CERT_REVOKED", "network"],
  };
  for (const [message, [code, kind]] of Object.entries(cases)) {
    const h = harness({ routes: () => "PROXY 127.0.0.1:8888", netFetch: async () => { throw new Error(message); } });
    const error = await h.proxy.fetch("https://api.nextbrowser.com/v1/x").catch((thrown) => thrown);
    assert.equal(error.name, "TypeError", message);
    assert.equal(error.message, "fetch failed");
    assert.equal(error.cause.code, code, message);
    const { event } = describeBackendRequest({ url: "https://api.nextbrowser.com/v1/x", method: "GET", error, traceId: "a".repeat(32) });
    assert.equal(event.kind, kind, message);
    assert.equal(event.context.network_error, code);
  }
  const offline = chromiumNetworkError(new Error("net::ERR_INTERNET_DISCONNECTED"));
  assert.equal(offline.cause.code, "ENETUNREACH");
  assert.equal(describeBackendRequest({ url: "https://api.nextbrowser.com/v1/x", method: "GET", error: offline }).event, null, "an offline computer stays a breadcrumb");
  const other = new Error("Invalid header value");
  assert.equal(chromiumNetworkError(other), other, "anything else is passed through");
});

test("a timeout or an abort ends a proxied request, whatever net.fetch does", async () => {
  let late;
  const h = harness({
    routes: () => "PROXY 127.0.0.1:8888",
    netFetch: () => new Promise((_, reject) => { late = reject; }),
  });
  const timedOut = await h.proxy.fetch("https://api.test/x", { signal: AbortSignal.timeout(20) }).catch((error) => error);
  assert.equal(timedOut.name, "TimeoutError");
  assert.equal(describeBackendRequest({ url: "https://api.test/x", method: "GET", error: timedOut }).event.kind, "network");
  late(new Error("net::ERR_ABORTED"));
  const controller = new AbortController();
  const pending = h.proxy.fetch("https://api.test/y", { signal: controller.signal }).catch((error) => error);
  controller.abort();
  assert.equal((await pending).name, "AbortError");
  const already = await h.proxy.fetch("https://api.test/z", { signal: AbortSignal.abort() }).catch((error) => error);
  assert.equal(already.name, "AbortError");
});

test("traced backend calls use the installed transport unless the caller brings a fetch", async (t) => {
  const seen = [];
  setBackendTransport(async (url, init) => {
    seen.push({ url, traceparent: init.headers.traceparent });
    return new Response("{}", { status: 200 });
  });
  t.after(() => setBackendTransport(null));
  await tracedBackendFetch()("https://api.test/v1/projects", { headers: {} });
  assert.equal(seen.length, 1);
  assert.match(seen[0].traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  let own = 0;
  await tracedBackendFetch(async () => { own += 1; return new Response("{}", { status: 200 }); })("https://api.test/v1/x");
  assert.equal(own, 1);
  assert.equal(seen.length, 1);
});

test("child processes get the system proxy as variables Go reads, unless the user set their own", () => {
  const plain = { PATH: "/usr/bin", HOME: "/Users/alice" };
  assert.deepEqual(childProxyEnv(plain, "PROXY 127.0.0.1:10808; DIRECT"), {
    HTTP_PROXY: "http://127.0.0.1:10808",
    HTTPS_PROXY: "http://127.0.0.1:10808",
    NO_PROXY: CHILD_NO_PROXY,
  });
  assert.deepEqual(childProxyEnv(plain, "HTTPS proxy.corp.example.com:443"), {
    HTTP_PROXY: "https://proxy.corp.example.com:443",
    HTTPS_PROXY: "https://proxy.corp.example.com:443",
    NO_PROXY: CHILD_NO_PROXY,
  });
  // Go reads no ALL_PROXY: a SOCKS proxy goes into HTTP(S)_PROXY as socks5://.
  assert.deepEqual(childProxyEnv(plain, "SOCKS5 127.0.0.1:10808"), {
    HTTP_PROXY: "socks5://127.0.0.1:10808",
    HTTPS_PROXY: "socks5://127.0.0.1:10808",
    ALL_PROXY: "socks5h://127.0.0.1:10808",
    NO_PROXY: CHILD_NO_PROXY,
  });
  assert.equal(childProxyEnv(plain, "SOCKS 127.0.0.1:1080").HTTPS_PROXY, "socks5://127.0.0.1:1080");
  assert.equal(childProxyEnv(plain, "PROXY [::1]:8080").HTTP_PROXY, "http://[::1]:8080");
  assert.deepEqual(childProxyEnv(plain, "DIRECT"), {}, "direct: nothing changes");
  assert.deepEqual(childProxyEnv(plain, ""), {});
  assert.deepEqual(childProxyEnv(plain, "DIRECT; PROXY 127.0.0.1:8888"), {}, "Chromium tries direct first");
  assert.deepEqual(childProxyEnv(plain, "SOCKS4 127.0.0.1:1080"), {}, "no Go client for SOCKS4");
  assert.deepEqual(childProxyEnv(plain, "PROXY 127.0.0.1"), {}, "no port, no variable");
  for (const name of ["HTTP_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"]) {
    assert.deepEqual(childProxyEnv({ ...plain, [name]: "http://10.0.0.1:3128" }, "PROXY 127.0.0.1:10808"), {}, `the user's ${name} wins`);
  }
  assert.equal(childProxyEnv({ ...plain, HTTPS_PROXY: "" }, "PROXY 127.0.0.1:10808").HTTPS_PROXY, "http://127.0.0.1:10808", "an empty variable is unset");
  assert.deepEqual(childProxyEnv({ ...plain, NO_PROXY: "corp.example.com" }, "PROXY 127.0.0.1:10808").NO_PROXY, CHILD_NO_PROXY);
  for (const host of ["localhost", "127.0.0.1", "::1"]) assert.ok(CHILD_NO_PROXY.split(",").includes(host), `${host} stays direct`);
});

test("the proxy variable names to forward are the ones set, in any case", () => {
  assert.deepEqual(proxyEnvNames({ PATH: "/bin", HTTPS_PROXY: "http://127.0.0.1:1", no_proxy: "localhost", ALL_PROXY: "", http_proxy: "x" }), ["HTTPS_PROXY", "no_proxy", "http_proxy"]);
  assert.deepEqual(proxyEnvNames({ PATH: "/bin" }), []);
});

test("a lookup Chromium did not answer is marked, so the child environment keeps its last value", async () => {
  const proxy = createSystemProxy({ resolveProxy: async () => { throw new Error("not ready"); }, netFetch: async () => new Response(""), fetchImpl: async () => new Response("") });
  assert.deepEqual(await proxy.route("https://api.nextbrowser.com"), { value: "DIRECT", failed: true });
  assert.equal(await proxy.resolve("https://api.nextbrowser.com"), "DIRECT");
  const slow = createSystemProxy({ resolveProxy: () => new Promise(() => {}), resolveTimeoutMs: 10, netFetch: async () => new Response(""), fetchImpl: async () => new Response("") });
  assert.deepEqual(await slow.route("https://api.nextbrowser.com"), { value: "DIRECT", failed: true });
});
