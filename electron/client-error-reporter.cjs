const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { createScrubber, normalizeMessage, normalizeStackFrames, truncateBytes } = require("./client-error-scrub.cjs");

// Client error reports: events are scrubbed and folded here, kept in a small
// queue in userData, and sent in batches to the Nextbrowser backend
// (POST /v1/client-errors), which forwards them to the log system. The
// reporter is best effort by design: nothing in it may throw into the app, and
// its own failures are written only to a local log, never reported.

const SOURCES = new Set(["renderer", "main", "nbc", "agent"]);
// "network" is a request that got no answer through the user's connection
// (nbc-failure-report.cjs, backend-fetch.cjs): kept apart from product failures.
const KINDS = new Set(["exception", "unhandled_rejection", "react_render", "api_error", "process_gone", "command_failed", "network"]);
// command_failed from the renderer is an error the app showed the user
// (src/lib/errorReporting.ts reportUserFacingError). It carries identifiers
// only; see userFacingFailure below.
const RENDERER_KINDS = new Set(["exception", "unhandled_rejection", "react_render", "command_failed"]);
const BREADCRUMB_CATEGORIES = new Set(["navigation", "ipc", "api", "ui", "nbc"]);
// The renderer only reports what it saw: where the user went and what they
// clicked. IPC, API and nbc breadcrumbs are recorded by the main process.
const RENDERER_BREADCRUMB_CATEGORIES = new Set(["navigation", "ui"]);
// View names and UI action names are code identifiers. Anything else from the
// renderer is dropped rather than scrubbed, so free text cannot slip in.
const IDENTIFIER = /^[A-Za-z0-9_.:/-]{1,100}$/;
// Where the user saw a failure (kebab-case), its error code, the Ref the user
// read, for a stall how long it lasted (milliseconds) and the stage it
// stalled in (snake_case), and for a failed profile start what nbc reported:
// its code, the code behind it (nextctl's, or the backend's in lower case,
// such as migration_failed) and the class of the cause (src/lib/
// userFacingBrowserError.ts browserFailureCause): the whole vocabulary of a
// user-facing failure report.
const SURFACE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const ERROR_REF = /^NB-[0-9A-F]{8}(?:-[0-9A-F]{4})?$/;
const ELAPSED_MS = /^\d{1,10}$/;
const STAGE = /^[a-z][a-z0-9_]{0,63}$/;
const CAUSE_CODE = /^[A-Za-z][A-Za-z0-9_]{1,63}$/;
const CAUSE_CLASSES = new Set(["migration", "proxy_check", "launch", "install", "timeout", "other"]);

const LIMITS = Object.freeze({
  name: 200,
  message: 2_000,
  stack: 16_000,
  fingerprint: 128,
  view: 200,
  action: 200,
  requestId: 128,
  breadcrumbs: 30,
  breadcrumbMessage: 300,
  contextKeys: 30,
  contextKey: 64,
  contextValue: 500,
  count: 10_000,
  batchEvents: 20,
});

const DEFAULTS = Object.freeze({
  flushIntervalMs: 30_000,
  flushThreshold: 10,
  soonMs: 1_000,
  persistDebounceMs: 500,
  requestTimeoutMs: 10_000,
  backoffBaseMs: 30_000,
  backoffMaxMs: 15 * 60_000,
  retryAfterDefaultMs: 60_000,
  retryAfterMaxMs: 60 * 60_000,
  foldWindowMs: 10 * 60_000,
  maxQueue: 200,
  maxQueueBytes: 2 * 1024 * 1024,
  maxBatchBytes: 256 * 1024,
  maxEventAgeMs: 7 * 24 * 60 * 60_000,
  maxEventsPerRun: 200,
  maxEventsPerFingerprint: 20,
  logMaxBytes: 256 * 1024,
  // How long a send waits for the extra context of an event (see `enrich`).
  enrichWaitMs: 5_000,
});
// Keys a folded report adds later; extra context leaves room for them.
const FOLD_KEYS = ["last_occurred_at", "last_ref"];

