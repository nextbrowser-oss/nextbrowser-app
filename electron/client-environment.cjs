const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { parseRetryAfter, readJSON, writeFileAtomicSync } = require("./client-error-reporter.cjs");
const { truncateBytes } = require("./client-error-scrub.cjs");

// Device data ("client environment"): a snapshot of the groups the user left
// on in Settings, sent to the Nextbrowser backend (POST /v1/client-environment)
// for the signed-in account. A report is the full snapshot: a group that is
// absent is off, and the backend deletes what it stored for it. Nothing is
// collected or sent while signed out, and nothing in here may throw into the
// app; its own failures go to a local log that never holds collected values.

const GROUPS = Object.freeze(["locale", "keyboard", "device", "app", "network"]);
const OS_FAMILIES = new Set(["windows", "macos", "linux"]);
const LANGUAGE_TAG = /^[A-Za-z0-9_-]{1,35}$/;
const TIME_ZONE = /^[A-Za-z0-9_+\-/]{1,64}$/;
const ARCH = /^[a-z0-9_]{1,16}$/;
// Runtime names and agent types: identifiers, never account or profile names.
const TYPE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Hard limits of the backend contract: a value over a limit refuses the whole
// report, so everything is cut or dropped here first.
const LIMITS = Object.freeze({
  languages: 20,
  layouts: 32,
  layoutText: 128,
  osText: 64,
  cpuModel: 128,
  cpuCores: 1024,
  ramBytes: 2 ** 50,
  gpus: 8,
  gpuName: 256,
  gpuVendor: 128,
  driverVersion: 64,
  displays: 16,
  displayPixels: 32_768,
  scaleMin: 0.25,
  scaleMax: 8,
  version: 32,
  runtimes: 16,
  runtimeVersion: 64,
  agents: 16,
  count: 1_000_000,
  utcOffset: 840,
});

const DEFAULTS = Object.freeze({
  // The renderer reports agents, workspaces and profiles once it has loaded
  // them; the launch report waits for that, or for this long at most.
  launchDelayMs: 60_000,
  settleMs: 10_000,
  checkIntervalMs: 60 * 60_000,
  reportIntervalMs: 24 * 60 * 60_000,
  policyMaxAgeMs: 60 * 60_000,
  requestTimeoutMs: 10_000,
  backoffBaseMs: 60_000,
  backoffMaxMs: 60 * 60_000,
  retryAfterDefaultMs: 5 * 60_000,
  retryAfterMaxMs: 6 * 60 * 60_000,
  maxAccounts: 20,
  logMaxBytes: 128 * 1024,
});

// A toggle is sent at once; a launch or sign-in report when due; the hourly
// check only when due and the snapshot changed.
const REASON_RANK = { periodic: 1, due: 2, toggle: 3 };

/**
 * Device data is off in development and unpackaged builds unless
 * NEXTBROWSER_CLIENT_ENVIRONMENT=1, and NEXTBROWSER_CLIENT_ENVIRONMENT=0
 * turns it off in any build.
 */
function clientEnvironmentAllowed({ isDevBuild, env = process.env }) {
  const flag = String(env.NEXTBROWSER_CLIENT_ENVIRONMENT ?? "").trim();
  if (flag === "0") return false;
  if (flag === "1") return true;
  return !isDevBuild;
}

function osFamily(platform) {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  return "linux";
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function text(value, maxBytes) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  // Control characters (C0, DEL and C1) are refused by the backend.
  const clean = String(value).replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
  return clean ? truncateBytes(clean, maxBytes) : undefined;
}

function matching(value, pattern) {
  const clean = typeof value === "string" ? value.trim() : "";
  return pattern.test(clean) ? clean : undefined;
}

// Out-of-range values below the minimum are dropped (they mean "unknown");
// values above the maximum are capped so a large machine still reports.
function int(value, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const number = Math.round(value);
  return number < min ? undefined : Math.min(number, max);
}

function bool(value) {
  return typeof value === "boolean" ? value : undefined;
}

