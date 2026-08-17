const AGENT_OUTPUT_LIMIT = 200_000;
const AGENT_EXIT_DRAIN_MS = 100;

function appendOutput(current, chunk) {
  const output = current + chunk.toString();
  return output.length > AGENT_OUTPUT_LIMIT
    ? output.slice(output.length - AGENT_OUTPUT_LIMIT)
    : output;
}

function runAgentProcess(options) {
  const child = options.spawnProcess(options.file, options.args, {
    cwd: options.cwd || undefined,
    env: options.env,
    windowsHide: true,
    stdio: [options.stdinText != null ? "pipe" : "ignore", "pipe", "pipe"],
  });
  options.onSpawn(child);
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let exitTimer = null;
    const finish = (code, errorMessage = "") => {
      if (settled) return;
      settled = true;
      if (exitTimer) clearTimeout(exitTimer);
      const result = { code, stdout, stderr: errorMessage || stderr };
      try { options.onDone(result); } catch {}
      resolve(result);
    };
    child.stdout.on("data", (chunk) => {
      stdout = appendOutput(stdout, chunk);
      options.onStdout(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendOutput(stderr, chunk);
      options.onStderr(chunk);
    });
    child.once("error", (error) => finish(-1, error.message));
    child.once("exit", (code) => {
      exitTimer = setTimeout(() => finish(code ?? -1), AGENT_EXIT_DRAIN_MS);
    });
    child.once("close", (code) => finish(code ?? -1));
    if (options.stdinText != null) child.stdin.end(options.stdinText);
  });
}

module.exports = { runAgentProcess };
