const fs = require("node:fs");
const path = require("node:path");

function appExecutable(candidate, platform) {
  if (platform === "darwin" && candidate.toLowerCase().endsWith(".app")) {
    return path.join(candidate, "Contents", "MacOS", "Clawbrowser");
  }
  return candidate;
}

function browserRuntimeCandidates({ platform, homeDir, env = {}, runtimeRoot }) {
  const candidates = [];
  if (env.CLAWBROWSER_BIN) candidates.push(env.CLAWBROWSER_BIN);

  if (platform === "darwin") {
    candidates.push(
      path.join(runtimeRoot, "data", "Clawbrowser.app"),
      path.join(homeDir, ".local", "share", "clawbrowser", "Clawbrowser.app"),
      path.join(homeDir, "Applications", "Clawbrowser.app"),
      path.join(homeDir, "Downloads", "Clawbrowser.app"),
      path.join(homeDir, "Desktop", "Clawbrowser.app"),
      "/Applications/Clawbrowser.app",
    );
  } else if (platform === "win32") {
    const roots = [
      path.join(runtimeRoot, "data"),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Clawbrowser"),
      env.ProgramFiles && path.join(env.ProgramFiles, "Clawbrowser"),
      env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "Clawbrowser"),
    ].filter(Boolean);
    for (const root of roots) {
      candidates.push(
        path.join(root, "Clawbrowser", "clawbrowser.exe"),
        path.join(root, "Application", "clawbrowser.exe"),
        path.join(root, "clawbrowser.exe"),
      );
    }
  }

  return [...new Set(candidates.map((candidate) => appExecutable(path.resolve(candidate), platform)))];
}

function resolveBrowserRuntime(options) {
  for (const candidate of browserRuntimeCandidates(options)) {
    try {
      fs.accessSync(candidate, options.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Continue through standard install locations.
    }
  }
  return null;
}

function browserInstallArgs(runtimeRoot) {
  return [
    "install", "generic",
    "--no-api-key-prompt",
    "--progress",
    "--install-root", path.join(runtimeRoot, "data"),
    "--data-dir", path.join(runtimeRoot, "data"),
    "--cache-dir", path.join(runtimeRoot, "cache"),
    // Do not replace the managed executable while it is running on Windows.
    "--bin-dir", path.join(runtimeRoot, "installer-bin"),
    "--agent-plugins-dir", path.join(runtimeRoot, "agent-plugins"),
    "--format", "json",
  ];
}

function requiresBrowserRuntime(args) {
  return ["start", "setup", "launch", "rotate"].includes(String(args?.[0] || "").toLowerCase());
}

module.exports = {
  browserInstallArgs,
  browserRuntimeCandidates,
  requiresBrowserRuntime,
  resolveBrowserRuntime,
};
