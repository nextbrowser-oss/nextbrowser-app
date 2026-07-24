const { execFile } = require("node:child_process");

const activeCommands = new Map();
const DEFAULT_MAX_BUFFER = 32 * 1024 * 1024;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 5 * 60 * 1_000;

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
    const active = { child: null, cancelled: false };
    const child = execFile(
      file,
      args,
      {
        env: options.env,
        windowsHide: options.windowsHide ?? true,
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
        timeout: timeoutMs,
        killSignal: "SIGTERM",
      },
      (error, stdout, stderr) => {
        if (requestId && activeCommands.get(requestId) === active) {
          activeCommands.delete(requestId);
        }
        if (!error) {
          resolve({ stdout: stdout || "", stderr: stderr || "", code: 0 });
          return;
        }
        let detail = stderr || error.message || "";
        if (active.cancelled) {
          detail = "Command cancelled.";
        } else if (error.killed && timeoutMs) {
          detail = `Command timed out after ${Math.ceil(timeoutMs / 1_000)} seconds.`;
        }
        resolve({
          stdout: stdout || "",
          stderr: detail,
          code: Number.isInteger(error.code) ? error.code : -1,
        });
      },
    );
    active.child = child;
    if (requestId) activeCommands.set(requestId, active);
  });
}

module.exports = {
  cancelAllCommands,
  cancelCommand,
  runCommand,
};
