const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function executableNames(name, platform = process.platform) {
  return platform === "win32"
    ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`, `${name}.ps1`, `${name}.com`, name]
    : [name];
}

function searchDirs(options = {}) {
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const env = options.env ?? process.env;
  const dirs = platform === "win32"
    ? [
        ".local/bin",
        ".cargo/bin",
        ".bun/bin",
        ".volta/bin",
        ".openclaw/bin",
        ".codex",
        ".codex/bin",
        ".codex/local",
        ".codex/local/bin",
        ".codex/local/node_modules/.bin",
        ".claude",
        ".claude/bin",
        ".claude/local",
        ".claude/local/bin",
        ".claude/local/node_modules/.bin",
        "scoop/shims",
      ].map((item) => path.join(homeDir, item))
    : [
        ".local/bin",
        ".openclaw/bin",
        ".npm-global/bin",
        ".bun/bin",
        "Library/pnpm",
        ".local/share/pnpm",
        ".yarn/bin",
        ".volta/bin",
        ".cargo/bin",
        "go/bin",
        ".asdf/shims",
        ".local/share/mise/shims",
        ".nodenv/shims",
      ].map((item) => path.join(homeDir, item)).concat(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]);
  if (env.APPDATA) dirs.push(path.join(env.APPDATA, "npm"));
  if (env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, "pnpm"), path.join(env.LOCALAPPDATA, "Microsoft", "WinGet", "Links"));
  if (env.ChocolateyInstall) dirs.push(path.join(env.ChocolateyInstall, "bin"));
  dirs.push(...(env.PATH || "").split(path.delimiter));
  return [...new Set(dirs.filter(Boolean))];
}

function launchable(file, platform = process.platform) {
  try {
    fs.accessSync(file, platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function expand(raw, homeDir = os.homedir()) {
  if (raw === "~") return homeDir;
  if (raw.startsWith("~/") || raw.startsWith("~\\")) return path.join(homeDir, raw.slice(2));
  return raw;
}

function findBinaryUnderRoots(name, roots, platform = process.platform) {
  const names = new Set(executableNames(name, platform).map((candidate) => candidate.toLowerCase()));
  const queue = roots.filter((root) => fs.existsSync(root)).map((root) => ({ dir: root, depth: 0 }));
  const seen = new Set();
  let visited = 0;
  while (queue.length && visited < 500) {
    const { dir, depth } = queue.shift();
    const key = dir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    visited += 1;
    for (const candidate of executableNames(name, platform)) {
      const file = path.join(dir, candidate);
      if (launchable(file, platform)) return file;
    }
    if (depth >= 5) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && names.has(entry.name.toLowerCase())) {
        const file = path.join(dir, entry.name);
        if (launchable(file, platform)) return file;
      }
      if (entry.isDirectory()) queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }
  return null;
}

function binaryFallbackRoots(name, options = {}) {
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const env = options.env ?? process.env;
  const roots = [];
  if (platform === "win32" && ["codex", "claude"].includes(name)) {
    roots.push(path.join(homeDir, `.${name}`));
  }
  if (name !== "codex") return roots;

  if (platform === "darwin") {
    for (const appName of ["ChatGPT", "Codex"]) {
      roots.push(
        path.join("/Applications", `${appName}.app`, "Contents", "Resources"),
        path.join(homeDir, "Applications", `${appName}.app`, "Contents", "Resources"),
      );
    }
  }
  if (platform === "win32") {
    const programDirs = [
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs"),
      env.LOCALAPPDATA,
      env.PROGRAMFILES,
      env["PROGRAMFILES(X86)"],
    ].filter(Boolean);
    for (const dir of programDirs) {
      for (const appName of ["ChatGPT", "Codex"]) roots.push(path.join(dir, appName));
    }
  }
  return [...new Set(roots)];
}

function resolveBinary(name, envVar, options = {}) {
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const env = options.env ?? process.env;
  const configured = envVar && env[envVar] ? expand(env[envVar], homeDir) : null;
  if (configured && launchable(configured, platform)) return configured;

  const fallbackRoots = options.fallbackRoots ?? binaryFallbackRoots(name, { platform, homeDir, env });
  if (name === "codex") {
    const appBinary = findBinaryUnderRoots(name, fallbackRoots, platform);
    if (appBinary) return appBinary;
  }

  const dirs = options.searchPaths ?? searchDirs({ platform, homeDir, env });
  for (const dir of dirs) {
    for (const candidate of executableNames(name, platform)) {
      const file = path.join(dir, candidate);
      if (launchable(file, platform)) return file;
    }
  }

  if (name !== "codex") {
    const fallback = findBinaryUnderRoots(name, fallbackRoots, platform);
    if (fallback) return fallback;
  }
  if (platform !== "win32" && name === "hermes") {
    const file = path.join(homeDir, ".hermes/hermes-agent/.venv/bin/hermes");
    if (launchable(file, platform)) return file;
  }
  return null;
}

module.exports = {
  binaryFallbackRoots,
  executableNames,
  expand,
  findBinaryUnderRoots,
  launchable,
  resolveBinary,
  searchDirs,
};
