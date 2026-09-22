const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// A failed host profile start used to reach the agent as the bare process
// result ({"ok":false,"code":1,"stderr":""}): nextctl --format json writes its
// error envelope to stdout, and only envelope.data was forwarded. This module
// turns the result into a message a person can act on, keeps the technical
// details for diagnostics, and records the failure in a local log.

const RUNTIME_LABELS = {
  clawbrowser: "ClawBrowser",
  camoufox: "Camoufox",
  dasbrowser: "DasBrowser",
  multilogin: "Multilogin",
};
const DIAGNOSTIC_TAIL_CHARS = 2_000;
const REASON_CHARS = 220;
const LOG_FILE = "profile-start.log";
const LOG_MAX_BYTES = 1024 * 1024;

const RETRY_ONCE = "Retry once. If it fails again, restart NextBrowser and share the Ref through Send feedback.";
const RETRY_FEWER = "Retry once. If several profiles are starting at the same time, start fewer at once.";
const CHECK_PROXY = "Retry once. If it fails again, check or change this profile's proxy in NextBrowser.";
const SIGN_IN = "Sign in again from the NextBrowser sidebar, then retry.";
const RESTART_TO_REINSTALL = "Restart NextBrowser so it can reinstall its browser toolset, then retry.";
const CHECK_CONNECTION = "Check your internet connection, then retry.";

function runtimeLabel(runtime) {
  return RUNTIME_LABELS[String(runtime || "").toLowerCase()] || "NextBrowser";
}

function newFailureRef() {
  return `NB-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

// Proxy URLs and account keys appear in launcher diagnostics; neither may
// reach the chat transcript or the log.
function redactSecrets(value) {
  return String(value ?? "")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1***@")
    .replace(/\b(nb|claw)_(live|test)_[A-Za-z0-9_-]+/g, "$1_$2_***")
    .replace(/\b(Bearer|token|password|passwd|api[_-]?key)(["']?\s*[:=]\s*["']?|\s+)[^\s"',;]+/gi, "$1$2***");
}

function tail(value, limit = DIAGNOSTIC_TAIL_CHARS) {
  const text = redactSecrets(value).trim();
  return text.length > limit ? `…${text.slice(-limit)}` : text;
}

function humanReason(value) {
  const text = redactSecrets(value)
    .replace(/(?:[A-Za-z]:\\|\/Users\/|\/home\/)[^\s;"']+/g, "a local file")
    .replace(/^\s*(?:Error:\s*)?(?:[A-Z][A-Z0-9_]{3,}:\s*)+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.。]+$/, "");
  if (!text) return "";
  const lowered = text.charAt(0).toLowerCase() + text.slice(1);
  return lowered.length > REASON_CHARS ? `${lowered.slice(0, REASON_CHARS - 1)}…` : lowered;
}

/**
 * Reads the nextctl JSON envelope from stdout. nextctl can print a line
 * before the document, so a trailing top-level object is accepted too.
 */
function parseNextctlEnvelope(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return undefined;
  const candidates = [text];
  const lastDocument = text.lastIndexOf("\n{");
  if (lastDocument >= 0) candidates.push(text.slice(lastDocument + 1));
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {
      /* not JSON */
    }
  }
  return undefined;
}

function rule(code, category, reason, nextAction) {
  return { code, category, reason, nextAction };
}

function classifyByDetail(detail, label) {
  if (/managed-proxy privacy capability/i.test(detail)) {
    return rule("CLAWBROWSER_OUTDATED", "installation", "the installed ClawBrowser build can't run a proxied profile", "Update ClawBrowser when NextBrowser offers the browser toolset update, then retry.");
  }
  const country = detail.match(/Proxy country is ([A-Za-z]{2,}), expected ([A-Za-z]{2,})/);
  if (country) {
    return rule("PROXY_COUNTRY_MISMATCH", "retryable", `its proxy connected from ${country[1].toUpperCase()} instead of ${country[2].toUpperCase()}`, "Retry once to get a new proxy IP. If it fails again, check this profile's proxy country.");
  }
  if (/ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED|proxy[^.\n]*(?:refused|unreachable|authentication|\b407\b)/i.test(detail)) {
    return rule("PROXY_UNREACHABLE", "configuration", "its proxy didn't accept the connection", "Check or change this profile's proxy in NextBrowser, then retry.");
  }
  if (/runtime update is being installed/i.test(detail)) {
    return rule("RUNTIME_UPDATING", "retryable", `the ${label} toolset is being updated`, "Wait for the browser toolset update to finish, then retry.");
  }
  const timeout = detail.match(/Command timed out after (\d+) seconds/i);
  if (timeout) {
    return rule("START_TIMEOUT", "retryable", `it didn't finish starting within ${timeout[1]} seconds`, RETRY_FEWER);
  }
  if (/nextctl not found|Install Clawbrowser CLI/i.test(detail)) {
    return rule("NEXTCTL_MISSING", "installation", "the NextBrowser CLI (nextctl) is missing", RESTART_TO_REINSTALL);
  }
  if (/Clawbrowser installation failed/i.test(detail)) {
    return rule("RUNTIME_INSTALL_FAILED", "installation", "the ClawBrowser toolset couldn't be installed", RESTART_TO_REINSTALL);
  }
  return undefined;
}