function list(values, max, map, { unique = false } = {}) {
  if (!Array.isArray(values)) return undefined;
  const result = [];
  const seen = new Set();
  for (const value of values) {
    if (result.length >= max) break;
    const item = map(value);
    if (item === undefined) continue;
    const key = unique ? JSON.stringify(item) : "";
    if (unique && seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result.length ? result : undefined;
}

function normalizeLocale(raw = {}) {
  return compact({
    ui_language: matching(raw.ui_language, LANGUAGE_TAG),
    preferred_languages: list(raw.preferred_languages, LIMITS.languages, (tag) => matching(tag, LANGUAGE_TAG), { unique: true }),
    regional_format: matching(raw.regional_format, LANGUAGE_TAG),
    timezone: matching(raw.timezone, TIME_ZONE),
    utc_offset_minutes: int(raw.utc_offset_minutes, -LIMITS.utcOffset, LIMITS.utcOffset),
  });
}

function normalizeKeyboard(raw = {}) {
  return compact({
    layouts: list(raw.layouts, LIMITS.layouts, (layout) => {
      const id = text(layout?.id, LIMITS.layoutText);
      if (!id) return undefined;
      return compact({ id, name: text(layout.name, LIMITS.layoutText), language: matching(layout.language, LANGUAGE_TAG) });
    }),
    current: text(raw.current, LIMITS.layoutText),
  });
}

function normalizeDevice(raw = {}, platform) {
  const scale = (value) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < LIMITS.scaleMin) return undefined;
    return Math.min(LIMITS.scaleMax, Math.round(value * 1000) / 1000);
  };
  return compact({
    // The group is meaningless without the OS family, and the platform is
    // always known, so a collector that failed still yields a valid group.
    os: OS_FAMILIES.has(raw.os) ? raw.os : osFamily(platform),
    os_name: text(raw.os_name, LIMITS.osText),
    os_version: text(raw.os_version, LIMITS.osText),
    os_build: text(raw.os_build, LIMITS.osText),
    arch: matching(raw.arch, ARCH),
    cpu_model: text(raw.cpu_model, LIMITS.cpuModel),
    cpu_cores: int(raw.cpu_cores, 1, LIMITS.cpuCores),
    ram_bytes: int(raw.ram_bytes, 0, LIMITS.ramBytes),
    gpus: list(raw.gpus, LIMITS.gpus, (gpu) => {
      const name = text(gpu?.name, LIMITS.gpuName);
      if (!name) return undefined;
      return compact({ name, vendor: text(gpu.vendor, LIMITS.gpuVendor), driver_version: text(gpu.driver_version, LIMITS.driverVersion) });
    }),
    displays: list(raw.displays, LIMITS.displays, (display) => {
      const width = int(display?.width, 1, LIMITS.displayPixels);
      const height = int(display?.height, 1, LIMITS.displayPixels);
      if (!width || !height) return undefined;
      return compact({ width, height, scale_factor: scale(display.scale_factor), primary: bool(display.primary) });
    }),
  });
}

function normalizeApp(raw = {}) {
  return compact({
    app_version: text(raw.app_version, LIMITS.version),
    nbc_version: text(raw.nbc_version, LIMITS.version),
    runtimes: list(raw.runtimes, LIMITS.runtimes, (runtime) => {
      const name = matching(runtime?.name, TYPE_ID);
      return name ? compact({ name, version: text(runtime.version, LIMITS.runtimeVersion) }) : undefined;
    }),
    agents: list(raw.agents, LIMITS.agents, (id) => matching(id, TYPE_ID), { unique: true }),
    multilogin_connected: bool(raw.multilogin_connected),
    workspaces_count: int(raw.workspaces_count, 0, LIMITS.count),
    profiles_count: int(raw.profiles_count, 0, LIMITS.count),
  });
}

/**
 * Shapes collected values into the wire format: only the enabled groups, only
 * known fields, every limit applied. An enabled group is always present (an
 * absent group would delete what the backend stored for it).
 */
function normalizeGroups(raw, enabled, platform = process.platform) {
  const source = raw && typeof raw === "object" ? raw : {};
  const value = (key) => (source[key] && typeof source[key] === "object" && !Array.isArray(source[key]) ? source[key] : {});
  const groups = {};
  for (const key of GROUPS) {
    if (!enabled.includes(key)) continue;
    if (key === "locale") groups.locale = normalizeLocale(value(key));
    if (key === "keyboard") groups.keyboard = normalizeKeyboard(value(key));
    if (key === "device") groups.device = normalizeDevice(value(key), platform);
    if (key === "app") groups.app = normalizeApp(value(key));
    // Filled in by the backend from the request address.
    if (key === "network") groups.network = {};
  }
  return groups;
}

