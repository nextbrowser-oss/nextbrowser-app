const { EXPECTED_DETAIL, OFFLINE_DETAIL } = require("./nbc-failure-report.cjs");
const { builtinErrorMessage } = require("./invoke-failure-report.cjs");

// Decides which Automation Studio replays are worth an error report: a run
// that ended "failed", in a step or in the browser runner before the first
// step. A run the user stopped is not, and neither is a step that failed
// because the profile's own proxy or the network is down. The report carries
// the step number, the tool and an error code; never the step's output or the
// error text, because both can quote the page. The exception is a JavaScript
// error the runner itself threw (TypeError, SyntaxError, …): its class is the
// code, and its message comes along without the values it quotes.

const TOOL = /^[a-z][a-z0-9_]{0,40}$/;
const RUNTIMES = new Set(["clawbrowser", "camoufox", "chromium", "multilogin"]);
// Failures the runner itself words (automation-runner.cjs), by code.
const RUNNER_ERRORS = [
  [/timed out after \d+ seconds/i, "RUNNER_TIMEOUT"],
  [/^Browser runner (?:exited|is not available)/i, "RUNNER_EXITED"],
  [/No element matches the saved|matches \d+ elements/i, "LOCATOR_FAILED"],
  [/returned only empty|complete result rows, but this workflow requires|returned an invalid “[^”]*” URL/i, "DATA_INCOMPLETE"],
  [/needs AI repair|not supported by deterministic replay|cannot be replayed safely|needs a CSS row container|needs a Next button/i, "STEP_NOT_REPLAYABLE"],
];
// A code nbc or Chromium put in the message on purpose: "CDP_UNREACHABLE: …",
// "net::ERR_TIMED_OUT", "… [ELEMENT_STALE]".
const MESSAGE_CODE = /^(?:[A-Za-z]+:\s*)?([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+):|net::(ERR_[A-Z_]+)|\[([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\]/;

function errorCode(message) {
  for (const [pattern, code] of RUNNER_ERRORS) if (pattern.test(message)) return code;
  const match = message.match(MESSAGE_CODE);
  return match ? match[1] || match[2] || match[3] : "UNCLASSIFIED";
}

/** Describes one finished automation run: an event only for a failure. */
function describeAutomationResult({ result, runtime }) {
  if (result?.status !== "failed") return { event: null };
  const message = String(result.error || "");
  if (EXPECTED_DETAIL.test(message) || OFFLINE_DETAIL.test(message)) return { event: null };
  const index = Number.isInteger(result.failedStep) ? result.failedStep : -1;
  const tool = index >= 0 && TOOL.test(String(result.results?.[index]?.tool || "")) ? result.results[index].tool : "";
  const classified = errorCode(message);
  const detail = classified === "UNCLASSIFIED" ? builtinErrorMessage(String(result.errorName || ""), message) : "";
  const code = detail ? result.errorName : classified;
  const reason = detail ? `${code}: ${detail}` : code;
  return {
    event: {
      source: "main",
      kind: "command_failed",
      name: "AUTOMATION_STEP_FAILED",
      message: index >= 0
        ? `Automation step ${index + 1} (${tool || "unknown"}) failed: ${reason}`
        : `Automation runner failed before the first step: ${reason}`,
      context: {
        error_code: code,
        ...(index >= 0 ? { step: String(index + 1), tool: tool || "unknown" } : {}),
        ...(RUNTIMES.has(runtime) ? { runtime } : {}),
      },
      fingerprintExtra: `${tool} ${code}`,
    },
  };
}

module.exports = { describeAutomationResult };
