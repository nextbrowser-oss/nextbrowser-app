const path = require("node:path");

// `nbc install --agent <agent>`, which the app runs on every agent
// connection, copies the nbc that runs it into nbc's own bin directory
// (%LOCALAPPDATA%\Clawbrowser\bin on Windows, ~/.local/bin elsewhere) and
// puts that directory on PATH. When the app's managed nbc is older than the
// nbc already there (a second Nextbrowser data folder, a newer nbc the user
// installed), the install downgrades the nbc every terminal and agent runs.
// Newer nbc builds check this themselves; released 1.2.35–1.2.37 do not, so
// the app skips that install while the nbc on PATH is newer than its own.

/** The directory `nbc install` copies nbc into when no --bin-dir is given. */
function nbcInstallBinDir({ platform = process.platform, env = process.env, homeDir }) {
  const configured = String(env.CLAWBROWSER_BIN_DIR || "").trim();
  if (configured) return configured;
  if (platform === "win32") {
    const localAppData = String(env.LOCALAPPDATA || "").trim() || path.win32.join(homeDir, "AppData", "Local");
    return path.win32.join(localAppData, "Clawbrowser", "bin");
  }
  return path.posix.join(homeDir, ".local", "bin");
}

/** True for the agent integration install that copies nbc into its bin directory. */
function isAgentIntegrationInstall(args) {
  const list = Array.isArray(args) ? args.map(String) : [];
  return list[0] === "install" && list.some((arg) => arg === "--agent" || arg.startsWith("--agent="))
    && !list.some((arg) => arg === "--bin-dir" || arg.startsWith("--bin-dir="));
}

/** major.minor.patch of "nbc v1.2.37", "nextctl 1.2.36-rc1", …; null when there is none. */
function nbcVersion(text) {
  const match = String(text || "").match(/\bv?(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1, 4).map(Number) : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

/**
 * The newer nbc an agent integration install would replace, or undefined
 * when the install may go ahead: nothing there, the same file, versions that
 * cannot be read, or an installed nbc that is not newer.
 *
 * readVersion(binary) resolves to that binary's `--version` output.
 */
async function newerNbcAtInstallTarget({ appBinary, platform = process.platform, env = process.env, homeDir, exists, readVersion }) {
  if (!appBinary) return undefined;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const target = pathApi.join(nbcInstallBinDir({ platform, env, homeDir }), platform === "win32" ? "nbc.exe" : "nbc");
  const same = platform === "win32"
    ? pathApi.resolve(target).toLowerCase() === pathApi.resolve(appBinary).toLowerCase()
    : pathApi.resolve(target) === pathApi.resolve(appBinary);
  if (same || !(await exists(target))) return undefined;
  const [installed, own] = (await Promise.all([readVersion(target), readVersion(appBinary)])).map(nbcVersion);
  if (!installed || !own || compareVersions(installed, own) <= 0) return undefined;
  return { target, installed: installed.join("."), own: own.join(".") };
}

module.exports = {
  isAgentIntegrationInstall,
  nbcInstallBinDir,
  nbcVersion,
  newerNbcAtInstallTarget,
};
