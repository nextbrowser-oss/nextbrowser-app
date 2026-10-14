const LINUX_TERMINALS = ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"];

function linuxTerminalArgs(terminal, commandText) {
  return terminal === "gnome-terminal" ? ["--", "sh", "-lc", commandText] : ["-e", "sh", "-lc", commandText];
}

// A missing terminal is reported through the child's "error" event, not by a
// throw from spawn(). Wait for "spawn" or "error" before trying the next one;
// an unhandled "error" event would otherwise crash the main process.
async function openLinuxTerminal(commandText, { spawn, terminals = LINUX_TERMINALS }) {
  for (const terminal of terminals) {
    const started = await new Promise((resolve) => {
      let child;
      try {
        child = spawn(terminal, linuxTerminalArgs(terminal, commandText), { detached: true, stdio: "ignore" });
      } catch {
        resolve(false);
        return;
      }
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    });
    if (started) return terminal;
  }
  throw new Error(`No terminal emulator found. Run this command in a terminal instead: ${commandText}`);
}

module.exports = { LINUX_TERMINALS, linuxTerminalArgs, openLinuxTerminal };