function accountKey(apiKey) {
  // The 24 h clock is per account; only a hash of the key is ever kept.
  return createHash("sha256").update(`nextbrowser-client-environment\0${apiKey}`).digest("hex").slice(0, 32);
}

function digestOf(body) {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

function sameKeys(left, right) {
  return left.length === right.length && left.every((key) => right.includes(key));
}

function loadState(file) {
  const stored = readJSON(file);
  const state = { groups: {}, consent_required: undefined, accounts: {} };
  if (!stored || typeof stored !== "object") return state;
  for (const key of GROUPS) {
    if (stored.groups?.[key] === "on" || stored.groups?.[key] === "off") state.groups[key] = stored.groups[key];
  }
  if (typeof stored.consent_required === "boolean") state.consent_required = stored.consent_required;
  for (const [account, record] of Object.entries(stored.accounts || {})) {
    if (!/^[0-9a-f]{32}$/.test(account) || !Number.isFinite(record?.at) || typeof record.digest !== "string" || !Array.isArray(record.groups)) continue;
    state.accounts[account] = { at: record.at, digest: record.digest, groups: record.groups.filter((key) => GROUPS.includes(key)) };
  }
  return state;
}

function createClientEnvironment({
  dir,
  allowed = true,
  installId,
  resolveEndpoint,
  collect,
  fetchImpl = (...args) => fetch(...args),
  platform = process.platform,
  now = () => Date.now(),
  random = Math.random,
  // Pending checks must never keep a process alive on their own.
  setTimer = (fn, ms) => {
    const timer = setTimeout(fn, ms);
    timer.unref?.();
    return timer;
  },
  clearTimer = (timer) => clearTimeout(timer),
  options = {},
} = {}) {
  const config = { ...DEFAULTS, ...options };
  const statePath = path.join(dir, "state.json");
  const logPath = path.join(dir, "report.log");
  const state = loadState(statePath);
  // Per run only: a key the backend refused, a snapshot it refused, and the
  // last policy answer per account.
  const refusedAccounts = new Set();
  const refusedDigests = new Set();
  const policies = new Map();
  let started = false;
  let stopped = false;
  let running = null;
  let queued = null;
  let launchTimer = null;
  let periodicTimer = null;
  let settleTimer = null;
  let retryTimer = null;
  let retryReason = null;
  let pausedForRun = false;
  let nextAttemptAt = 0;
  let failures = 0;

  function log(message) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      try {
        if (fs.statSync(logPath).size > config.logMaxBytes) fs.renameSync(logPath, `${logPath}.1`);
      } catch { /* first write */ }
      fs.appendFileSync(logPath, `${new Date(now()).toISOString()} ${message}\n`);
    } catch {
      // Nowhere left to report to; device data must stay silent.
    }
  }

  function saveState() {
    try {
      const accounts = Object.entries(state.accounts)
        .sort(([, left], [, right]) => right.at - left.at)
        .slice(0, config.maxAccounts);
      state.accounts = Object.fromEntries(accounts);
      writeFileAtomicSync(statePath, `${JSON.stringify(compact({
        groups: state.groups,
        consent_required: state.consent_required,
        accounts: state.accounts,
      }))}\n`);
    } catch (error) {
      log(`state write failed: ${error?.code || error?.message || error}`);
    }
  }

  /** Groups that are on: explicit choices, and unset groups when `unsetOn`. */
  function enabledGroups(unsetOn) {
    return GROUPS.filter((key) => (state.groups[key] ? state.groups[key] === "on" : unsetOn));
  }

  function stronger(left, right) {
    if (!left) return right;
    if (!right) return left;
    return REASON_RANK[right] > REASON_RANK[left] ? right : left;
  }

  function backoff() {
    failures += 1;
    const base = Math.min(config.backoffMaxMs, config.backoffBaseMs * 2 ** (failures - 1));
    nextAttemptAt = now() + Math.round(base * (0.5 + random()));
  }

  function scheduleRetry(reason) {
    if (stopped) return;
    retryReason = stronger(retryReason, reason);
    if (retryTimer) clearTimer(retryTimer);
    retryTimer = setTimer(() => {
      retryTimer = null;
      const next = retryReason;
      retryReason = null;
      void check(next);
    }, Math.max(1_000, nextAttemptAt - now()));
  }

  /** The policy answer for this account: true, false, or undefined when unavailable. */
  async function consentRequired(account, baseURL, apiKey) {
    const cached = policies.get(account);
    if (cached && now() - cached.at < config.policyMaxAgeMs) return { value: cached.value };
    let response;
    try {
      response = await fetchImpl(`${baseURL}/v1/client-environment/policy`, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      });
    } catch (error) {
      log(`policy unavailable: ${error?.cause?.code || error?.name || "network error"}`);
      return {};
    }
    const status = Number(response?.status) || 0;
    if (status !== 200) {
      log(`policy unavailable: HTTP ${status}`);
      return { status };
    }
    const body = await response.json().catch(() => null);
    if (typeof body?.consent_required !== "boolean") {
      log("policy unavailable: unexpected answer");
      return {};
    }
    policies.set(account, { value: body.consent_required, at: now() });
    if (state.consent_required !== body.consent_required) {
      state.consent_required = body.consent_required;
      saveState();
    }
    return { value: body.consent_required };
  }

  async function send({ baseURL, apiKey, body, digest, account, groups, reason }) {
    let response;
    try {
      response = await fetchImpl(`${baseURL}/v1/client-environment`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      });
    } catch (error) {
      log(`send failed: ${error?.cause?.code || error?.name || "network error"}`);
      backoff();
      scheduleRetry(reason);
      return;
    }
    const status = Number(response?.status) || 0;
    if (status >= 200 && status < 300) {
      state.accounts[account] = { at: now(), digest, groups };
      saveState();
      failures = 0;
      nextAttemptAt = 0;
      return;
    }
    if (status === 401 || status === 403) {
      refusedAccounts.add(account);
      log(`backend refused the account key (HTTP ${status}); waiting for another sign-in`);
      return;
    }
    if (status === 404 || status === 405) {
      pausedForRun = true;
      log(`endpoint returned ${status}; device data is paused until the next launch`);
      return;
    }
    if (status === 429) {
      const delay = parseRetryAfter(response.headers?.get?.("retry-after"), now()) ?? config.retryAfterDefaultMs;
      nextAttemptAt = now() + Math.min(config.retryAfterMaxMs, Math.max(1_000, delay));
      scheduleRetry(reason);
      return;
    }
    if (status >= 500) {
      log(`send failed: HTTP ${status}`);
      backoff();
      scheduleRetry(reason);
      return;
    }
    // The same snapshot would be refused again; a changed one may not be.
    refusedDigests.add(digest);
    log(`backend refused the report with HTTP ${status}`);
  }

  async function attempt(reason) {
    if (pausedForRun) return;
    if (now() < nextAttemptAt) {
      scheduleRetry(reason);
      return;
    }
    let endpoint;
    try {
      endpoint = await resolveEndpoint();
    } catch {
      endpoint = undefined;
    }
    const apiKey = String(endpoint?.apiKey || "").trim();
    const baseURL = String(endpoint?.baseURL || "").replace(/\/+$/, "");
    // Signed out: nothing is collected or sent. A toggle changed meanwhile is
    // sent at the next sign-in, because the groups then differ from the last
    // report for that account.
    if (!apiKey || !/^https?:\/\//.test(baseURL)) return;
    const account = accountKey(apiKey);
    if (refusedAccounts.has(account)) return;
    const record = state.accounts[account];
    // Within the 24 h window only a change of groups makes a report due; judge
    // that by the last policy answer so a check that is not due stays offline.
    const answered = state.consent_required !== undefined || GROUPS.every((key) => state.groups[key]);
    if (reason !== "toggle" && record && answered && now() - record.at < config.reportIntervalMs
      && sameKeys(record.groups, enabledGroups(state.consent_required === false))) return;

    let unsetOn = false;
    if (GROUPS.some((key) => !state.groups[key])) {
      const policy = await consentRequired(account, baseURL, apiKey);
      if (policy.status === 401 || policy.status === 403) {
        refusedAccounts.add(account);
        return;
      }
      if (policy.value === undefined) {
        // Unset groups count as off for this attempt, but a lookup that failed
        // must not delete data for a group the user never turned off.
        if (record?.groups.some((key) => !state.groups[key])) {
          backoff();
          scheduleRetry(reason);
          return;
        }
      } else {
        unsetOn = !policy.value;
      }
    }
    const groups = enabledGroups(unsetOn);
    // Nothing on and nothing stored for this account: a report would only
    // create an empty install row for someone who never opted in, as everyone
    // in a consent country is until they turn a group on.
    if (!groups.length && !record?.groups.length) return;
    const sameGroups = !!record && sameKeys(record.groups, groups);
    const due = !sameGroups || now() - record.at >= config.reportIntervalMs;
    if (reason !== "toggle" && !due) return;

    const id = String(installId() || "");
    if (!UUID.test(id) || /^[0-]+$/.test(id)) {
      log("no install id; device data is not sent");
      return;
    }
    let collected;
    try {
      collected = await collect(groups);
    } catch (error) {
      log(`collection failed: ${error?.name || "error"}`);
      return;
    }
    const body = { install_id: id.toLowerCase(), groups: normalizeGroups(collected, groups, platform) };
    const digest = digestOf(body);
    if (reason === "periodic" && sameGroups && digest === record.digest) return;
    if (refusedDigests.has(digest)) return;
    await send({ baseURL, apiKey, body, digest, account, groups, reason });
  }

  async function drain(reason) {
    let next = reason;
    while (next && !stopped) {
      queued = null;
      try {
        await attempt(next);
      } catch (error) {
        log(`check failed: ${error?.message || error}`);
      }
      next = queued;
    }
  }

  /** Runs one check now; a check requested meanwhile runs right after it. Never rejects. */
  function check(reason = "due") {
    if (!allowed || stopped) return Promise.resolve();
    if (running) {
      queued = stronger(queued, reason);
      return running;
    }
    running = drain(reason).finally(() => { running = null; });
    return running;
  }

  function schedulePeriodic() {
    if (stopped) return;
    periodicTimer = setTimer(() => {
      periodicTimer = null;
      void check("periodic").finally(schedulePeriodic);
    }, config.checkIntervalMs);
  }

  /** Starts the launch report and the hourly check. */
  function start() {
    if (!allowed || started) return;
    started = true;
    launchTimer = setTimer(() => {
      launchTimer = null;
      void check("due");
    }, config.launchDelayMs);
    schedulePeriodic();
  }

  /**
   * The app's own state settled (signed in, workspaces and profiles loaded,
   * an agent connected): sends a due report shortly, which is also how a
   * sign-in to another account is picked up.
   */
  function checkSoon() {
    if (!allowed || stopped) return;
    if (launchTimer) {
      clearTimer(launchTimer);
      launchTimer = null;
    }
    if (settleTimer) clearTimer(settleTimer);
    settleTimer = setTimer(() => {
      settleTimer = null;
      void check("due");
    }, config.settleMs);
  }

  function stop() {
    stopped = true;
    for (const timer of [launchTimer, periodicTimer, settleTimer, retryTimer]) {
      if (timer) clearTimer(timer);
    }
    launchTimer = periodicTimer = settleTimer = retryTimer = null;
  }

  function status() {
    // Unset groups follow the last policy answer; without one they show on.
    const on = enabledGroups(state.consent_required !== true);
    return {
      available: allowed,
      groups: Object.fromEntries(GROUPS.map((key) => [key, on.includes(key)])),
    };
  }

  /** Stores the user's choice for one group and sends a report at once. */
  function setGroup(key, enabled) {
    if (!GROUPS.includes(key)) return status();
    state.groups[key] = enabled ? "on" : "off";
    saveState();
    void check("toggle");
    return status();
  }

  const guard = (fn, fallback) => (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      log(`device data error: ${error?.message || error}`);
      return typeof fallback === "function" ? fallback() : fallback;
    }
  };
  const fallbackStatus = () => ({ available: allowed, groups: Object.fromEntries(GROUPS.map((key) => [key, false])) });

  return {
    check: guard(check, Promise.resolve()),
    checkSoon: guard(checkSoon),
    setGroup: guard(setGroup, fallbackStatus),
    start: guard(start),
    status: guard(status, fallbackStatus),
    stop: guard(stop),
  };
}

module.exports = {
  GROUPS,
  LIMITS,
  clientEnvironmentAllowed,
  createClientEnvironment,
  normalizeGroups,
  osFamily,
};