const INSTALL_DAMAGE = /ENOENT|no such file|not executable|permission denied|EACCES|is damaged|code signature|quarantine|cannot be opened|bad CPU type|is a directory/i;
const NETWORK_FAILURE = /timeout|timed out|connection (?:refused|reset)|no such host|network|fetch failed|tls|certificate|ECONN|ENOTFOUND|EAI_AGAIN/i;

function classifyByCode(nextctlCode, detail, label, message) {
  switch (nextctlCode) {
    case "PROFILE_NOT_FOUND":
      return rule(nextctlCode, "configuration", "this profile no longer exists in NextBrowser", "Pick another profile in this workspace, or recreate it in the NextBrowser sidebar.");
    case "INVALID_ARGUMENT":
      return rule(nextctlCode, "configuration", humanReason(message) || "the NextBrowser CLI rejected the start request", "Update NextBrowser, then retry.");
    case "API_KEY_REQUIRED":
      return rule(nextctlCode, "configuration", "NextBrowser isn't signed in to its browser account", SIGN_IN);
    case "API_KEY_INVALID":
      return rule(nextctlCode, "configuration", "the browser account sign-in is no longer valid", SIGN_IN);
    case "MULTILOGIN_AUTH_INVALID":
    case "MULTILOGIN_FORBIDDEN":
      return rule(nextctlCode, "configuration", "Multilogin rejected the connection", "Reconnect the Multilogin connector in NextBrowser, then retry.");
    case "PROXY_TRAFFIC_EXHAUSTED":
      return rule(nextctlCode, "configuration", "the account's included proxy traffic is used up", "Add proxy traffic or assign your own proxy to this profile, then retry.");
    case "LOCAL_PROXY_UNSUPPORTED":
      return rule(nextctlCode, "configuration", "ClawBrowser can't use a proxy running on this computer", "Use a Camoufox or DasBrowser profile for a localhost proxy, or choose a remote proxy.");
    case "VERIFY_REQUIRED":
      return rule(nextctlCode, "configuration", "the profile didn't pass its startup safety check", "Start the profile from the NextBrowser sidebar. If it fails again, check its proxy.");
    case "VERIFY_FAILED":
      return rule(nextctlCode, "retryable", "its proxy check didn't pass", CHECK_PROXY);
    case "VERIFY_BUSY":
      return rule(nextctlCode, "retryable", "another check is already running for this profile", "Wait a few seconds, then retry.");
    case "VERIFY_UNAVAILABLE":
      return rule(nextctlCode, "retryable", "the proxy check couldn't reach the verification service", CHECK_CONNECTION);
    case "SESSION_ACTIVE":
      return rule(nextctlCode, "retryable", "the profile is already open in another browser window", "Close that browser window, then retry.");
    case "SESSION_NOT_FOUND":
      return rule(nextctlCode, "retryable", "the browser didn't come up before the start timeout", RETRY_FEWER);
    case "CDP_UNREACHABLE":
      return rule(nextctlCode, "retryable", "the browser started but stopped responding", RETRY_ONCE);
    case "TAB_NOT_FOUND":
      return rule(nextctlCode, "retryable", "the browser opened without a page", RETRY_ONCE);
    case "LAUNCH_FAILED":
      if (INSTALL_DAMAGE.test(detail)) {
        return rule(nextctlCode, "installation", `the ${label} toolset is missing or damaged`, RESTART_TO_REINSTALL);
      }
      return rule(nextctlCode, "retryable", "the browser process failed to launch", RETRY_ONCE);
    case "BROWSER_BIN_NOT_FOUND":
      return rule(nextctlCode, "installation", `the ${label} toolset isn't installed or can't be found`, RESTART_TO_REINSTALL);
    case "UNSUPPORTED_PLATFORM":
      return rule(nextctlCode, "installation", `${label} doesn't support this computer`, "Use a profile with a different browser toolset.");
    case "IO_ERROR":
      return rule(nextctlCode, "installation", "NextBrowser couldn't read or write its local profile files", "Check free disk space and folder permissions, then retry.");
    case "REMOTE_BACKEND_ERROR":
      if (/\b40[13]\b|unauthori[sz]ed|forbidden|API key/i.test(detail)) {
        return rule(nextctlCode, "configuration", "the NextBrowser service rejected this account", SIGN_IN);
      }
      return rule(nextctlCode, "retryable", "the NextBrowser service didn't respond", CHECK_CONNECTION);
    case "VENDOR_UNAVAILABLE":
      return rule(nextctlCode, "retryable", "the browser provider is temporarily unavailable", "Retry in a minute.");
    default:
      return undefined;
  }
}

