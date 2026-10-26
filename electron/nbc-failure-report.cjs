const { parseNextctlEnvelope } = require("./profile-start-failure.cjs");

// Decides which nbc (nextctl) results are worth an error report. The rule:
// report what the UI cannot explain — a crash, a spawn failure, output that is
// not the JSON the app asked for, and error codes that mean nbc itself or a
// backend broke (INTERNAL_ERROR, IO_ERROR, LAUNCH_FAILED, ... or any code this
// list does not know). A failed browser verification is reported too: the UI
// calls it a problem on our side. So are timeouts of commands the user waits
// on and failures of the few commands the app runs without JSON output.
// Outcomes the user can act on are expected and only become breadcrumbs: bad
// input, missing profiles, sign-in, the profile's own proxy, traffic limits,
// site-flow results, an offline machine, a browser the user closed
// (CDP_UNREACHABLE outside start), cancellations and other timeouts.
// Standard output is never copied into a report: it can hold page data.

const EXPECTED_CODES = new Set([
  "INVALID_ARGUMENT",
  "SESSION_NOT_FOUND",
  "SESSION_ACTIVE",
  "PROFILE_NOT_FOUND",
  "TAB_NOT_FOUND",
  "ELEMENT_STALE",
  "WAIT_TIMEOUT",
  "NAVIGATION_TIMEOUT",
  "SCREENSHOT_TIMEOUT",
  "UNSUPPORTED_PLATFORM",
  "VERIFY_BUSY",
  "API_KEY_REQUIRED",
  "API_KEY_INVALID",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "MULTILOGIN_AUTH_INVALID",
  "MULTILOGIN_FORBIDDEN",
  "PROXY_TRAFFIC_EXHAUSTED",
  "LOCAL_PROXY_UNSUPPORTED",
  "CAPTCHA_FAILED",
  "CAPTCHA_ALREADY_RUNNING",
  "CAPCHA_NOT_READY",
  "KEYBOARD_KEY_NOT_FOUND",
  "MOBILE_UI_BUSY",
]);
// Site flows and on-page lookups report what they found on the page.
const EXPECTED_CODE_PATTERN = /^(?:REDDIT|X|LINKEDIN|INSTAGRAM|TIKTOK|FACEBOOK)_|_(?:NOT_FOUND|UNVERIFIED|LOGIN_REQUIRED)$/;
// A launch that failed because of the profile's own proxy is explained to the
// user (see profile-start-failure.cjs) and is not an nbc defect. Neither is
// an update nbc refuses while profiles still use the browser ("ClawBrowser is
// still running in: …. Stop these profiles before updating"): the app waits
// for them to close.
const EXPECTED_DETAIL = /ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED|Proxy country is [A-Za-z]{2,}, expected|proxy[^.\n]*(?:refused|unreachable|authentication|\b407\b)|runtime update is being installed|Stop these profiles before updating/i;
// A machine without network or DNS is the user's environment, not nbc.
const OFFLINE_DETAIL = /no such host|ENOTFOUND|EAI_AGAIN|ENETUNREACH|network is unreachable|getaddrinfo/i;
const SIGNED_OUT_DETAIL = /\b40[13]\b|unauthori[sz]ed|forbidden|API key/i;
// nextctl wraps every failed verified start in VERIFY_FAILED. The code after
// "browser stopped:" is the real cause (the rule in
// src/lib/userFacingBrowserError.ts); VERIFY_REQUIRED there is the check itself.
const WRAPPED_CAUSE = /browser stopped:\s*([A-Z][A-Z0-9_]{2,}):/;
const VERIFY_CODES = new Set(["VERIFY_FAILED", "VERIFY_REQUIRED"]);
// A timeout of these keeps the user waiting and then blocks them: a profile
// that never starts or stops, a Live View that never opens, an install or
// update that never ends. Elsewhere it is a slow page or a poll that repeats.
const BLOCKING_COMMANDS = new Set(["start", "stop", "remote", "update", "install"]);
// The app runs these without --format json and shows their failure to the
// user, so exit 1 is a failure here rather than nbc's ordinary error.
const TEXT_COMMANDS_REPORTED = new Set(["update", "config set", "profiles requests reject", "remote close", "install"]);
// Cobra usage errors are how the app probes older nbc builds for a flag.
const USAGE_ERROR = /\bunknown (?:flag|shorthand flag|command)\b|\baccepts \d+ arg|\brequires at least \d+ arg|\binvalid argument ".*" for "/i;
const GO_CRASH = /^panic: |^fatal error: |^goroutine \d+ \[/m;

const BOOLEAN_FLAGS = new Set(["--verify-on-start-only", "--json", "--manual-proxy", "--browser-only", "--help", "-h", "--version", "--headless", "--force", "--yes", "-y", "--all", "--detach"]);
const SUBCOMMANDS = new Set([
  "access", "actions", "activate", "add", "approve", "apply", "apps", "audio-solve", "auto", "captcha", "check", "click",
  "close", "complete", "config", "countries", "create", "delete", "detect", "dismiss", "doctor", "endpoint", "eval",
  "extensions", "folders", "identity", "input", "inspect", "install", "launch", "list", "login", "logout", "ls", "mobile",
  "open", "press", "profiles", "projects", "proxies", "proxy", "reject", "remote", "requests", "rm", "run", "screenshot",
  "scroll", "select", "set", "set-proxy", "show", "skill", "start", "state", "stats", "status", "stop", "tabs", "top-up",
  "ui", "update", "verify", "version", "wait",
]);
const RUNTIMES = new Set(["clawbrowser", "camoufox", "dasbrowser", "multilogin", "chromium", "adspower"]);

function isNextctlBinary(binary) {
  const name = String(binary || "").split(/[\\/]/).pop().toLowerCase().replace(/\.(?:exe|cmd|bat|ps1)$/, "");
  return name === "nextctl" || name === "nbc";
}

function positionals(args) {
  const list = Array.isArray(args) ? args.map(String) : [];
  const result = [];
  for (let index = 0; index < list.length; index += 1) {
    const arg = list[index];
    if (arg.startsWith("-")) {
      if (!arg.includes("=") && !BOOLEAN_FLAGS.has(arg) && arg.startsWith("--") && list[index + 1] !== undefined && !list[index + 1].startsWith("-")) index += 1;
      continue;
    }
    result.push({ value: arg, index });
  }
  return result;
}

/**
 * The command words only (e.g. "profiles create"). Arguments such as profile
 * names, URLs or scripts never appear, so the name is safe to send.
 */
function nbcCommandName(args) {
  const words = positionals(args);
  const top = words[0]?.value || "";
  if (!top) {
    const probe = (Array.isArray(args) ? args.map(String) : []).find((arg) => arg === "--help" || arg === "--version");
    return probe || "(none)";
  }
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(top)) return "unknown";
  const name = [top];
  for (const word of words.slice(1)) {
    if (name.length >= 3 || !SUBCOMMANDS.has(word.value)) break;
    name.push(word.value);
  }
  return name.join(" ");
}

