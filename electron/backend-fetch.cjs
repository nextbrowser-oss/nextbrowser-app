const { randomBytes } = require("node:crypto");
const { apiRoute } = require("./client-error-scrub.cjs");

// Every request the app itself sends to a Nextbrowser backend carries a W3C
// traceparent, so a failed call reported from the desktop opens the matching
// server trace. The observer (installed by the main process) turns each request
// into a breadcrumb and reports network failures and 5xx responses. Third-party
// services (GitHub, Multilogin, downloads) are deliberately not traced.

let observer = null;
// Who is calling, so the backend's request log names the app and its version.
let clientHeaders = {};

function setBackendRequestObserver(fn) {
  observer = typeof fn === "function" ? fn : null;
}

function setBackendClientInfo({ name, version } = {}) {
  clientHeaders = {};
  if (name) clientHeaders["x-client-name"] = String(name);
  if (version) clientHeaders["x-client-version"] = String(version);
}

function newTraceContext(random = randomBytes) {
  let traceId = random(16).toString("hex");
  let spanId = random(8).toString("hex");
  // All-zero ids are invalid in W3C Trace Context.
  if (/^0+$/.test(traceId)) traceId = `${traceId.slice(0, 31)}1`;
  if (/^0+$/.test(spanId)) spanId = `${spanId.slice(0, 15)}1`;
  return { traceId, spanId, traceparent: `00-${traceId}-${spanId}-01` };
}

function withTraceparent(headers, traceparent) {
  if (headers && typeof headers.set === "function" && typeof headers.entries === "function") {
    const next = new Headers(headers);
    for (const [name, value] of Object.entries(clientHeaders)) {
      if (!next.has(name)) next.set(name, value);
    }
    next.set("traceparent", traceparent);
    return next;
  }
  return { ...clientHeaders, ...(headers || {}), traceparent };
}

function responseHeader(response, name) {
  try {
    return String(response?.headers?.get?.(name) || "").trim();
  } catch {
    return "";
  }
}

function notify(info) {
  if (!observer) return;
  try {
    observer(info);
  } catch {
    // Observing a request must never change its outcome.
  }
}

/** Wraps a fetch implementation for calls to Nextbrowser backends. */
function tracedBackendFetch(fetchImpl = (...args) => fetch(...args)) {
  return async function backendFetch(url, init = {}) {
    const trace = newTraceContext();
    const method = String(init.method || "GET").toUpperCase();
    const startedAt = Date.now();
    let response;
    try {
      response = await fetchImpl(url, { ...init, headers: withTraceparent(init.headers, trace.traceparent) });
    } catch (error) {
      notify({ url: String(url), method, error, traceId: trace.traceId, durationMs: Date.now() - startedAt });
      throw error;
    }
    notify({
      url: String(url),
      method,
      status: Number(response?.status) || 0,
      traceId: trace.traceId,
      responseTraceId: responseHeader(response, "x-trace-id"),
      requestId: responseHeader(response, "x-request-id"),
      durationMs: Date.now() - startedAt,
    });
    return response;
  };
}

function networkErrorCode(error) {
  const cause = error?.cause;
  const code = typeof cause?.code === "string" ? cause.code : typeof error?.code === "string" ? error.code : "";
  return code || String(error?.name || "NetworkError");
}

/**
 * Turns one observed backend request into a breadcrumb and, for a network
 * failure or a 5xx response, an api_error event. 4xx responses are ordinary
 * outcomes (signed out, not found, conflict) that the UI already handles.
 */
function describeBackendRequest({ url, method, status, error, traceId, responseTraceId, requestId, durationMs }) {
  const route = apiRoute(url);
  const target = `${route.host}${route.path}`;
  const outcome = error ? networkErrorCode(error) : String(status);
  const breadcrumb = `${method} ${target} → ${outcome}`;
  // A caller that aborts its own request has not hit a failure.
  if (error && error.name === "AbortError") return { breadcrumb, event: null };
  if (!error && !(status >= 500)) return { breadcrumb, event: null };
  const context = {
    method,
    host: route.host,
    path: route.path,
    duration_ms: String(Math.max(0, Math.round(Number(durationMs) || 0))),
    ...(error ? { network_error: outcome } : { status: String(status) }),
  };
  const event = {
    source: "main",
    kind: "api_error",
    name: error ? `${outcome} ${method} ${route.path}` : `HTTP ${status} ${method} ${route.path}`,
    message: error
      ? `${method} ${target} failed: ${String(error?.message || error)}${error?.cause?.message ? ` (${error.cause.message})` : ""}`
      : `${method} ${target} returned HTTP ${status}`,
    // The backend names its own trace in X-Trace-Id; without it, the trace
    // id this request sent in traceparent is the link.
    trace_id: /^[0-9a-f]{32}$/i.test(responseTraceId || "") ? responseTraceId.toLowerCase() : traceId,
    ...(requestId ? { request_id: requestId } : {}),
    context,
  };
  return { breadcrumb, event };
}

module.exports = {
  describeBackendRequest,
  newTraceContext,
  setBackendClientInfo,
  setBackendRequestObserver,
  tracedBackendFetch,
  withTraceparent,
};
