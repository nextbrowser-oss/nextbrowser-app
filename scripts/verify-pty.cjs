const pty = require("node-pty");

const marker = `NEXTBROWSER_PTY_OK_${process.pid}`;
const windows = process.platform === "win32";
const file = windows ? (process.env.ComSpec || "cmd.exe") : (process.env.SHELL || "/bin/sh");
const args = windows
  ? ["/D", "/S", "/C", `echo ${marker}`]
  : ["-lc", `printf '%s\\n' '${marker}'`];

const terminal = pty.spawn(file, args, {
  name: "xterm-256color",
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => typeof value === "string"),
  ),
});

let output = "";
const timeout = setTimeout(() => {
  terminal.kill();
  process.stderr.write("PTY smoke test timed out.\n");
  process.exit(1);
}, 10_000);

terminal.onData((data) => {
  output += data;
});

terminal.onExit(({ exitCode }) => {
  clearTimeout(timeout);
  if (exitCode !== 0 || !output.includes(marker)) {
    process.stderr.write(`PTY smoke test failed (exit ${exitCode}).\n${output}\n`);
    process.exit(1);
  }
  process.stdout.write(`PTY smoke test passed on ${process.platform}.\n`);
});
