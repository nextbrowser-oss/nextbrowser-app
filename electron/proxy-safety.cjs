const fs = require("node:fs");
const path = require("node:path");
function parseCommand(args) {
  const valueFlags = new Set(["--profile", "--runtime", "--format", "--cdp", "--proxy-safety-file"]);
  let profile = "", runtime = "clawbrowser", command = "";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--profile") profile = args[i + 1] || "";
    if (arg === "--runtime") runtime = args[i + 1] || "clawbrowser";
    if (valueFlags.has(arg)) { i++; continue; }
    if (!arg.startsWith("-") && !command) command = arg;
  }
  return { profile, runtime, command };
}
function payload(result) {
  let data;
  try { data = JSON.parse(result?.stdout || "{}"); } catch { throw new Error("Invalid browser response"); }
  if (result?.code !== 0 || data.ok === false || data.error) {
    const error = new Error(data.error?.message || "Browser command failed");
    error.code = data.error?.code;
    throw error;
  }
  return data.data ?? data;
}

function requireGreen(result) {
  const verify = payload(result).verify;
  if (!verify?.finalized || verify.status !== "pass" || !verify.checks?.length || verify.checks.some((c) => c.pass !== true)) throw new Error("Fresh verification failed");
}
const diagnostic = new Set(["start", "rotate", "stop", "status", "verify", "profiles", "version", "doctor", "config", "identity", "proxy", "proxy-traffic"]);
function createProxySafety({ file, run, pause, publish, discover }) {
  const watched = new Map(), busy = new Map(), proxyModes = new Map();
  let recovering = false, polling = false, timer, recoveryEpoch = 0, emergencyState = null;
  const key = (p) => `${p.runtime}:${p.profile}`;
  const args = (p) => ["--profile", p.profile, "--runtime", p.runtime];
  function state() {
    if (emergencyState) return emergencyState;
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!value || typeof value !== "object" || typeof value.phase !== "string") throw new Error("Invalid safety state");
      return value;
    }
    catch (error) { if (error.code === "ENOENT") return null; return { phase: "blocked", message: "Safety state cannot be read. Local work remains paused." }; }
  }
  function save(value) {
    // Block native entry points even when the disk cannot store the latch.
    emergencyState = { ...value, phase: "blocked", message: "Safety state could not be saved. Local work remains paused." };
    let persisted = false;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
      emergencyState = null;
      persisted = true;
    } catch { /* Cleanup must still run; an I/O failure never permits work. */ }
    try { publish(emergencyState ?? value); } catch { /* UI delivery cannot prevent cleanup. */ }
    return persisted;
  }
  async function command(p, name) { return run([...args(p), name, ...(name === "verify" ? ["--timeout", "15s"] : []), "--format", "json"]); }
  async function stop(p) { payload(await command(p, "stop")); }
  async function recover(current = state()) {
    if (recovering || !current || typeof current.profile !== "string") return;
    recovering = true;
    const epoch = ++recoveryEpoch;
    const checkCancelled = () => { if (epoch !== recoveryEpoch) throw new Error("Recovery cancelled"); };
    const p = { ...current, proxyExpected: current.proxyExpected ?? proxyModes.get(current.profile) !== "direct" };
    try {
      const persisted = save({ ...p, phase: "recovering", attempt: 0, message: "Connection lost. Stopping local tasks and the profile." });
      let pauseError;
      try { await pause(); } catch (error) { pauseError = error; }
      await stop(p); // Stop the browser even if stopping an agent failed.
      if (pauseError || !persisted) throw new Error("Safety cleanup could not be completed");
      checkCancelled();
      for (let attempt = 1; attempt <= 3; attempt++) {
        checkCancelled();
        if (!save({ ...p, phase: "recovering", attempt, message: `Restoring the same connection (${attempt}/3)…` })) throw new Error("Safety state could not be saved");
        try {
          payload(await command(p, "start"));
          checkCancelled();
          requireGreen(await command(p, "verify"));
          checkCancelled();
          watched.set(key(p), p);
          if (!save({ ...p, phase: "recovered", attempt, message: "Connection verified. Review the interrupted action before resuming queued tasks." })) {
            await stop(p);
            throw new Error("Safety state could not be saved");
          }
          return;
        } catch {
          await stop(p);
          checkCancelled();
        }
      }
      save({ ...p, phase: "failed", attempt: 3, message: "The connection failed three times. The profile is stopped; local tasks remain paused." });
    } catch {
      save({ ...p, phase: "blocked", message: epoch !== recoveryEpoch ? "Recovery cancelled. Local tasks remain paused." : "Recovery could not safely stop the profile. Local work remains blocked." });
    } finally { recovering = false; }
  }
  async function poll() {
    if (polling || recovering) return;
    polling = true;
    try {
      const blocked = state();
      if (blocked) {
        // A CLI/MCP process may have tripped the durable interlock.
        if (blocked.phase === "blocked" && !blocked.handled) {
          save({ ...blocked, handled: true });
          await recover({ ...blocked, handled: true });
        }
        if (blocked.phase === "recovered") {
          try { requireGreen(await command(blocked, "verify")); }
          catch (error) { if (error.code !== "VERIFY_BUSY") await recover({ ...blocked, handled: true }); }
        }
        return;
      }
      if (discover) {
        try {
          for (const p of await discover()) {
            const id = key(p);
            proxyModes.set(p.profile, p.proxyMode);
            if (!busy.has(id) && !watched.has(id)) {
              try {
                const status = payload(await command(p, "status"));
                if ((status.status ?? status.session?.status) === "running") watched.set(id, p);
              } catch { /* No known live session to protect yet. */ }
            }
          }
        } catch { /* Existing watched sessions still get checked. */ }
      }
      for (const [id, p] of watched) {
        if (busy.has(id)) continue;
        try {
          const status = payload(await command(p, "status"));
          const statusName = status.status ?? status.session?.status;
          if (statusName === "stopped") { watched.delete(id); continue; }
          if (statusName !== "running") throw new Error("Browser status is indeterminate");
          requireGreen(await command(p, "verify"));
        } catch (error) {
          if (error.code === "VERIFY_BUSY") continue;
          if (busy.has(id) || !watched.has(id)) continue; // A user lifecycle operation owns this profile now.
          const failure = { ...p, phase: "blocked", handled: true, proxyExpected: proxyModes.get(p.profile) !== "direct", message: "Connection verification failed. Local tasks are paused." };
          save(failure); // Persist before killing processes or waiting for cleanup.
          await recover(failure);
          break;
        }
      }
    } finally { polling = false; }
  }
  function begin(commandArgs) {
    const p = parseCommand(commandArgs);
    if (state() && !diagnostic.has(p.command)) throw new Error("PROXY_CONNECTION_LOST: local browser work is paused. Review recovery in NextBrowser.");
    const id = key(p), lifecycle = ["start", "rotate", "stop"].includes(p.command);
    if (recovering && ["start", "rotate"].includes(p.command)) throw new Error("Connection recovery is already running. Stop it before starting another profile.");
    if (recovering && p.command === "stop" && key(state() || {}) === id) recoveryEpoch++;

    if (lifecycle) { busy.set(id, (busy.get(id) || 0) + 1); watched.delete(id); }
    return (result) => {
      if (lifecycle) { const n = (busy.get(id) || 1) - 1; if (n) busy.set(id, n); else busy.delete(id); }
      try {
        const data = payload(result);
        if (p.command === "profiles" && Array.isArray(data.profiles)) for (const profile of data.profiles) proxyModes.set(profile.name, profile.proxy_mode);
        if (["start", "rotate"].includes(p.command) || (p.command === "status" && (data.status ?? data.session?.status) === "running")) watched.set(id, p);
      } catch { /* Failed launches are handled by preflight/CLI cleanup. */ }
    };
  }
  async function resume() {
    const current = state();
    if (!current || recovering || current.phase !== "recovered") throw new Error("Restore and verify the connection before resuming.");
    try { requireGreen(await command(current, "verify")); }
    catch {
      await recover({ ...current, handled: true });
      throw new Error("Fresh verification failed. Work remains paused; review the new recovery result.");
    } // Never clear a latch using the old recovery result.
    fs.unlinkSync(file);
    publish(null);
  }
  return { state, begin, poll, recover, resume, isRecovering: () => recovering,
    start() { timer = setInterval(() => void poll().catch(() => {}), 10000); timer.unref?.(); void poll().catch(() => {}); },
    dispose() { clearInterval(timer); } };
}
module.exports = { createProxySafety, parseCommand, requireGreen };