// Exit codes without any diagnostic text still say something about the cause.
function classifyByExitCode(exitCode) {
  switch (exitCode) {
    case 126:
    case 127:
      return rule(`EXIT_${exitCode}`, "installation", `the NextBrowser CLI couldn't be executed (exit code ${exitCode})`, RESTART_TO_REINSTALL);
    case 3221225781: // 0xC0000135 STATUS_DLL_NOT_FOUND
      return rule("EXIT_DLL_NOT_FOUND", "installation", "a system library the browser needs is missing", "Install the latest Windows updates, restart NextBrowser, then retry.");
    case 134:
    case 139:
    case 3221225477: // 0xC0000005 access violation
      return rule(`EXIT_${exitCode}`, "retryable", `the NextBrowser CLI crashed (exit code ${exitCode})`, RETRY_ONCE);
    case 137:
    case 143:
      return rule(`EXIT_${exitCode}`, "retryable", "the system stopped the start process, possibly because memory ran low", "Close other profiles or apps, then retry.");
    case -1:
      return rule("PROCESS_ENDED", "retryable", "the start process ended unexpectedly", RETRY_ONCE);
    default:
      return rule(`EXIT_${exitCode}`, "retryable", `the NextBrowser CLI exited with code ${exitCode} without reporting a reason`, RETRY_ONCE);
  }
}

function classify({ nextctlCode, nextctlMessage, detail, diagnostic, exitCode, label }) {
  const known = classifyByDetail(detail, label) || classifyByCode(nextctlCode, detail, label, nextctlMessage);
  if (known) return known;
  const nextAction = NETWORK_FAILURE.test(detail) ? CHECK_CONNECTION : RETRY_ONCE;
  // An unknown nextctl code still carries its own message.
  if (nextctlCode) {
    return rule(nextctlCode, "retryable", humanReason(nextctlMessage) || `the NextBrowser CLI reported ${nextctlCode}`, nextAction);
  }
  // Without an envelope the first diagnostic line is the best reason left.
  const firstLine = diagnostic.split(/\r?\n/).find((line) => line.trim());
  if (firstLine && !/^Command cancelled/i.test(firstLine)) {
    return rule(exitCode === undefined ? "HOST_ERROR" : `EXIT_${exitCode}`, "retryable", humanReason(firstLine), nextAction);
  }
  return classifyByExitCode(exitCode ?? -1);
}

/**
 * Describes a failed host profile start or stop.
 *
 * `result` is the command result ({ code, stdout, stderr }); pass `error`
 * instead when the host threw before nextctl produced a result.
 */
