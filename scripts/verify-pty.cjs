const pty = require("node-pty");

// GitHub's hosted macOS ARM runner currently rejects node-pty's helper with
// `posix_spawnp failed`, although the same smoke test passes on a normal macOS
// host and in the packaged app. Keep the local macOS coverage and exercise the
// Windows ConPTY path in CI, where this regression originally occurred.
if (process.platform === "darwin" && process.env.GITHUB_ACTIONS === "true") {
  process.stdout.write("PTY smoke test skipped on the hosted macOS runner.\n");
  process.exit(0);
}

const marker = `NEXTBROWSER_PTY_OK_${process.pid}`;
const windows = process.platform === "win32";
// CI may expose SHELL as a runner-specific path that is not available to the
// node-pty helper. /bin/sh is the portable shell guaranteed by macOS/Linux.
const file = windows ? (process.env.ComSpec || "cmd.exe") : "/bin/sh";
const args = windows
  ? ["/D", "/S", "/C", `echo ${marker}`]
  : ["-c", `printf '%s\\n' '${marker}'`];

let output = "";
let terminal;
let timeout;
let finished = false;

function finish(exitCode, message) {
  if (finished) return;
  finished = true;
  if (timeout) clearTimeout(timeout);
  try {
    terminal?.kill();
  } catch {
    // The child may already have exited.
  }
  (exitCode === 0 ? process.stdout : process.stderr).write(message, () => {
    // node-pty can retain a ConPTY pipe handle after onExit on Windows.
    // Explicit termination keeps this one-shot smoke test from hanging CI.
    process.exit(exitCode);
  });
}

try {
  terminal = pty.spawn(file, args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: Object.fromEntries(
      Object.entries(process.env).filter(([, value]) => typeof value === "string"),
    ),
  });
} catch (error) {
  finish(1, `PTY smoke test could not start on ${process.platform}: ${error.message}\n`);
}

terminal?.onData((data) => {
  output += data;
});

terminal?.onExit(({ exitCode }) => {
  if (exitCode !== 0 || !output.includes(marker)) {
    finish(1, `PTY smoke test failed (exit ${exitCode}).\n${output}\n`);
    return;
  }
  finish(0, `PTY smoke test passed on ${process.platform}.\n`);
});

if (terminal) {
  timeout = setTimeout(() => {
    finish(1, "PTY smoke test timed out.\n");
  }, 10_000);
}
