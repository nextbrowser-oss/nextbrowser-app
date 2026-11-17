import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const timeoutMs = Number(process.env.SMOKE_LAUNCH_TIMEOUT_MS ?? 90_000);

function executableFor(target) {
  if (!target.endsWith(".app")) return target;
  const plist = path.join(target, "Contents", "Info.plist");
  const name = execFileSync("plutil", ["-extract", "CFBundleExecutable", "raw", plist], { encoding: "utf8" }).trim();
  return path.join(target, "Contents", "MacOS", name);
}

async function pageTarget(port) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })).json();
    return targets.find((target) => target.type === "page") ?? null;
  } catch {
    return null;
  }
}

function smokeFile(userDataDir, name) {
  try {
    return readFileSync(path.join(userDataDir, name), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") process.stderr.write(`Could not read ${name}: ${error.code}\n`);
    return "";
  }
}

function macProcessSnapshot(pid) {
  if (process.platform !== "darwin" || !pid) return "";
  try {
    return execFileSync("sample", [String(pid), "2", "10"], {
      encoding: "utf8", timeout: 8_000, maxBuffer: 2 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    }).split("Binary Images:")[0].slice(0, 12_000);
  } catch {
    return "Could not collect a macOS process sample.";
  }
}

const target = process.argv[2];
if (!target) throw new Error("Usage: node scripts/smoke-launch.mjs <path to .app or executable>");

const executable = executableFor(path.resolve(target));
const userDataDir = mkdtempSync(path.join(tmpdir(), "nextbrowser-smoke-"));
const child = spawn(executable, [`--user-data-dir=${userDataDir}`, "--remote-debugging-port=0"], {
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
let port = null;
let exited = null;
const exitedPromise = new Promise((resolve) => child.on("exit", (code, signal) => resolve((exited = { code, signal }))));
for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    output += chunk;
    port ??= output.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//)?.[1] ?? null;
  });
}

let page = null;
const deadline = Date.now() + timeoutMs;
while (!exited && !page && Date.now() < deadline) {
  if (!port) {
    const activePort = smokeFile(userDataDir, "DevToolsActivePort").split(/\r?\n/, 1)[0];
    if (/^\d+$/.test(activePort)) port = activePort;
  }
  if (port) page = await pageTarget(port);
  if (!page) await new Promise((resolve) => setTimeout(resolve, 500));
}

const crashed = exited;
const processSnapshot = !page && !crashed ? macProcessSnapshot(child.pid) : "";
if (!crashed) child.kill();
await Promise.race([exitedPromise, new Promise((resolve) => setTimeout(resolve, 10_000))]);
const crashLog = !page ? smokeFile(userDataDir, "crash.log").slice(-6000) : "";
try {
  rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
} catch {
  // Windows helpers can hold profile files a moment after the main process exits.
}

if (!page) {
  const reason = crashed
    ? `exited during startup (code ${crashed.code}, signal ${crashed.signal})`
    : `opened no window within ${timeoutMs} ms`;
  process.stderr.write(`${path.basename(executable)} ${reason}. DevTools port detected: ${Boolean(port)}.\n${output.slice(-6000)}\n${crashLog}\n${processSnapshot}\n`);
  process.exit(1);
}
process.stdout.write(`${path.basename(executable)} opened ${page.url}\n`);
