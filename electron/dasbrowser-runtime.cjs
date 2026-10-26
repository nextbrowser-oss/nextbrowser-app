const fs = require("node:fs");
const path = require("node:path");

const DASBROWSER_DOWNLOADS = {
  darwin: "https://cdn.dasbrowser.com/144.31/dasbrowser.dmg",
  win32: "https://cdn.dasbrowser.com/144.31/DasbrowserSetup.exe",
};

function dasbrowserReleaseVersion(url) {
  return String(url || "").match(/cdn\.dasbrowser\.com\/(\d+(?:\.\d+)+)\//i)?.[1] || "";
}

function officialDasbrowserURLFromHTML(html, platform, fallback = DASBROWSER_DOWNLOADS[platform]) {
  const directPattern = platform === "darwin"
    ? /https:\/\/cdn\.dasbrowser\.com\/[^"']+\.dmg/i
    : /https:\/\/cdn\.dasbrowser\.com\/[^"']+\.exe/i;
  const direct = String(html || "").match(directPattern)?.[0];
  if (direct) return direct;
  const version = String(html || "").match(/https:\/\/cdn\.dasbrowser\.com\/(\d+(?:\.\d+)+)\//i)?.[1];
  if (!version) return fallback;
  if (platform === "darwin") return `https://cdn.dasbrowser.com/${version}/dasbrowser.dmg`;
  if (platform === "win32") return `https://cdn.dasbrowser.com/${version}/DasbrowserSetup.exe`;
  return fallback;
}

function windowsDasbrowserRoots({ homeDir, env = {}, runtimeRoot }) {
  const local = env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
  return [local, env.ProgramFiles, env["ProgramFiles(x86)"], path.join(runtimeRoot, "data")].filter(Boolean);
}

function dasbrowserRuntimeCandidates({ platform, homeDir, env = {}, runtimeRoot }) {
  const candidates = [];
  if (env.DASBROWSER_BIN) candidates.push(env.DASBROWSER_BIN);
  if (platform === "darwin") {
    candidates.push(
      path.join(runtimeRoot, "data", "Dasbrowser.app", "Contents", "MacOS", "Dasbrowser"),
      path.join(homeDir, "Applications", "Dasbrowser.app", "Contents", "MacOS", "Dasbrowser"),
      "/Applications/Dasbrowser.app/Contents/MacOS/Dasbrowser",
    );
  } else if (platform === "win32") {
    for (const root of windowsDasbrowserRoots({ homeDir, env, runtimeRoot })) {
      candidates.push(
        path.join(root, "Dasbrowser", "Application", "dasbrowser.exe"),
        path.join(root, "Dasbrowser", "dasbrowser.exe"),
        path.join(root, "DasBrowser", "Application", "Dasbrowser.exe"),
        path.join(root, "DasBrowser", "Dasbrowser.exe"),
        // Current DasbrowserSetup.exe installs the Chromium launcher under
        // its standard name inside the Dasbrowser folder.
        path.join(root, "Dasbrowser", "Application", "chrome.exe"),
      );
    }
  }
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

function formatExitCode(code) {
  if (!Number.isInteger(code)) return "unknown";
  // Windows setups report HRESULT-style failures; the hex form is the one
  // that can be looked up.
  return Math.abs(code) > 255 ? `${code} (0x${(code >>> 0).toString(16).toUpperCase().padStart(8, "0")})` : String(code);
}

function formatDuration(durationMs) {
  return Number.isFinite(durationMs) ? `${Math.max(0, Math.round(durationMs / 1_000))} s` : "an unknown time";
}

// DasbrowserSetup.exe is the Chromium updater's metainstaller. A per-user
// install (the default for a non-elevated app) logs every step here.
function windowsSetupLog({ homeDir, env = {} }) {
  return path.join(env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local"), "Dasbrowser", "DasbrowserUpdater", "updater.log");
}

/**
 * Explains a DasbrowserSetup.exe run that did not succeed. The setup writes
 * nothing to stdout or stderr, so its exit code is the only evidence the app
 * gets, and it must reach the user instead of a bare "installation failed".
 */
function dasbrowserSetupFailureMessage({ exitCode, durationMs, output = "", homeDir, env = {} } = {}) {
  const detail = String(output || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  // runCommand reports a timeout or a cancel as exit code -1 with the reason.
  const summary = exitCode === -1 && detail
    ? `DasBrowser setup did not finish after ${formatDuration(durationMs)}: ${detail.replace(/[.\s]+$/, "")}.`
    : `DasBrowser setup failed with exit code ${formatExitCode(exitCode)} after ${formatDuration(durationMs)}.${detail ? ` ${detail}` : ""}`;
  return `${summary} DasBrowser's setup log: ${windowsSetupLog({ homeDir, env })}`;
}

/**
 * Explains a finished install whose browser is in none of the locations the
 * app checks: what the setup reported, and where the app looked.
 */
function dasbrowserNotFoundMessage({ platform, homeDir, env = {}, runtimeRoot, setup } = {}) {
  const finished = setup
    ? `DasBrowser setup finished with exit code ${formatExitCode(setup.exitCode)} after ${formatDuration(setup.durationMs)}, but its browser was not found.`
    : "DasBrowser was installed, but its browser was not found.";
  if (platform !== "win32") {
    return `${finished} Looked in: ${dasbrowserRuntimeCandidates({ platform, homeDir, env, runtimeRoot }).join("; ")}.`;
  }
  const override = env.DASBROWSER_BIN ? ` DASBROWSER_BIN points to ${path.resolve(env.DASBROWSER_BIN)}.` : "";
  return `${finished} Looked for ${path.join("Dasbrowser", "Application", "chrome.exe")} and dasbrowser.exe under: ${windowsDasbrowserRoots({ homeDir, env, runtimeRoot }).join("; ")}.${override} DasBrowser's setup log: ${windowsSetupLog({ homeDir, env })}`;
}

function resolveDasbrowserRuntime(options) {
  for (const candidate of dasbrowserRuntimeCandidates(options)) {
    try {
      fs.accessSync(candidate, options.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Continue through managed and official install locations.
    }
  }
  return null;
}

function compareVersionFoldersDescending(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (b[index] || 0) - (a[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

// The Windows setup keeps the public DasBrowser release (the version the
// download page lists, e.g. 151.4) in dasbrowser_version.txt inside the
// Chromium version folder next to the launcher:
// Application\151.0.7922.113\dasbrowser_version.txt. The Chromium version is
// not the release and must not be compared with it. A self-update adds the
// new folder beside the old one, so the newest folder is the installed release.
async function installedDasbrowserReleaseVersion(executable) {
  if (!executable) return "";
  const applicationDir = path.dirname(path.resolve(executable));
  let entries;
  try {
    entries = await fs.promises.readdir(applicationDir, { withFileTypes: true });
  } catch {
    return "";
  }
  const versionFolders = entries
    .filter((entry) => entry.isDirectory() && /^\d+(?:\.\d+){3}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareVersionFoldersDescending);
  for (const folder of versionFolders) {
    try {
      const version = (await fs.promises.readFile(path.join(applicationDir, folder, "dasbrowser_version.txt"), "utf8")).trim();
      if (/^\d+(?:\.\d+)+$/.test(version)) return version;
    } catch {
      // Older installs have no release file; try the next folder.
    }
  }
  return "";
}

/**
 * Records which DasBrowser release this app installed, beside the managed
 * runtimes (`<runtimeRoot>/data`). On Windows the DasBrowser setup installs
 * into %LOCALAPPDATA%, so when DasBrowser is the first browser installed the
 * data folder does not exist yet; it is created here.
 */
async function writeDasbrowserReleaseMarker(runtimeRoot, { version, url, now = new Date() }) {
  const file = path.join(runtimeRoot, "data", ".dasbrowser-browser-release.json");
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, JSON.stringify({ version, download_url: url, updated_at: now.toISOString() }, null, 2), "utf8");
  return file;
}

function requestedBrowserRuntime(args = []) {
  const index = args.indexOf("--runtime");
  return index >= 0 ? String(args[index + 1] || "").toLowerCase() : "clawbrowser";
}

function adaptDasbrowserArgs(args, executable) {
  const adapted = [...args];
  const index = adapted.indexOf("--runtime");
  if (index >= 0) adapted[index + 1] = "chromium";
  else adapted.push("--runtime", "chromium");
  if (executable) {
    const binaryIndex = adapted.indexOf("--runtime-bin");
    if (binaryIndex >= 0) adapted[binaryIndex + 1] = executable;
    else adapted.push("--runtime-bin", executable);
  }
  return adapted;
}

function dasbrowserAppCopyOptions() {
  return {
    recursive: true,
    preserveTimestamps: true,
    // Chromium app bundles use relative framework symlinks. Node resolves
    // symlink targets by default while copying, which would permanently point
    // the installed app at the temporary mounted DMG and break its signature
    // as soon as the image is detached.
    verbatimSymlinks: true,
  };
}

module.exports = {
  DASBROWSER_DOWNLOADS,
  adaptDasbrowserArgs,
  dasbrowserAppCopyOptions,
  dasbrowserNotFoundMessage,
  dasbrowserReleaseVersion,
  dasbrowserRuntimeCandidates,
  dasbrowserSetupFailureMessage,
  installedDasbrowserReleaseVersion,
  officialDasbrowserURLFromHTML,
  requestedBrowserRuntime,
  resolveDasbrowserRuntime,
  writeDasbrowserReleaseMarker,
};
