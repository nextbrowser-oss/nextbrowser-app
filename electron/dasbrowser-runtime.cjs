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
    const local = env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
    for (const root of [local, env.ProgramFiles, env["ProgramFiles(x86)"], path.join(runtimeRoot, "data")].filter(Boolean)) {
      candidates.push(
        path.join(root, "Dasbrowser", "Application", "dasbrowser.exe"),
        path.join(root, "Dasbrowser", "dasbrowser.exe"),
        path.join(root, "DasBrowser", "Application", "Dasbrowser.exe"),
        path.join(root, "DasBrowser", "Dasbrowser.exe"),
      );
    }
  }
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
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

function requestedBrowserRuntime(args = []) {
  const index = args.indexOf("--runtime");
  return index >= 0 ? String(args[index + 1] || "").toLowerCase() : "clawbrowser";
}

function adaptDasbrowserArgs(args, executable) {
  const adapted = [...args];
  const index = adapted.indexOf("--runtime");
  if (index >= 0) adapted[index + 1] = "chromium";
  else adapted.push("--runtime", "chromium");
  const binaryIndex = adapted.indexOf("--runtime-bin");
  if (binaryIndex >= 0) adapted[binaryIndex + 1] = executable;
  else adapted.push("--runtime-bin", executable);
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
  dasbrowserReleaseVersion,
  dasbrowserRuntimeCandidates,
  officialDasbrowserURLFromHTML,
  requestedBrowserRuntime,
  resolveDasbrowserRuntime,
};
