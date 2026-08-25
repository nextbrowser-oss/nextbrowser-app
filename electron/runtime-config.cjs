const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// NextBrowser runtime tokens are minted by the backend with this prefix
// (see GenerateRuntimeToken / VerifyRuntimeToken). A Clawbrowser key never
// carries it, which lets the migration tell the two apart when they share the
// legacy config path.
const NEXTBROWSER_TOKEN_PREFIX = "nb_live_";
const DEFAULT_RUNTIME_API_BASE_URL = "https://api.nextbrowser.com";

// A development entity service may not expose browser Remote Session routes.
// Keep runtime traffic independently configurable while the app continues to
// send workspace and Automation entities to NEXTBROWSER_DEV_API_BASE_URL.
function runtimeAPIBaseURL(env = process.env) {
  return String(
    env.NEXTBROWSER_RUNTIME_API_BASE_URL
      || env.NEXTBROWSER_API_BASE_URL
      || env.CLAWBROWSER_API_BASE_URL
      || DEFAULT_RUNTIME_API_BASE_URL,
  ).replace(/\/$/, "");
}

// Legacy (pre-isolation) config path. Before the app switched to an isolated
// NEXTBROWSER_CONFIG_DIR, `nbc config set` wrote the key to nbc's default
// config dir. Mirrors nbc ResolveConfigDir and electron/proxy-traffic.cjs.
function legacyConfigPath({ homeDir = os.homedir(), platform = process.platform, env = process.env } = {}) {
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
    return path.join(localAppData, "Clawbrowser", "config.json");
  }
  return path.join(homeDir, ".config", "clawbrowser", "config.json");
}

// Legacy (pre-isolation) state root, which nbc also uses as the default profile
// root (profiles.DefaultRoot -> session.DefaultStateRoot). Uniform across
// platforms in nbc: $XDG_STATE_HOME/clawbrowser or ~/.local/state/clawbrowser.
function legacyStateRoot({ homeDir = os.homedir(), env = process.env } = {}) {
  const xdgStateHome = typeof env.XDG_STATE_HOME === "string" ? env.XDG_STATE_HOME.trim() : "";
  const base = xdgStateHome || path.join(homeDir, ".local", "state");
  return path.join(base, "clawbrowser");
}

// Build the one-time upgrade migration plan (ordered steps to copy). Returns []
// (no-op) unless this machine has a genuine, not-yet-migrated NextBrowser
// session. Safe by construction:
//   - runs only when the isolated config is absent (i.e. first isolated launch),
//   - only for a genuine NextBrowser runtime token, so a Clawbrowser key sharing
//     the legacy path is never imported,
//   - never overwrites an existing isolated target,
//   - config.json is copied LAST so it acts as the completion marker: a crash
//     mid-migration simply retries on the next launch.
// Scope: login (config.json) + profile metadata (country / proxy / fingerprint
// bindings). Ephemeral session state and the heavy per-session Chrome cache are
// intentionally left behind (nbc rebuilds them per launch).
function planRuntimeMigration({ runtimeRoot, homeDir, platform, env, exists, readFile }) {
  const isolatedConfigPath = path.join(runtimeRoot, "config", "config.json");
  if (exists(isolatedConfigPath)) return [];

  const legacyPath = legacyConfigPath({ homeDir, platform, env });
  if (path.resolve(legacyPath) === path.resolve(isolatedConfigPath) || !exists(legacyPath)) return [];

  let apiKey = "";
  try {
    const parsed = JSON.parse(readFile(legacyPath));
    apiKey = typeof parsed?.api_key === "string" ? parsed.api_key.trim() : "";
  } catch {
    return [];
  }
  if (!apiKey.startsWith(NEXTBROWSER_TOKEN_PREFIX)) return [];

  const steps = [];
  const stateRoot = legacyStateRoot({ homeDir, env });
  const newProfileRoot = path.join(runtimeRoot, "profiles");
  for (const sub of ["profiles", "profile-proxies"]) {
    const from = path.join(stateRoot, sub);
    const to = path.join(newProfileRoot, sub);
    if (exists(from) && !exists(to)) steps.push({ kind: "dir", from, to });
  }
  // config.json last — completion marker for the run.
  steps.push({ kind: "file", from: legacyPath, to: isolatedConfigPath });
  return steps;
}

// Execute the plan against the real filesystem. Best-effort and idempotent:
// each step is isolated so one failure never blocks the rest (config.json, the
// completion marker, is always attempted). Returns the steps it ran.
async function applyLegacyRuntimeMigration({
  runtimeRoot,
  homeDir = os.homedir(),
  platform = process.platform,
  env = process.env,
} = {}) {
  const steps = planRuntimeMigration({
    runtimeRoot,
    homeDir,
    platform,
    env,
    exists: (p) => fsSync.existsSync(p),
    readFile: (p) => fsSync.readFileSync(p, "utf8"),
  });
  for (const step of steps) {
    try {
      await fs.mkdir(path.dirname(step.to), { recursive: true, mode: 0o700 });
      if (step.kind === "dir") {
        await fs.cp(step.from, step.to, { recursive: true, force: false, errorOnExist: false });
      } else {
        await fs.copyFile(step.from, step.to);
        await fs.chmod(step.to, 0o600);
      }
    } catch {
      // Best-effort per step: a failed piece just isn't carried over.
    }
  }
  return steps;
}

// macOS treats ~/Library/Application Support as a protected location for
// sandboxed terminal agents. Move the app-owned runtime to ~/.nextbrowser and
// seed it once from the former userData/runtime directory. Copying (rather than
// renaming) keeps rollback to an older app build possible.
async function applyRuntimeRootMigration({ fromRoot, toRoot } = {}) {
  if (!fromRoot || !toRoot || path.resolve(fromRoot) === path.resolve(toRoot)) return false;
  if (!fsSync.existsSync(fromRoot) || fsSync.existsSync(toRoot)) return false;
  try {
    await fs.mkdir(path.dirname(toRoot), { recursive: true, mode: 0o700 });
    await fs.cp(fromRoot, toRoot, { recursive: true, force: false, errorOnExist: false });
    return true;
  } catch {
    return false;
  }
}

async function clearRuntimeCredential({ runtimeRoot }) {
  const configDir = path.join(runtimeRoot, "config");
  const configPath = path.join(configDir, "config.json");
  let payload = {};
  try {
    const raw = await fs.readFile(configPath, "utf8");
    payload = JSON.parse(raw);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("NextBrowser config must contain a JSON object");
  }
  delete payload.api_key;
  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(configPath, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") await fs.chmod(configPath, 0o600);
}

module.exports = {
  NEXTBROWSER_TOKEN_PREFIX,
  runtimeAPIBaseURL,
  legacyConfigPath,
  legacyStateRoot,
  planRuntimeMigration,
  applyLegacyRuntimeMigration,
  applyRuntimeRootMigration,
  clearRuntimeCredential,
};