function describeProfileStartFailure({ action = "start", profile = "", runtime = "", result, error, durationMs, ref = newFailureRef() } = {}) {
  const label = runtimeLabel(runtime);
  const exitCode = Number.isInteger(result?.code) ? result.code : undefined;
  const stdout = String(result?.stdout ?? "");
  const stderr = String(result?.stderr ?? "");
  const thrown = error ? String(error?.message || error) : "";
  const envelope = parseNextctlEnvelope(stdout);
  const nextctlError = envelope && envelope.ok === false && envelope.error && typeof envelope.error === "object" ? envelope.error : undefined;
  const nextctlCode = typeof nextctlError?.code === "string" ? nextctlError.code.trim() : "";
  const nextctlMessage = typeof nextctlError?.message === "string" ? nextctlError.message : "";
  const nextctlHint = typeof nextctlError?.hint === "string" ? nextctlError.hint : "";
  const detail = [nextctlMessage, nextctlHint, stderr, thrown].filter(Boolean).join("\n");

  const classified = classify({ nextctlCode, nextctlMessage, detail, diagnostic: stderr.trim() || thrown, exitCode, label });

  const verb = action === "stop" ? "stop" : "start";
  const subject = `The ${label} profile “${profile || "unknown"}”`;
  const message = `${subject} couldn't ${verb}: ${classified.reason}. ${classified.nextAction} Ref: ${ref}`;
  return {
    ok: false,
    action: verb,
    profile,
    runtime,
    error: {
      code: classified.code,
      category: classified.category,
      retryable: classified.category === "retryable",
      message,
      reason: classified.reason,
      nextAction: classified.nextAction,
      ref,
    },
    diagnostics: {
      exitCode: exitCode ?? null,
      nextctlCode: nextctlCode || null,
      nextctlMessage: redactSecrets(nextctlMessage) || null,
      nextctlHint: redactSecrets(nextctlHint) || null,
      stderr: tail(stderr || thrown),
      ...(envelope ? {} : { stdout: tail(stdout) }),
      durationMs: Number.isFinite(durationMs) ? Math.round(durationMs) : null,
      log: LOG_FILE,
    },
  };
}

// The host refuses some requests before nextctl runs. Neither refusal is
// fixed by retrying the same request, so the agent must report it instead.
function describeProfileRequestRejection(code, profile) {
  const name = profile ? `“${profile}”` : "The requested profile";
  const rejection = code === "profile_in_use_by_another_chat"
    ? { message: `${name} is being used by another chat.`, nextAction: "Wait for that chat to finish or stop it, or choose another profile in this workspace." }
    : { message: `${name} isn't one of this chat's workspace profiles.`, nextAction: "Use a profile listed for this workspace, or add the profile to it in NextBrowser." };
  return {
    ok: false,
    profile,
    error: {
      code,
      category: "configuration",
      retryable: false,
      message: `${rejection.message} ${rejection.nextAction}`,
      reason: rejection.message,
      nextAction: rejection.nextAction,
    },
  };
}

/**
 * Appends one JSON line per failure. The file is capped by rotating to .1 so
 * a start loop cannot fill the disk; the Ref in the user message is the key.
 */
function logProfileStartFailure(dir, failure, context = {}) {
  const file = path.join(dir, LOG_FILE);
  const { log: _logFile, ...diagnostics } = failure.diagnostics;
  const line = JSON.stringify({
    at: new Date().toISOString(),
    ref: failure.error.ref,
    action: failure.action,
    profile: failure.profile,
    runtime: failure.runtime,
    code: failure.error.code,
    category: failure.error.category,
    ...diagnostics,
    ...context,
  });
  try {
    fs.mkdirSync(dir, { recursive: true });
    try {
      if (fs.statSync(file).size > LOG_MAX_BYTES) fs.renameSync(file, `${file}.1`);
    } catch {
      /* first write */
    }
    fs.appendFileSync(file, `${line}\n`);
  } catch {
    /* diagnostics must never turn a failed start into a crash */
  }
  return file;
}

module.exports = {
  LOG_FILE,
  describeProfileRequestRejection,
  describeProfileStartFailure,
  logProfileStartFailure,
  newFailureRef,
  parseNextctlEnvelope,
  redactSecrets,
};
