const net = require("node:net");

// The main process follows the operating system's proxy settings.
//
// Chromium (the app window, Live View, the app updater) follows the macOS and
// Windows system proxy and PAC files. Node's global fetch (undici), which the
// main process uses for backend calls, downloads and error reports, ignores
// them and always goes direct. VPN clients in "system proxy" mode (Happ and
// other Xray, sing-box and Clash based apps) set the system proxy to
// 127.0.0.1:<port> and leave the routes alone, so when the direct path to
// api.nextbrowser.com is blocked or its DNS is broken, the window works while
// the main process gets ENOTFOUND or timeouts. The fix: ask Chromium how it
// would reach the URL (session.resolveProxy, cached per origin). Anything but
// DIRECT goes through Electron's net.fetch, which is Chromium's network stack
// (system proxy, PAC, DNS through the proxy). DIRECT keeps Node's fetch, so
// nothing changes for users without a proxy.

const CACHE_MS = 30_000;
const RESOLVE_TIMEOUT_MS = 2_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** A PAC-style list ("PROXY 127.0.0.1:8080; DIRECT") as [{ type, host, port }]. */
function parseProxyList(value) {
  return String(value || "").split(";").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const match = entry.match(/^([A-Za-z0-9]+)(?:\s+(\S+))?$/);
    if (!match) return { type: "OTHER", host: "", port: "" };
    const type = match[1].toUpperCase();
    const hostPort = match[2] || "";
    const bracketed = hostPort.match(/^\[([^\]]+)\](?::(\d{1,5}))?$/);
    const plain = hostPort.match(/^([^:]+)(?::(\d{1,5}))?$/);
    const [host, port] = bracketed ? [bracketed[1], bracketed[2] || ""] : plain ? [plain[1], plain[2] || ""] : [hostPort, ""];
    return { type, host, port };
  });
}

/** True when Chromium would connect directly: an empty list or DIRECT first. */
function isDirectList(value) {
  const [first] = parseProxyList(value);
  return !first || first.type === "DIRECT";
}

function isLoopbackHost(host) {
  const value = String(host || "").toLowerCase();
  if (LOOPBACK_HOSTS.has(value) || value.endsWith(".localhost")) return true;
  return net.isIP(value) === 4 && value.startsWith("127.");
}

/** True when the first proxy Chromium would use runs on this computer (a VPN app in system-proxy mode). */
function isLoopbackProxyList(value) {
  const [first] = parseProxyList(value);
  return !!first && first.type !== "DIRECT" && isLoopbackHost(first.host);
}

/** The list with loopback ports only, safe for a local log line: "PROXY loopback:8888". */
function describeProxyRoute(value) {
  return parseProxyList(value).slice(0, 3).map(({ type, host, port }) => {
    if (type === "DIRECT") return "DIRECT";
    if (isLoopbackHost(host)) return `${type} loopback${port ? `:${port}` : ""}`;
    return `${type} ${net.isIP(host) ? "address" : "host"}`;
  }).join(", ") || "DIRECT";
}

// Chromium names a failed request net::ERR_*. The same failures from Node's
// fetch are a TypeError("fetch failed") with the Node.js code in its cause,
// which is what backend-fetch.cjs classifies (kind network, network_error).
// Mapped here so a request sent through the proxy is reported the same way.
// Codes without a Node.js counterpart (a proxy that refused the connection
// or the tunnel) keep Chromium's name and are still kind network.
const CHROMIUM_ERRORS = new Map([
  ["ERR_NAME_NOT_RESOLVED", "ENOTFOUND"],
  ["ERR_NAME_RESOLUTION_FAILED", "EAI_AGAIN"],
  ["ERR_CONNECTION_REFUSED", "ECONNREFUSED"],
  ["ERR_CONNECTION_RESET", "ECONNRESET"],
  ["ERR_CONNECTION_CLOSED", "ECONNRESET"],
  ["ERR_CONNECTION_ABORTED", "ECONNRESET"],
  ["ERR_EMPTY_RESPONSE", "ECONNRESET"],
  ["ERR_NETWORK_CHANGED", "ECONNRESET"],
  ["ERR_CONNECTION_TIMED_OUT", "ETIMEDOUT"],
  ["ERR_TIMED_OUT", "ETIMEDOUT"],
  ["ERR_ADDRESS_UNREACHABLE", "EHOSTUNREACH"],
  ["ERR_INTERNET_DISCONNECTED", "ENETUNREACH"],
  ["ERR_SSL_PROTOCOL_ERROR", "EPROTO"],
  ["ERR_CERT_DATE_INVALID", "CERT_HAS_EXPIRED"],
  ["ERR_CERT_COMMON_NAME_INVALID", "ERR_TLS_CERT_ALTNAME_INVALID"],
  ["ERR_CERT_AUTHORITY_INVALID", "SELF_SIGNED_CERT_IN_CHAIN"],
]);

