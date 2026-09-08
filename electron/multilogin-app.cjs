const fs = require("node:fs");
const path = require("node:path");

// The token lives inside the installed Multilogin app, so step one of the connect dialog can open
// it directly. Anyone who has not installed it yet lands on the download page instead.
const MULTILOGIN_DOWNLOAD_URL = "https://multilogin.com/download/";

// Windows ships the desktop app as "MLXDesktopApp.exe" under "…\\AppData\\Local\\Multilogin App",
// so the name test has to accept the MLX spelling as well as the full product name.
const MULTILOGIN_NAME = /multilogin|mlx/i;
const SUPPORT_BINARY = /unins|uninstall|setup|installer|update|crash|helper|report/i;

function multiloginAppCandidates({ platform, homeDir, env = {} }) {
  const candidates = [];
  if (env.MULTILOGIN_APP) candidates.push(env.MULTILOGIN_APP);

  if (platform === "darwin") {
    for (const root of [path.join(homeDir, "Applications"), "/Applications"]) {
      candidates.push(path.join(root, "Multilogin X.app"), path.join(root, "Multilogin.app"));
    }
  } else if (platform === "win32") {
    for (const root of multiloginAppRoots({ platform, homeDir, env })) {
      candidates.push(
        // The path Multilogin documents for launching the desktop app from a script.
        path.join(root, "Multilogin App", "MLXDesktopApp.exe"),
        path.join(root, "Multilogin X", "Multilogin X.exe"),
        path.join(root, "Multilogin", "Multilogin.exe"),
      );
    }
  } else {
    candidates.push(
      "/opt/Multilogin X/multilogin-x",
      "/opt/multilogin-x/multilogin-x",
      "/usr/bin/multilogin-x",
      "/usr/bin/multilogin",
    );
  }

  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

// Only these roots are listed, and only entries named after Multilogin are opened, so the scan that
// backs up the known paths stays cheap even inside a crowded Program Files.
function multiloginAppRoots({ platform, homeDir, env = {} }) {
  if (platform === "darwin") return [path.join(homeDir, "Applications"), "/Applications"];
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
    return [local, path.join(local, "Programs"), env.ProgramFiles, env["ProgramFiles(x86)"]].filter(Boolean);
  }
  return ["/opt", "/usr/lib"];
}

function looksLikeApp(target, entry, platform) {
  if (platform === "darwin") return entry.isDirectory() && /\.app$/i.test(entry.name);
  if (platform === "win32") return entry.isFile() && /\.exe$/i.test(entry.name);
  if (!entry.isFile()) return false;
  try {
    fs.accessSync(target, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function readEntries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function namedForMultilogin(entry) {
  return MULTILOGIN_NAME.test(entry.name) && !SUPPORT_BINARY.test(entry.name);
}

function findInInstallDir(dir, platform, depth) {
  const entries = readEntries(dir);
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (namedForMultilogin(entry) && looksLikeApp(target, entry, platform)) return target;
  }
  if (depth <= 0) return null;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nested = findInInstallDir(path.join(dir, entry.name), platform, depth - 1);
    if (nested) return nested;
  }
  return null;
}

function findInRoot(root, platform) {
  for (const entry of readEntries(root)) {
    if (!namedForMultilogin(entry)) continue;
    const target = path.join(root, entry.name);
    if (looksLikeApp(target, entry, platform)) return target;
    if (entry.isDirectory()) {
      const nested = findInInstallDir(target, platform, 1);
      if (nested) return nested;
    }
  }
  return null;
}

function installedApp(candidate, platform) {
  try {
    const stats = fs.statSync(candidate);
    if (platform === "darwin" && /\.app$/i.test(candidate)) return stats.isDirectory();
    return stats.isFile();
  } catch {
    return false;
  }
}

// Windows records where every installer put its app, so a custom install location is still found
// after the known paths and the scan come up empty.
function windowsInstallPathsFromRegistry(output) {
  const paths = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:DisplayIcon|InstallLocation)\s+REG_[A-Z_]+\s+(.+?)\s*$/i);
    if (!match) continue;
    const value = match[1].replace(/,\s*-?\d+\s*$/, "").replace(/^"|"$/g, "").trim();
    if (value && MULTILOGIN_NAME.test(value)) paths.push(value);
  }
  return [...new Set(paths)];
}

function findViaRegistry(queryRegistry, platform) {
  if (platform !== "win32" || typeof queryRegistry !== "function") return null;
  let output = "";
  try {
    output = queryRegistry();
  } catch {
    return null;
  }
  for (const candidate of windowsInstallPathsFromRegistry(output)) {
    if (/\.exe$/i.test(candidate) && installedApp(candidate, platform)) return candidate;
    const nested = findInInstallDir(candidate, platform, 1);
    if (nested) return nested;
  }
  return null;
}

function resolveMultiloginApp(options) {
  for (const candidate of multiloginAppCandidates(options)) {
    if (installedApp(candidate, options.platform)) return candidate;
  }
  for (const root of multiloginAppRoots(options)) {
    const found = findInRoot(root, options.platform);
    if (found) return found;
  }
  return findViaRegistry(options.queryRegistry, options.platform);
}

module.exports = {
  MULTILOGIN_DOWNLOAD_URL,
  multiloginAppCandidates,
  multiloginAppRoots,
  resolveMultiloginApp,
  windowsInstallPathsFromRegistry,
};
