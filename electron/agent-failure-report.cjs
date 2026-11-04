const os = require("node:os");

// Decides which agent CLI runs (Codex, Claude Code, ...) are worth an error
// report, and finds the reason for a failed run in the CLI's error output.
// A run that exits non-zero on its own is reported, and so are a run that
// exits 0 without a reply and a run the app stopped because it took too long.
// A stop the user asked for, a run cut short by quitting the app and a
// sign-in the chat already asks for are not. From standard error only the
// error line is taken, because the rest of it is the agent's transcript.
// Standard output is the reply, which can quote page data; the one line taken
// from it is the error `claude -p` prints there instead of to standard error.

// Same rule as finishAgentRun in src/store.ts, which asks the user to sign in.
const AUTH_FAILURE = /(?:failed to authenticate|oauth session expired|could not be refreshed|not logged in|sign in required|login required)/i;
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
// What the CLI prints when it gives up: "ERROR: ...", "Error: ...",
// "API Error: ...", "stream error: ...", or a Rust panic.
const FATAL_LINE = /^(?:\[[^\]]*\]\s*)?(?:[A-Za-z]+ )?(?:error|fatal)\s*:|panicked at /i;
// Codex also logs non-fatal internal errors as tracing lines
// ("2026-10-07T14:07:47Z ERROR codex_core::x: ..."); one is the reason only
// when nothing fatal was printed.
const LOG_ERROR_LINE = /^\S*\d{2}:\d{2}:\d{2}\S*\s+(?:ERROR|FATAL)\s/;
// What `claude -p` prints to standard output when a run fails: the API error
// it gives as its reply ("API Error: Connection refused"), "Error: Reached max
// turns (5)" and the other "Error: ..." results, or "Execution error".
const CLAUDE_STDOUT_ERROR_LINE = /^(?:API Error: |Error: |Execution error$)/;
const REASON_MAX = 300;
const AGENT_ID = /^[a-z][a-z0-9-]{0,31}$/;
const RUNS = new Set(["chat", "plain", "workflow_author", "terminal"]);
// A terminal CLI the user interrupted with Ctrl+C (130, or Windows'
// STATUS_CONTROL_C_EXIT) ended on purpose.
const INTERRUPTED_EXIT_CODES = new Set([130, 3221225786]);
// Signals that end a process only when it crashed. node-pty reports the
// signal's number; aliases (SIGIOT for SIGABRT) come later in the list.
const CRASH_SIGNALS = new Set(["SIGSEGV", "SIGABRT", "SIGBUS", "SIGILL", "SIGFPE"]);
const SIGNAL_NAMES = new Map(Object.entries(os.constants.signals).reverse().map(([name, number]) => [number, name]));

