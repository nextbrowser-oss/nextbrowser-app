const path = require("node:path");

// Development storage, not a security sandbox. Packaged DEV builds use a
// dedicated default root; unpackaged builds can opt in with the environment.
// Keep HOME unchanged, but never migrate real account data.
function devDataPaths({ env = process.env, isPackaged, isDevPackage = false, homeDir }) {
  const value = env.NEXTBROWSER_DEV_DATA_ROOT ??
    (isDevPackage ? path.join(homeDir, ".nextbrowser-dev") : undefined);
  if (value === undefined) return null;
  if (isPackaged && !isDevPackage) throw new Error("NEXTBROWSER_DEV_DATA_ROOT is only supported by development builds.");
  if (!value.trim() || !path.isAbsolute(value)) throw new Error("NEXTBROWSER_DEV_DATA_ROOT must be an absolute dedicated directory.");
  const root = path.resolve(value);
  if (root === path.parse(root).root || root === path.resolve(homeDir)
      || root === path.join(homeDir, ".nextbrowser")) {
    throw new Error("NEXTBROWSER_DEV_DATA_ROOT must not be a shared home or runtime root.");
  }
  return {
    userData: path.join(root, "app"),
    runtime: path.join(root, "runtime"),
    nextctl: path.join(root, "managed-nextctl"),
  };
}

module.exports = { devDataPaths };
