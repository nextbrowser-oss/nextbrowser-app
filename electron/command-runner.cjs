const { spawn } = require("node:child_process");

const activeCommands = new Map();
const DEFAULT_MAX_BUFFER = 32 * 1024 * 1024;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 5 * 60 * 1_000;
const EXIT_DRAIN_MS = 100;

function normalizedRequestId(value) {
  const id = String(value || "").trim();
  return id ? id.slice(0, 128) : "";
}

function normalizedTimeout(value) {
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout <= 0) return undefined;
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.round(timeout)));
}

function cancelCommand(requestId) {
  const id = normalizedRequestId(requestId);
  const active = activeCommands.get(id);
  if (!active) return false;
  active.cancelled = true;
  active.child.kill();
  return true;
}

function cancelAllCommands() {
  for (const id of activeCommands.keys()) cancelCommand(id);
}

function runCommand(file, args, options = {}) {
  const requestId = normalizedRequestId(options.requestId);
  const timeoutMs = normalizedTimeout(options.timeoutMs);
  if (requestId) cancelCommand(requestId);

  return new Promise((resolve) => {
    const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
    const active = { child: null, cancelled: false, timedOut: false };
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: options.windowsHide ?? true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    active.child = child;
    if (requestId) activeCommands.set(requestId, active);
    let stdout = "";
    let stderr = "";
    let settled = false;
    let exitTimer;
    let timeoutTimer;
    const append = (current, chunk) => {
      const next = current + chunk.toString();
      if (Buffer.byteLength(next) <= maxBuffer) return next;
      active.cancelled = true;
      child.kill("SIGTERM");
      return next.slice(-maxBuffer);
    };
    const finish = (code, errorMessage = "") => {
      if (settled) return;
      settled = true;
      if (exitTimer) clearTimeout(exitTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (requestId && activeCommands.get(requestId) === active) activeCommands.delete(requestId);
      let detail = errorMessage || stderr;
      if (active.timedOut && timeoutMs) detail = `Command timed out after ${Math.ceil(timeoutMs / 1_000)} seconds.`;
      else if (active.cancelled) detail = detail || "Command cancelled.";
      resolve({ stdout, stderr: detail, code: active.cancelled || active.timedOut ? -1 : code });
    };
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.once("error", (error) => finish(-1, error.message));
    child.once("exit", (code) => {
      // Detached browser/streaming children may inherit stdout. Waiting for
      // their pipes to close leaves an already-finished profile launch stuck
      // on Starting, so drain only the direct child's final output briefly.
      exitTimer = setTimeout(() => finish(code ?? -1), EXIT_DRAIN_MS);
    });
    child.once("close", (code) => finish(code ?? -1));
    if (timeoutMs) {
      timeoutTimer = setTimeout(() => {
        active.timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);
    }
  });
}

module.exports = {
  cancelAllCommands,
  cancelCommand,
  runCommand,
};