/** A net.fetch failure as Node's fetch would have thrown it; anything else unchanged. */
function chromiumNetworkError(error) {
  const message = String(error?.message || error || "");
  const chromium = message.match(/\bnet::(ERR_[A-Z0-9_]+)/)?.[1];
  if (!chromium) return error;
  const code = CHROMIUM_ERRORS.get(chromium) || chromium;
  const cause = Object.assign(new Error(`${code === chromium ? "" : `${code} `}(net::${chromium} through the system proxy)`.trim()), { code, chromiumCode: chromium });
  return new TypeError("fetch failed", { cause });
}

function abortReason(signal) {
  return signal?.reason ?? new DOMException("This operation was aborted", "AbortError");
}

function requestURL(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return String(input?.url || input || "");
}

/**
 * Creates the proxy-aware fetch for the main process and the proxy lookup
 * behind it. `resolveProxy(url)` is Electron's session.resolveProxy and
 * `netFetch` is Electron's net.fetch; both are injected so tests need no
 * Electron. A lookup that fails or takes too long (before the app is ready,
 * for example) counts as DIRECT and is not cached.
 */
function createSystemProxy({
  resolveProxy,
  netFetch,
  fetchImpl = (...args) => fetch(...args),
  now = () => Date.now(),
  cacheMs = CACHE_MS,
  resolveTimeoutMs = RESOLVE_TIMEOUT_MS,
  log = () => {},
} = {}) {
  const cache = new Map();
  const lastRoute = new Map();

  function lookup(url) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ value: "DIRECT", failed: true }), resolveTimeoutMs);
      timer.unref?.();
      Promise.resolve()
        .then(() => resolveProxy(url))
        .then((value) => resolve({ value: String(value || "DIRECT") }), () => resolve({ value: "DIRECT", failed: true }))
        .finally(() => clearTimeout(timer));
    });
  }

  /** How Chromium would reach this URL ("DIRECT", "PROXY 127.0.0.1:8888", ...), cached per origin. */
  async function resolve(url) {
    let origin;
    try {
      const parsed = new URL(requestURL(url));
      if (!/^(?:https?|wss?):$/.test(parsed.protocol)) return "DIRECT";
      origin = parsed.origin;
    } catch {
      return "DIRECT";
    }
    const cached = cache.get(origin);
    if (cached && (cached.pending || now() - cached.at <= cacheMs)) return (await cached.promise).value;
    const entry = { pending: true, at: now() };
    entry.promise = lookup(origin).then((result) => {
      entry.pending = false;
      entry.at = now();
      if (result.failed) cache.delete(origin);
      const route = isDirectList(result.value) ? "DIRECT" : describeProxyRoute(result.value);
      if (lastRoute.get(origin) !== route && (route !== "DIRECT" || lastRoute.has(origin))) {
        log(route === "DIRECT"
          ? `[network] ${origin}: main-process requests go direct again`
          : `[network] ${origin}: main-process requests go through the system proxy (${route}) with Electron net.fetch`);
      }
      lastRoute.set(origin, route);
      return result;
    });
    cache.set(origin, entry);
    return (await entry.promise).value;
  }

  async function viaChromium(url, init) {
    const signal = init?.signal;
    if (signal?.aborted) throw abortReason(signal);
    // No cookies or HTTP cache of the app window's session: the request must
    // behave like the Node.js fetch it replaces.
    const request = Promise.resolve().then(() => netFetch(url, { credentials: "omit", cache: "no-store", ...init }));
    let onAbort;
    const aborted = signal ? new Promise((_, reject) => {
      onAbort = () => reject(abortReason(signal));
      signal.addEventListener("abort", onAbort, { once: true });
    }) : null;
    // A request that fails after its caller gave up must not become an
    // unhandled rejection.
    request.catch(() => undefined);
    try {
      return await (aborted ? Promise.race([request, aborted]) : request);
    } catch (error) {
      if (signal?.aborted && error === abortReason(signal)) throw error;
      throw chromiumNetworkError(error);
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  /** fetch(url, init) through the system proxy when Chromium would use one, else Node's fetch. */
  async function proxyAwareFetch(url, init = {}) {
    const route = await resolve(url);
    if (isDirectList(route)) return fetchImpl(url, init);
    return viaChromium(requestURL(url), init);
  }

  return { fetch: proxyAwareFetch, resolve };
}

module.exports = {
  CHROMIUM_ERRORS,
  chromiumNetworkError,
  createSystemProxy,
  describeProxyRoute,
  isDirectList,
  isLoopbackHost,
  isLoopbackProxyList,
  parseProxyList,
};