function lastLinesFirst(output) {
  return String(output || "").replace(ANSI, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse();
}

function capReason(line) {
  return line.length > REASON_MAX ? `${line.slice(0, REASON_MAX - 1)}…` : line;
}

function agentFailureReason(stderr) {
  const lines = lastLinesFirst(stderr);
  return capReason(lines.find((candidate) => FATAL_LINE.test(candidate)) || lines.find((candidate) => LOG_ERROR_LINE.test(candidate)) || "");
}

/** The last error line `claude -p` printed to standard output; never any other line of the reply. */
function claudeStdoutFailureReason(stdout) {
  return capReason(lastLinesFirst(stdout).find((candidate) => CLAUDE_STDOUT_ERROR_LINE.test(candidate)) || "");
}

function agentName(agentId) {
  return AGENT_ID.test(String(agentId || "")) ? String(agentId) : "unknown";
}

/**
 * Describes one finished agent run: the reason to show in the chat, and an
 * event only when the failure is unexpected (see the rule at the top).
 * `outcome.timedOut` marks a run the app itself stopped for taking too long.
 */
function describeAgentResult({ agentId, result, outcome = {}, durationMs, plain = false, run = plain ? "plain" : "chat" }) {
  const code = Number.isInteger(result?.code) ? result.code : -1;
  const stderr = String(result?.stderr ?? "");
  const reason = code === 0 ? "" : agentFailureReason(stderr);
  if (outcome.stopped || outcome.quitting) return { reason, event: null };
  const agent = agentName(agentId);
  const event = (name, message) => ({
    source: "agent",
    kind: "command_failed",
    name,
    message,
    context: {
      agent,
      exit_code: String(code),
      run: RUNS.has(run) ? run : "chat",
      ...(Number.isFinite(durationMs) ? { duration_ms: String(Math.round(durationMs)) } : {}),
    },
    fingerprintExtra: agent,
  });
  if (outcome.timedOut) return { reason, event: event("AGENT_TIMED_OUT", `${agent} did not finish in time and was stopped`) };
  if (code === 0) {
    return { reason, event: String(result?.stdout ?? "").trim() ? null : event("AGENT_EMPTY_REPLY", `${agent} exited with code 0 without a reply`) };
  }
  if (AUTH_FAILURE.test(`${stderr}\n${result?.stdout ?? ""}`)) return { reason, event: null };
  // The chat already shows Claude Code's standard output as the reply, so its
  // error line goes to the report only.
  const reported = reason || (agent === "claude" ? claudeStdoutFailureReason(result?.stdout) : "");
  return { reason, event: event("AGENT_STOPPED_UNEXPECTEDLY", `${agent} exited with code ${code}: ${reported || "no error line in its output"}`) };
}

const BUILTIN_PROVIDERS = new Set(["nvidia", "openrouter", "gemini", "custom"]);
const BUILTIN_FAILURE_CODE = /^[a-z][a-z_]{1,31}$/;
const BUILTIN_MODEL = /^[A-Za-z0-9._:/-]{1,120}$/;

/**
 * Describes a finished run of the built-in Nextbrowser agent
 * (builtin-agent-run.cjs), which has a failure code instead of an exit line.
 * The same runs as for an agent CLI are reported, except a failure the user
 * fixes in Settings (a rejected key, a free limit, a model without tool
 * support): the chat already says what to do. A run that ends because the
 * provider could not be reached is a report of kind network. The report
 * names the provider and, for a preset provider, the model; never the key,
 * the prompt, the base URL, or what the provider answered.
 */
function describeBuiltinAgentResult({ result, provider, model, outcome = {}, durationMs, run = "chat" }) {
  if (outcome.stopped || outcome.quitting) return { event: null };
  const providerId = BUILTIN_PROVIDERS.has(provider) ? provider : "unknown";
  const failure = result?.failure && typeof result.failure === "object" ? result.failure : null;
  const failureCode = BUILTIN_FAILURE_CODE.test(String(failure?.code || "")) ? failure.code : "unknown";
  const context = {
    agent: "nextbrowser",
    provider: providerId,
    ...(providerId !== "custom" && BUILTIN_MODEL.test(String(model || "")) ? { model: String(model) } : {}),
    run: RUNS.has(run) ? run : "chat",
    ...(Number.isFinite(durationMs) ? { duration_ms: String(Math.round(durationMs)) } : {}),
  };
  const event = (name, message, extra = {}, kind = "command_failed") => ({
    source: "agent",
    kind,
    name,
    message,
    context: { ...context, ...extra },
    fingerprintExtra: `nextbrowser:${providerId}`,
  });
  if (outcome.timedOut) return { event: event("AGENT_TIMED_OUT", "nextbrowser did not finish in time and was stopped") };
  if (result?.code === 0) {
    return { event: String(result?.stdout ?? "").trim() ? null : event("AGENT_EMPTY_REPLY", `nextbrowser (${providerId}) answered without a reply`) };
  }
  if (!failure) return { event: event("AGENT_STOPPED_UNEXPECTEDLY", "nextbrowser stopped without a failure code", { failure: "unknown" }) };
  const status = Number.isInteger(failure.status) ? { status: String(failure.status) } : {};
  if (failureCode === "network") {
    const networkError = /^[A-Za-z0-9_]{1,40}$/.test(String(failure.networkCode || "")) ? failure.networkCode : "other";
    return { event: event("BUILTIN_AGENT_NETWORK", `nextbrowser could not reach ${providerId}: ${networkError}`, { network_error: networkError }, "network") };
  }
  // Stopping after its step limit is the model's failure, not the user's:
  // reported, to see which models cannot finish their tasks.
  if (failure.expected === true && failureCode !== "max_steps") return { event: null };
  return { event: event(`BUILTIN_AGENT_${failureCode.toUpperCase()}`, `nextbrowser (${providerId}) failed: ${failureCode}${status.status ? ` (HTTP ${status.status})` : ""}`, { failure: failureCode, ...status }) };
}

/**
 * Describes an agent CLI in a terminal that ended by itself with an error or
 * a crash. A terminal the app closed (Close, leaving the page, quitting) or
 * the user interrupted is not reported. Nothing the terminal printed is sent.
 */
function describeTerminalExit({ agentId, exitCode, signal, uptimeMs, closedByApp = false }) {
  if (closedByApp) return { event: null };
  const code = Number.isInteger(exitCode) ? exitCode : 0;
  const signalName = typeof signal === "string" ? signal : SIGNAL_NAMES.get(signal) || "";
  const crashed = CRASH_SIGNALS.has(signalName);
  if (!crashed && (code === 0 || INTERRUPTED_EXIT_CODES.has(code))) return { event: null };
  const agent = agentName(agentId);
  return {
    event: {
      source: "agent",
      kind: "command_failed",
      name: "TERMINAL_EXITED_UNEXPECTEDLY",
      message: `${agent} terminal exited with ${crashed ? `signal ${signalName}` : `code ${code}`}`,
      context: {
        agent,
        exit_code: String(code),
        run: "terminal",
        ...(signalName ? { signal: signalName } : {}),
        ...(Number.isFinite(uptimeMs) ? { uptime_ms: String(Math.round(uptimeMs)) } : {}),
      },
      fingerprintExtra: agent,
    },
  };
}

module.exports = {
  agentFailureReason,
  describeAgentResult,
  describeBuiltinAgentResult,
  describeTerminalExit,
};