/**
 * Reporting is off in development and unpackaged builds unless
 * NEXTBROWSER_ERROR_REPORTING=1, and NEXTBROWSER_ERROR_REPORTING=0 turns it
 * off in any build.
 */
function errorReportingAllowed({ isDevBuild, env = process.env }) {
  const flag = String(env.NEXTBROWSER_ERROR_REPORTING ?? "").trim();
  if (flag === "0") return false;
  if (flag === "1") return true;
  return !isDevBuild;
}

function utf8(value, maxBytes) {
  return truncateBytes(value, maxBytes);
}

function cleanString(value, maxBytes, scrub) {
  if (value == null) return "";
  let raw = typeof value === "string" ? value : String(value);
  // Scrub a bounded slice: a runaway message must not stall the main process.
  // The margin keeps the cut far beyond what survives the final truncation.
  if (raw.length > maxBytes * 4) raw = raw.slice(0, maxBytes * 4);
  const text = scrub(raw).trim();
  return text ? utf8(text, maxBytes) : "";
}

function cleanContext(raw, scrub) {
  const context = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return context;
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    if (Object.keys(context).length >= LIMITS.contextKeys) break;
    if (rawValue == null || !["string", "number", "boolean"].includes(typeof rawValue)) continue;
    const key = String(rawKey).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, LIMITS.contextKey);
    const value = cleanString(rawValue, LIMITS.contextValue, scrub);
    if (key && value) context[key] = value;
  }
  return context;
}

/**
 * The context of a user-facing failure the renderer reports, or null when the
 * payload holds anything but these identifiers. Such a report never carries
 * text: the message the user read may quote an agent's reply or a page, so a
 * payload that does not match is refused rather than scrubbed.
 */
function userFacingFailure(payload) {
  const context = payload.context;
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;
  const { surface, code, ref, elapsed_ms: elapsed, stage, nbc_code: nbcCode, cause_code: causeCode, cause, ...rest } = context;
  if (Object.keys(rest).length) return null;
  if (typeof surface !== "string" || surface.length > 64 || !SURFACE.test(surface)) return null;
  if (typeof code !== "string" || !ERROR_CODE.test(code)) return null;
  if (ref !== undefined && (typeof ref !== "string" || !ERROR_REF.test(ref))) return null;
  if (elapsed !== undefined && (typeof elapsed !== "string" || !ELAPSED_MS.test(elapsed))) return null;
  if (stage !== undefined && (typeof stage !== "string" || !STAGE.test(stage))) return null;
  if (nbcCode !== undefined && (typeof nbcCode !== "string" || !ERROR_CODE.test(nbcCode))) return null;
  if (causeCode !== undefined && (typeof causeCode !== "string" || !CAUSE_CODE.test(causeCode))) return null;
  if (cause !== undefined && !CAUSE_CLASSES.has(cause)) return null;
  if (payload.name !== code || payload.message !== `${surface}: ${code}`) return null;
  if (payload.stack !== undefined && payload.stack !== "") return null;
  return {
    surface,
    code,
    ...(ref ? { ref } : {}),
    ...(elapsed ? { elapsed_ms: elapsed } : {}),
    ...(stage ? { stage } : {}),
    ...(nbcCode ? { nbc_code: nbcCode } : {}),
    ...(causeCode ? { cause_code: causeCode } : {}),
    ...(cause ? { cause } : {}),
  };
}

function cleanTraceId(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{32}$/.test(id) && !/^0+$/.test(id) ? id : "";
}

function cleanRequestId(value) {
  const id = String(value || "").trim();
  return /^[\x21-\x7e]{1,128}$/.test(id) ? id : "";
}

function fingerprintFor(event, extra = "") {
  const frames = normalizeStackFrames(event.stack);
  const basis = [event.kind, event.name, ...(frames.length ? frames : [normalizeMessage(event.message)]), extra];
  return createHash("sha256").update(basis.join("\n")).digest("hex").slice(0, 32);
}