function flagValue(args, flag) {
  const list = Array.isArray(args) ? args.map(String) : [];
  for (let index = 0; index < list.length; index += 1) {
    if (list[index] === flag) return list[index + 1] || "";
    if (list[index].startsWith(`${flag}=`)) return list[index].slice(flag.length + 1);
  }
  return "";
}

function expectsJSON(args) {
  const list = Array.isArray(args) ? args.map(String) : [];
  return list.includes("--json") || flagValue(list, "--format") === "json";
}

function expectedCode(code, command) {
  // A browser the user closed is unreachable to every later command; only a
  // start that cannot reach the browser it just launched is a failure.
  if (code === "CDP_UNREACHABLE") return command !== "start";
  return EXPECTED_CODES.has(code) || EXPECTED_CODE_PATTERN.test(code);
}

// requireVerificationCapableCLI (verification-policy.cjs) parses the safety
// flags with `version --help`; a failure turns every nextctl feature off.
function compatibilityProbe(command, args) {
  return command === "version" && Array.isArray(args) && args.map(String).includes("--help");
}

function blockingCommand(command, args) {
  return BLOCKING_COMMANDS.has(command.split(" ")[0]) || /(?:^| )profiles create$/.test(command) || compatibilityProbe(command, args);
}

function tailLines(text, count) {
  return String(text || "").trim().split(/\r?\n/).slice(-count).join("\n");
}

/**
 * Describes one finished nbc call: always a breadcrumb, and an event only when
 * the failure is unexpected (see the rule at the top of this file).
 */
