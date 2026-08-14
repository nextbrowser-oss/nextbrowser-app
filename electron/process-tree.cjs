const { execFile } = require("node:child_process");
const path = require("node:path");

function descendants(processes, rootPid) {
  const children = new Map();
  for (const process of processes) {
    const list = children.get(process.ppid) || [];
    list.push(process);
    children.set(process.ppid, list);
  }
  const result = [];
  const visit = (pid) => {
    for (const child of children.get(pid) || []) {
      visit(child.pid);
      result.push(child);
    }
  };
  visit(Number(rootPid));
  return result;
}

function isNextctlProcess(command) {
  const portable = String(command || "").replace(/\\/g, "/");
  const name = path.basename(portable).toLowerCase().replace(/\.exe$/, "");
  return name === "nextctl" || name === "nbc";
}

function nextctlSubtree(processes, rootPid) {
  const withinRoot = descendants(processes, rootPid);
  // Preserve the long-lived MCP server and its browser runtime children.
  // Cancelling its active request is handled by MCP notifications. This
  // fallback only terminates separate one-shot nextctl/nbc invocations that
  // the agent may have launched directly.
  const nextctlRoots = new Set(withinRoot.filter((process) => isNextctlProcess(process.command)).map((process) => process.pid));
  const persistentRoots = new Set(withinRoot
    .filter((process) => process.ppid === Number(rootPid) && nextctlRoots.has(process.pid))
    .map((process) => process.pid));
  const selected = new Set([...nextctlRoots].filter((pid) => !persistentRoots.has(pid)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of withinRoot) {
      if (selected.has(process.pid) || !selected.has(process.ppid)) continue;
      selected.add(process.pid);
      changed = true;
    }
  }
  return withinRoot.filter((process) => selected.has(process.pid));
}

function execFileText(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? "" : String(stdout || ""));
    });
  });
}

async function processSnapshot(platform = process.platform) {
  if (platform === "win32") {
    const script = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath,Name | ConvertTo-Json -Compress";
    const output = await execFileText("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    if (!output.trim()) return [];
    try {
      const rows = JSON.parse(output);
      return (Array.isArray(rows) ? rows : [rows]).map((row) => ({
        pid: Number(row.ProcessId),
        ppid: Number(row.ParentProcessId),
        command: String(row.ExecutablePath || row.Name || ""),
      })).filter((row) => Number.isInteger(row.pid) && Number.isInteger(row.ppid));
    } catch {
      return [];
    }
  }
  const output = await execFileText("ps", ["-axo", "pid=,ppid=,comm="]);
  return output.split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }] : [];
  });
}

function signalPids(pids, signal = "SIGTERM") {
  for (const pid of [...new Set(pids)].filter((value) => Number.isInteger(value) && value > 1)) {
    try { process.kill(pid, signal); } catch { /* already exited or inaccessible */ }
  }
}

async function terminateProcessTree(rootPid, { includeRoot = true, nextctlOnly = false, platform = process.platform } = {}) {
  const pid = Number(rootPid);
  if (!Number.isInteger(pid) || pid <= 1) return false;
  // Freeze a non-terminal agent before taking the snapshot so it cannot spawn
  // another browser command between discovery and termination.
  if (includeRoot && platform !== "win32") signalPids([pid], "SIGSTOP");
  const processes = await processSnapshot(platform);
  const targets = nextctlOnly ? nextctlSubtree(processes, pid) : descendants(processes, pid);
  const targetPids = targets.map((process) => process.pid);
  signalPids(targetPids, "SIGTERM");
  if (includeRoot) signalPids([pid], "SIGTERM");
  setTimeout(() => signalPids([...targetPids, ...(includeRoot ? [pid] : [])], "SIGKILL"), 750).unref?.();
  return targetPids.length > 0 || includeRoot;
}

module.exports = {
  descendants,
  isNextctlProcess,
  nextctlSubtree,
  processSnapshot,
  terminateProcessTree,
};
