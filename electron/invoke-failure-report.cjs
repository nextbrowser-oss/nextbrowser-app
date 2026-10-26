const { OFFLINE_DETAIL } = require("./nbc-failure-report.cjs");

// Decides which failures of the main process are worth an error report: an
// IPC command the renderer called that threw (the renderer then shows the
// error), and a failure the user only sees as a status (an app update, a
// browser runtime install). Skipped: errors the user caused (userError in
// user-error.cjs), errors another reporter has already judged (`reported`:
// the backend request observer, the nbc classifier), cancellations, a signed-
// out account (HTTP 401/403) and an offline machine. A backend 4xx is
// reported as an api_error with its status.
//
// The message is the error's own text, which the reporter scrubs further. It
// loses file paths, URLs and quoted names first, because the app quotes
// profile, workspace and file names in “…”. A JavaScript error (SyntaxError,
// TypeError, …) is named and loses every quoted value instead: its message is
// the runtime's, and a quoted value there is the data it choked on. Commands
// whose errors can echo credentials, prompts or file contents send no message
// at all.

const COMMAND = /^[a-z][a-z0-9_ /-]{0,63}$/;
const CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
// "… [TERMINAL_AGENT_UNAVAILABLE]" or "VERIFY_REQUIRED: …".
const MESSAGE_CODE = /\[([A-Z][A-Z0-9_]{2,63})\]|^([A-Z][A-Z0-9]*_[A-Z0-9_]{2,62}):/;
const CANCELLED = /^(?:Command cancelled|Automation execution was cancelled)\b/i;
// Electron's own network stack names an offline machine this way.
const OFFLINE_NET_ERROR = /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_IO_SUSPENDED/;
const SENSITIVE_COMMANDS = /^(?:manual_proxy_\w+|pairing_\w+|app_data_\w+|write_\w+_skill|multilogin_connect|feedback_submit|read_file|workspace_file_read|terminal_input|agent_run|workflow_author_run)$/;
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>`)\]]+/gi;
const BUILTIN_ERRORS = new Set(["SyntaxError", "TypeError", "RangeError", "ReferenceError", "URIError", "EvalError"]);
const BUILTIN_MESSAGE_LIMIT = 200;
// JSON.parse names the token it stopped at and quotes the start of its input:
// Unexpected token 'p', "{profile:Wo"... is not valid JSON
const JSON_INPUT_ERROR = /^(?:Unexpected token '([\s\S]{1,2})', )?"[\s\S]*"(?:\.\.\.)? is not valid JSON$/;

function errorMessage(error) {
  if (error instanceof Error) return String(error.message || "");
  return typeof error === "string" ? error : "";
}

function statusOf(error) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 0;
}

/** Why a failure is not reported, or "" when it is. */
function skipReason(error) {
  if (error?.expected === true) return "expected";
  if (error?.reported === true) return "reported";
  const message = errorMessage(error);
  if (error?.name === "AbortError" || CANCELLED.test(message)) return "cancelled";
  const status = statusOf(error);
  if (status === 401 || status === 403) return "signed out";
  const cause = error?.cause;
  const detail = [message, error?.code, cause?.message, cause?.code].filter((part) => typeof part === "string").join("\n");
  if (OFFLINE_DETAIL.test(detail) || OFFLINE_NET_ERROR.test(detail)) return "offline";
  return "";
}

function errorCode(error) {
  if (typeof error?.code === "string" && CODE.test(error.code)) return error.code;
  const match = errorMessage(error).match(MESSAGE_CODE);
  return match ? match[1] || match[2] : "";
}

// An invisible token, such as a byte-order mark, is shown by its code point.
function visibleToken(token) {
  return /^[\x21-\x7E]$/.test(token)
    ? token
    : Array.from(token, (char) => `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`).join(" ");
}

/**
 * The message of a JavaScript error (SyntaxError, TypeError, …) without the
 * values it quotes, at most 200 characters, or "" for any other error. A
 * property name the runtime could not read and a single-character token stay.
 */
function builtinErrorMessage(name, message) {
  if (!BUILTIN_ERRORS.has(name)) return "";
  const raw = String(message || "");
  // Matched before whitespace is folded: the token can be a byte-order mark.
  const json = raw.match(JSON_INPUT_ERROR);
  const text = (json
    ? `${json[1] === undefined ? "" : `Unexpected token '${visibleToken(json[1])}', `}"…" is not valid JSON`
    : raw
      .replace(/\s+/g, " ")
      .trim()
      .replace(/"[^"]*"/g, "\"…\"")
      .replace(/'([^']*)'/g, (quoted, inner, offset, whole) =>
        [...inner].length <= 1 || (/\b(?:reading|setting|property) $/.test(whole.slice(0, offset)) && /^[A-Za-z_$][\w$]{0,63}$/.test(inner))
          ? quoted
          : "'…'")
  ).replace(URL_PATTERN, "<url>");
  return text.length > BUILTIN_MESSAGE_LIMIT ? `${text.slice(0, BUILTIN_MESSAGE_LIMIT - 1)}…` : text;
}

/** The error's text without the parts that can name the user's things. */
function safeMessage(error) {
  if (error instanceof Error && BUILTIN_ERRORS.has(error.name)) {
    return `${error.name}: ${builtinErrorMessage(error.name, error.message) || "no message"}`;
  }
  let text = errorMessage(error);
  for (const key of ["path", "dest"]) {
    if (typeof error?.[key] === "string" && error[key]) text = text.split(error[key]).join("<path>");
  }
  return text.replace(URL_PATTERN, "<url>").replace(/“[^”]*”/g, "“…”").trim();
}

// The first stack line repeats the message, so only the frames are kept.
function safeStack(error) {
  const frames = String(error?.stack || "").split(/\r?\n/).filter((line) => /^\s*at\s/.test(line));
  return frames.length ? [String(error?.name || "Error"), ...frames].join("\n") : undefined;
}

function event(error, { kind, name, subject, withMessage, context, fingerprintExtra }) {
  const text = withMessage ? safeMessage(error) : "";
  const stack = safeStack(error);
  return {
    source: "main",
    kind,
    name,
    message: `${subject}: ${text || name}`,
    ...(stack ? { stack } : {}),
    context,
    fingerprintExtra,
  };
}

/**
 * Describes a failed IPC command (or agent control request). `command` is
 * the command name, never its arguments.
 */
function describeInvokeFailure({ command, error }) {
  const name = COMMAND.test(String(command || "")) ? String(command) : "unknown";
  if (skipReason(error)) return { event: null };
  const status = statusOf(error);
  const code = errorCode(error);
  const context = { command: name, ...(code ? { code } : {}), ...(status ? { status: String(status) } : {}) };
  const options = { subject: name, withMessage: !SENSITIVE_COMMANDS.test(name), context, fingerprintExtra: name };
  return {
    event: status
      ? event(error, { ...options, kind: "api_error", name: `HTTP ${status}` })
      : event(error, { ...options, kind: "command_failed", name: code || "IPC_FAILED" }),
  };
}

/**
 * Describes a main-process failure the user sees as a status rather than a
 * thrown command: `name` is the event name (APP_UPDATE_FAILED, ...), and
 * `context` holds identifiers only (phase, runtime).
 */
function describeMainFailure({ name, error, context = {} }) {
  if (skipReason(error)) return { event: null };
  const code = errorCode(error);
  return {
    event: event(error, {
      kind: "command_failed",
      name,
      subject: name,
      withMessage: true,
      context: { ...context, ...(code ? { code } : {}) },
      fingerprintExtra: Object.values(context).join(" "),
    }),
  };
}

module.exports = {
  builtinErrorMessage,
  describeInvokeFailure,
  describeMainFailure,
  skipReason,
};