function describeNbcResult({ args, result, outcome = {}, durationMs }) {
  const command = nbcCommandName(args);
  const code = Number.isInteger(result?.code) ? result.code : -1;
  const stdout = String(result?.stdout ?? "");
  const stderr = String(result?.stderr ?? "");
  const seconds = Number.isFinite(durationMs) ? ` ${(durationMs / 1000).toFixed(1)}s` : "";
  const state = outcome.cancelled ? "cancelled" : outcome.timedOut ? "timeout" : outcome.spawnError ? "spawn error" : `exit ${code}`;
  const breadcrumb = `${command} → ${state}${seconds}`;
  if (outcome.cancelled || (outcome.timedOut && !blockingCommand(command, args))) return { breadcrumb, event: null };

  const runtime = flagValue(args, "--runtime");
  const context = {
    command,
    exit_code: String(code),
    ...(RUNTIMES.has(runtime) ? { runtime } : {}),
    ...(outcome.signal ? { signal: String(outcome.signal) } : {}),
    ...(Number.isFinite(durationMs) ? { duration_ms: String(Math.round(durationMs)) } : {}),
  };
  const event = (name, message, extra = {}) => ({
    source: "nbc",
    kind: "command_failed",
    name,
    message,
    context: { ...context, ...extra.context },
    ...(extra.stack ? { stack: extra.stack } : {}),
    fingerprintExtra: command,
  });

  const probe = compatibilityProbe(command, args);
  if (outcome.timedOut) return { breadcrumb, event: event("NBC_TIMEOUT", `nbc ${probe ? "compatibility probe" : command} timed out`) };
  if (outcome.spawnError) {
    return { breadcrumb, event: event("NBC_SPAWN_FAILED", `nbc ${command} could not start: ${stderr.trim() || "spawn failed"}`) };
  }
  if (GO_CRASH.test(stderr)) {
    const firstLine = stderr.split(/\r?\n/).find((line) => GO_CRASH.test(line)) || "nbc crashed";
    return { breadcrumb, event: event("NBC_CRASH", `nbc ${command} crashed: ${firstLine.trim()}`, { stack: tailLines(stderr.slice(stderr.search(GO_CRASH)), 200) }) };
  }

  const json = expectsJSON(args);
  const envelope = json ? parseNextctlEnvelope(stdout) : undefined;
  const error = envelope && envelope.ok === false && envelope.error && typeof envelope.error === "object" ? envelope.error : undefined;
  const nbcCode = typeof error?.code === "string" ? error.code.trim() : "";
  if (code === 0 && (!json || (envelope && !error))) return { breadcrumb, event: null };

  if (nbcCode) {
    const message = String(error.message || "").trim();
    const detail = [message, String(error.hint || ""), stderr].join("\n");
    const wrapped = VERIFY_CODES.has(nbcCode) ? message.match(WRAPPED_CAUSE)?.[1] : "";
    const cause = wrapped && wrapped !== "VERIFY_REQUIRED" ? wrapped : nbcCode;
    const coded = { breadcrumb: `${breadcrumb} ${cause === nbcCode ? nbcCode : `${nbcCode}(${cause})`}`, event: null };
    if (expectedCode(cause, command) || EXPECTED_DETAIL.test(detail) || OFFLINE_DETAIL.test(detail)) return coded;
    if (cause === "REMOTE_BACKEND_ERROR" && SIGNED_OUT_DETAIL.test(detail)) return coded;
    return {
      ...coded,
      event: event(VERIFY_CODES.has(cause) ? "NBC_VERIFY_FAILED" : cause, `nbc ${command}: ${message || nbcCode}`, {
        context: { nbc_code: nbcCode, ...(cause !== nbcCode ? { cause_code: cause } : {}) },
      }),
    };
  }

  // Abnormal exit codes: Go panics exit 2, Windows crashes end in 0xC0000005
  // and similar, a killed process has a signal. Exit 1 is nbc's normal error.
  if (outcome.signal || (code !== 1 && code !== 0 && code !== -1)) {
    return { breadcrumb, event: event("NBC_ABNORMAL_EXIT", `nbc ${command} exited with ${outcome.signal ? `signal ${outcome.signal}` : `code ${code}`}: ${tailLines(stderr, 3) || "no error output"}`) };
  }
  const output = `${stderr}\n${stdout}`;
  if (!json) {
    // An old nbc that rejects the safety flags is what the probe looks for.
    if (!probe && (!TEXT_COMMANDS_REPORTED.has(command) || USAGE_ERROR.test(output))) return { breadcrumb, event: null };
    if (EXPECTED_DETAIL.test(stderr) || OFFLINE_DETAIL.test(stderr) || SIGNED_OUT_DETAIL.test(stderr)) return { breadcrumb, event: null };
    const reason = tailLines(stderr, 3) || "no error output";
    return {
      breadcrumb,
      event: probe
        ? event("NBC_INCOMPATIBLE", `nbc compatibility probe failed (exit ${code}): ${reason}`)
        : event("NBC_COMMAND_FAILED", `nbc ${command} failed (exit ${code}): ${reason}`),
    };
  }
  if (USAGE_ERROR.test(output) || EXPECTED_DETAIL.test(output)) return { breadcrumb, event: null };
  return {
    breadcrumb,
    event: event("NBC_NON_JSON_OUTPUT", `nbc ${command} returned no JSON result (exit ${code}, ${Buffer.byteLength(stdout)} bytes of output): ${tailLines(stderr, 3) || "no error output"}`),
  };
}

module.exports = {
  EXPECTED_DETAIL,
  OFFLINE_DETAIL,
  describeNbcResult,
  expectsJSON,
  isNextctlBinary,
  nbcCommandName,
};