function createBreadcrumbTrail({ now, scrub, limit = LIMITS.breadcrumbs }) {
  const items = [];
  return {
    add(category, message) {
      if (!BREADCRUMB_CATEGORIES.has(category)) return;
      // Room for the " (×N)" repeat suffix.
      const text = cleanString(message, LIMITS.breadcrumbMessage - 16, scrub);
      if (!text) return;
      const at = new Date(now()).toISOString();
      const last = items[items.length - 1];
      // Polling would otherwise push everything useful out of the trail.
      if (last && last.category === category && last.message === text) {
        last.repeat += 1;
        last.at = at;
        return;
      }
      items.push({ at, category, message: text, repeat: 1 });
      if (items.length > limit) items.shift();
    },
    snapshot() {
      return items.map(({ at, category, message, repeat }) => ({
        at,
        category,
        message: repeat > 1 ? `${message} (×${repeat})` : message,
      }));
    },
  };
}

function parseRetryAfter(value, nowMs) {
  const text = String(value || "").trim();
  if (!text) return undefined;
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : undefined;
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function writeFileAtomicSync(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, content, { encoding: "utf8", mode: 0o600 });
  try {
    fs.renameSync(temp, file);
  } catch (error) {
    if (process.platform !== "win32") {
      fs.rmSync(temp, { force: true });
      throw error;
    }
    fs.rmSync(file, { force: true });
    fs.renameSync(temp, file);
  }
}

function createClientErrorReporter({
  dir,
  client,
  allowed = true,
  resolveEndpoint,
  fetchImpl = (...args) => fetch(...args),
  homeDir,
  platform = process.platform,
  now = () => Date.now(),
  random = Math.random,
  // Pending reports must never keep a process alive on their own. The quit
  // flush is the one exception: its bound is the reason the process waits.
  setTimer = (fn, ms, { keepAlive = false } = {}) => {
    const timer = setTimeout(fn, ms);
    if (!keepAlive) timer.unref?.();
    return timer;
  },
  clearTimer = (timer) => clearTimeout(timer),
  getAction = () => undefined,
  // Optional extra context for a new event, gathered asynchronously (the
  // network diagnostics, network-diagnostics.cjs): called with the event's
  // source, kind, name and context, it returns undefined or a promise of
  // string fields. They are scrubbed and added while the context has room,
  // and a send waits up to enrichWaitMs for them.
  enrich,
  options = {},
} = {}) {
  const config = { ...DEFAULTS, ...options };
  const scrub = createScrubber({ homeDir, platform });
  const statePath = path.join(dir, "state.json");
  const queuePath = path.join(dir, "queue.json");
  const logPath = path.join(dir, "reporter.log");
  const trail = createBreadcrumbTrail({ now, scrub });
  const sessionId = randomUUID();

  let state = readJSON(statePath);
  if (!state || typeof state !== "object" || typeof state.install_id !== "string" || !/^[0-9a-f-]{36}$/i.test(state.install_id)) {
    state = { install_id: randomUUID(), enabled: state?.enabled !== false };
  }
  let userEnabled = state.enabled !== false;
  let queue = [];
  let view = "";
  let nbcVersion = "";
  let flushTimer = null;
  let flushAt = 0;
  let persistTimer = null;
  let sending = null;
  let disabledForRun = false;
  let anonymousForRun = false;
  let nextAttemptAt = 0;
  let failures = 0;
  let batchLimit = LIMITS.batchEvents;
  let capturing = false;
  let capturedThisRun = 0;
  const perFingerprint = new Map();
  let droppedLogged = false;

  function log(message) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      try {
        if (fs.statSync(logPath).size > config.logMaxBytes) fs.renameSync(logPath, `${logPath}.1`);
      } catch { /* first write */ }
      fs.appendFileSync(logPath, `${new Date(now()).toISOString()} ${message}\n`);
    } catch {
      // Nowhere left to report to; the reporter must stay silent.
    }
  }

  function active() {
    return allowed && userEnabled;
  }

  function saveState() {
    try {
      writeFileAtomicSync(statePath, `${JSON.stringify({ install_id: state.install_id, enabled: userEnabled })}\n`);
    } catch (error) {
      log(`state write failed: ${error?.code || error?.message || error}`);
    }
  }

  function clientSnapshot() {
    return {
      app: "nextbrowser-app",
      version: utf8(String(client?.version || "unknown"), 64),
      platform: String(client?.platform || process.platform),
      arch: String(client?.arch || process.arch),
      os_version: utf8(String(client?.os_version || ""), 128),
      ...(nbcVersion ? { nbc_version: nbcVersion } : {}),
      session_id: sessionId,
      install_id: state.install_id,
    };
  }

  function loadQueue() {
    const stored = readJSON(queuePath);
    if (!Array.isArray(stored)) return [];
    const oldest = now() - config.maxEventAgeMs;
    return stored.filter((entry) => (
      entry && typeof entry === "object"
      && entry.client && typeof entry.client.session_id === "string"
      && entry.event && KINDS.has(entry.event.kind) && typeof entry.event.id === "string"
      && Date.parse(entry.event.occurred_at) >= oldest
    )).slice(-config.maxQueue);
  }

  function boundQueue() {
    if (queue.length > config.maxQueue) queue = queue.slice(-config.maxQueue);
    let bytes = Buffer.byteLength(JSON.stringify(queue), "utf8");
    while (queue.length > 1 && bytes > config.maxQueueBytes) {
      bytes -= Buffer.byteLength(JSON.stringify(queue.shift()), "utf8");
    }
  }

  function persistSync() {
    if (persistTimer) {
      clearTimer(persistTimer);
      persistTimer = null;
    }
    try {
      if (!queue.length) {
        fs.rmSync(queuePath, { force: true });
        return;
      }
      writeFileAtomicSync(queuePath, JSON.stringify(queue.map(({ client: entryClient, event, lastAt }) => ({ client: entryClient, event, lastAt }))));
    } catch (error) {
      log(`queue write failed: ${error?.code || error?.message || error}`);
    }
  }

  function schedulePersist() {
    if (persistTimer) return;
    persistTimer = setTimer(() => {
      persistTimer = null;
      persistSync();
    }, config.persistDebounceMs);
  }

  function scheduleFlush(delayMs) {
    if (!active() || disabledForRun || !queue.length) return;
    const at = Math.max(now() + delayMs, nextAttemptAt);
    if (flushTimer && flushAt <= at) return;
    if (flushTimer) clearTimer(flushTimer);
    flushAt = at;
    flushTimer = setTimer(() => {
      flushTimer = null;
      void flush();
    }, Math.max(0, at - now()));
  }

  function normalizeEvent(raw) {
    if (!raw || typeof raw !== "object") return null;
    const kind = String(raw.kind || "");
    const source = String(raw.source || "");
    if (!KINDS.has(kind) || !SOURCES.has(source)) return null;
    const name = cleanString(raw.name, LIMITS.name, scrub) || "Error";
    const event = {
      id: randomUUID(),
      occurred_at: new Date(now()).toISOString(),
      source,
      kind,
      name,
      message: cleanString(raw.message, LIMITS.message, scrub) || name,
      count: 1,
    };
    const stack = cleanString(raw.stack, LIMITS.stack, scrub);
    if (stack) event.stack = stack;
    const eventView = cleanString(raw.view || view, LIMITS.view, scrub);
    if (eventView) event.view = eventView;
    const action = cleanString(raw.action || getAction(), LIMITS.action, scrub);
    if (action) event.action = action;
    const traceId = cleanTraceId(raw.trace_id);
    if (traceId) event.trace_id = traceId;
    const requestId = cleanRequestId(raw.request_id);
    if (requestId) event.request_id = requestId;
    const breadcrumbs = trail.snapshot();
    if (breadcrumbs.length) event.breadcrumbs = breadcrumbs;
    const context = cleanContext(raw.context, scrub);
    if (Object.keys(context).length) event.context = context;
    event.fingerprint = utf8(fingerprintFor(event, typeof raw.fingerprintExtra === "string" ? raw.fingerprintExtra : ""), LIMITS.fingerprint);
    return event;
  }

  function fold(event) {
    const oldest = now() - config.foldWindowMs;
    const existing = queue.find((entry) => (
      entry.client.session_id === sessionId
      && entry.event.fingerprint === event.fingerprint
      && !entry.sending
      && (entry.lastAt ?? 0) >= oldest
    ));
    if (!existing) return false;
    existing.event.count = Math.min(LIMITS.count, existing.event.count + 1);
    existing.lastAt = now();
    const context = existing.event.context || {};
    if (context.last_occurred_at || Object.keys(context).length < LIMITS.contextKeys) {
      context.last_occurred_at = event.occurred_at;
      existing.event.context = context;
    }
    // Every Ref names one incident. The folded report keeps the first one and
    // the latest one, which is the one a user most likely sends to support.
    const ref = event.context?.ref;
    if (ref && ref !== context.ref && (context.last_ref || Object.keys(context).length < LIMITS.contextKeys)) {
      context.last_ref = ref;
      existing.event.context = context;
    }
    return true;
  }

  /** Adds extra fields to an event's context: scrubbed, existing keys win, never past the key limit. */
  function addContext(event, extra) {
    if (!extra || typeof extra !== "object" || Array.isArray(extra)) return;
    const context = event.context || {};
    const reserved = FOLD_KEYS.filter((key) => !(key in context)).length;
    for (const [key, value] of Object.entries(cleanContext(extra, scrub))) {
      if (Object.keys(context).length + reserved >= LIMITS.contextKeys) break;
      if (!(key in context)) context[key] = value;
    }
    if (Object.keys(context).length) event.context = context;
  }

  function startEnrichment(entry) {
    if (typeof enrich !== "function") return;
    const { source, kind, name, context } = entry.event;
    const pending = enrich({ source, kind, name, context: { ...context } });
    if (!pending || typeof pending.then !== "function") return;
    entry.enriching = Promise.resolve(pending).then((extra) => {
      if (!queue.includes(entry)) return;
      addContext(entry.event, extra);
      schedulePersist();
    }).catch((error) => {
      log(`enrichment failed: ${error?.message || error}`);
    }).finally(() => {
      delete entry.enriching;
    });
  }

  /** Records an error. Returns true when it was queued or folded. */
  function capture(raw) {
    if (!active() || capturing) return false;
    capturing = true;
    try {
      const event = normalizeEvent(raw);
      if (!event) return false;
      if (!fold(event)) {
        const seen = perFingerprint.get(event.fingerprint) || 0;
        if (capturedThisRun >= config.maxEventsPerRun || seen >= config.maxEventsPerFingerprint) {
          if (!droppedLogged) log("per-run error report limit reached; further events are dropped");
          droppedLogged = true;
          return false;
        }
        capturedThisRun += 1;
        perFingerprint.set(event.fingerprint, seen + 1);
        const entry = { client: clientSnapshot(), event, lastAt: now() };
        queue.push(entry);
        boundQueue();
        try {
          startEnrichment(entry);
        } catch (error) {
          log(`enrichment failed: ${error?.message || error}`);
        }
      }
      schedulePersist();
      const unsent = queue.filter((entry) => !entry.sending).length;
      scheduleFlush(unsent >= config.flushThreshold ? config.soonMs : config.flushIntervalMs);
      return true;
    } catch (error) {
      log(`capture failed: ${error?.message || error}`);
      return false;
    } finally {
      capturing = false;
    }
  }

  function nextBatch() {
    const first = queue.find((entry) => !entry.sending);
    if (!first) return [];
    const key = JSON.stringify(first.client);
    // A backend that does not know the network kind yet refuses a whole batch
    // that holds one (HTTP 400, dropped below), so network events travel in
    // batches of their own and never take a product failure down with them.
    const network = first.event.kind === "network";
    const batch = [];
    let bytes = 0;
    for (const entry of queue) {
      if (entry.sending || JSON.stringify(entry.client) !== key || (entry.event.kind === "network") !== network) continue;
      const size = Buffer.byteLength(JSON.stringify(entry.event), "utf8");
      if (batch.length && bytes + size > config.maxBatchBytes) break;
      batch.push(entry);
      bytes += size;
      if (batch.length >= batchLimit) break;
    }
    return batch;
  }

  function removeEntries(entries) {
    const ids = new Set(entries.map((entry) => entry.event.id));
    queue = queue.filter((entry) => !ids.has(entry.event.id));
  }

  function backoff() {
    failures += 1;
    const base = Math.min(config.backoffMaxMs, config.backoffBaseMs * 2 ** (failures - 1));
    nextAttemptAt = now() + Math.round(base * (0.5 + random()));
  }

  async function sendBatch(batch) {
    let endpoint;
    try {
      endpoint = await resolveEndpoint();
    } catch (error) {
      log(`endpoint unavailable: ${error?.message || error}`);
      backoff();
      return;
    }
    const baseURL = String(endpoint?.baseURL || "").replace(/\/+$/, "");
    if (!/^https?:\/\//.test(baseURL)) {
      log("endpoint unavailable: no API base URL");
      backoff();
      return;
    }
    const apiKey = anonymousForRun ? "" : String(endpoint?.apiKey || "");
    const body = JSON.stringify({ client: batch[0].client, events: batch.map((entry) => entry.event) });
    let response;
    try {
      response = await fetchImpl(`${baseURL}/v1/client-errors`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body,
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      });
    } catch (error) {
      log(`send failed: ${error?.cause?.code || error?.name || "network error"}`);
      backoff();
      return;
    }
    const status = Number(response?.status) || 0;
    if (status >= 200 && status < 300) {
      removeEntries(batch);
      failures = 0;
      nextAttemptAt = 0;
      batchLimit = LIMITS.batchEvents;
      return;
    }
    if (status === 404 || status === 405) {
      // The endpoint is not deployed yet. Keep the queue for a later run.
      disabledForRun = true;
      log(`endpoint returned ${status}; sending is paused until the next launch`);
      return;
    }
    if (status === 429) {
      const delay = parseRetryAfter(response.headers?.get?.("retry-after"), now()) ?? config.retryAfterDefaultMs;
      nextAttemptAt = now() + Math.min(config.retryAfterMaxMs, Math.max(config.soonMs, delay));
      return;
    }
    if (status === 413) {
      if (batch.length > 1) {
        batchLimit = Math.max(1, Math.ceil(batch.length / 2));
        return;
      }
      removeEntries(batch);
      log(`dropped one event the backend refused as too large (${batch[0].event.kind})`);
      return;
    }
    if ((status === 401 || status === 403) && apiKey) {
      // Reports are accepted anonymously; a stale key must not lose them.
      anonymousForRun = true;
      return;
    }
    if (status >= 500) {
      log(`send failed: HTTP ${status}`);
      backoff();
      return;
    }
    removeEntries(batch);
    log(`dropped ${batch.length} event(s) the backend rejected with HTTP ${status}`);
  }

  /** Sends queued events now (respecting backoff). Never rejects. */
  function flush() {
    if (sending) return sending;
    if (!active() || disabledForRun || now() < nextAttemptAt) return Promise.resolve();
    const batch = nextBatch();
    if (!batch.length) return Promise.resolve();
    for (const entry of batch) entry.sending = true;
    sending = (async () => {
      try {
        const pending = batch.map((entry) => entry.enriching).filter(Boolean);
        if (pending.length) {
          let timer;
          await Promise.race([
            Promise.all(pending),
            new Promise((resolve) => { timer = setTimer(resolve, config.enrichWaitMs); }),
          ]);
          clearTimer(timer);
        }
        await sendBatch(batch);
      } catch (error) {
        log(`send failed: ${error?.message || error}`);
        backoff();
      } finally {
        for (const entry of batch) delete entry.sending;
        sending = null;
        persistSync();
        if (queue.length) scheduleFlush(nextAttemptAt > now() ? nextAttemptAt - now() : config.soonMs);
      }
    })();
    return sending;
  }

  /**
   * Makes one bounded attempt to send what is queued before the app quits.
   * Resolves within `timeoutMs`; the queue is saved either way.
   */
  async function flushBeforeQuit(timeoutMs = 2_000) {
    try {
      persistSync();
      if (!pendingCount()) return;
      let timer;
      await Promise.race([
        flush(),
        new Promise((resolve) => { timer = setTimer(resolve, timeoutMs, { keepAlive: true }); }),
      ]);
      clearTimer(timer);
      persistSync();
    } catch (error) {
      log(`quit flush failed: ${error?.message || error}`);
    }
  }

  function pendingCount() {
    return active() && !disabledForRun && now() >= nextAttemptAt ? queue.length : 0;
  }

  function breadcrumb(category, message) {
    try {
      if (active()) trail.add(category, message);
    } catch {
      // Breadcrumbs are context, never a reason to fail.
    }
  }

  /** Accepts an error event sent by the renderer over IPC. */
  function captureFromRenderer(payload) {
    if (!payload || typeof payload !== "object" || !RENDERER_KINDS.has(payload.kind)) return false;
    const eventView = IDENTIFIER.test(String(payload.view || "")) ? payload.view : undefined;
    const action = IDENTIFIER.test(String(payload.action || "")) ? payload.action : undefined;
    if (payload.kind === "command_failed") {
      const failure = userFacingFailure(payload);
      if (!failure) return false;
      return capture({
        source: "renderer",
        kind: "command_failed",
        name: failure.code,
        message: `${failure.surface}: ${failure.code}`,
        view: eventView,
        action,
        context: failure,
      });
    }
    const context = payload.context && typeof payload.context === "object" ? payload.context : undefined;
    return capture({
      source: "renderer",
      kind: payload.kind,
      name: payload.name,
      message: payload.message,
      stack: payload.stack,
      view: eventView,
      action,
      context,
    });
  }

  /** Accepts a navigation or UI breadcrumb sent by the renderer over IPC. */
  function breadcrumbFromRenderer(payload) {
    if (!payload || typeof payload !== "object") return;
    const category = String(payload.category || "");
    const message = String(payload.message || "");
    if (!RENDERER_BREADCRUMB_CATEGORIES.has(category) || !IDENTIFIER.test(message)) return;
    if (category === "navigation") view = message;
    breadcrumb(category, message);
  }

  function setUserEnabled(enabled) {
    userEnabled = enabled !== false;
    state.enabled = userEnabled;
    saveState();
    if (!userEnabled) {
      // Turning reports off also discards what was waiting to be sent.
      queue = [];
      if (flushTimer) clearTimer(flushTimer);
      flushTimer = null;
      persistSync();
    } else {
      scheduleFlush(config.flushIntervalMs);
    }
    return status();
  }

  function status() {
    return { enabled: userEnabled, available: allowed };
  }

  function setNbcVersion(value) {
    const match = String(value || "").match(/\d+\.\d+\.\d+[0-9A-Za-z.+-]*/);
    if (match) nbcVersion = utf8(match[0], 64);
  }

  if (!fs.existsSync(statePath)) saveState();
  if (allowed) {
    queue = loadQueue();
    if (queue.length && userEnabled) scheduleFlush(config.flushIntervalMs);
    if (!userEnabled && fs.existsSync(queuePath)) persistSync();
  }

  const guard = (fn, fallback) => (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      log(`reporter error: ${error?.message || error}`);
      return fallback;
    }
  };

  return {
    capture: guard(capture, false),
    captureFromRenderer: guard(captureFromRenderer, false),
    breadcrumb: guard(breadcrumb),
    breadcrumbFromRenderer: guard(breadcrumbFromRenderer),
    flush: guard(flush, Promise.resolve()),
    flushBeforeQuit,
    pendingCount: guard(pendingCount, 0),
    persistSync: guard(persistSync),
    setNbcVersion: guard(setNbcVersion),
    setUserEnabled: guard(setUserEnabled, { enabled: true, available: allowed }),
    status: guard(status, { enabled: true, available: allowed }),
    get sessionId() { return sessionId; },
    get installId() { return state.install_id; },
    get queued() { return queue.map((entry) => entry.event); },
  };
}

module.exports = {
  LIMITS,
  createBreadcrumbTrail,
  createClientErrorReporter,
  errorReportingAllowed,
  fingerprintFor,
  parseRetryAfter,
  readJSON,
  writeFileAtomicSync,
};
