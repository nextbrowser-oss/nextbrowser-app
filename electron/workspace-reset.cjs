const fs = require("node:fs/promises");
const path = require("node:path");
const { userError } = require("./user-error.cjs");

const RESET_MARKER = ".workspace-reset-pending";
const APP_LOCK_FILES = new Set([RESET_MARKER, "lockfile", "SingletonCookie", "SingletonLock", "SingletonSocket"]);

async function deleteCloudWorkspaces({ list, remove }) {
  const { workspaces } = await list();
  if (!Array.isArray(workspaces)) throw userError("Could not verify the account’s workspace list.");
  for (const { id } of workspaces) {
    if (typeof id !== "string" || !id.trim()) throw userError("Could not verify a workspace ID.");
    try { await remove(id); }
    catch (error) { if (error.status !== 404) throw error; }
  }
  const remaining = await list();
  if (!Array.isArray(remaining.workspaces) || remaining.workspaces.length) {
    throw userError("Some cloud workspaces remain. Close other Nextbrowser sessions and retry the reset.");
  }
}

async function removeContents(dir, keep = new Set()) {
  const stat = await fs.lstat(dir).catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return;
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("A Nextbrowser data directory is not a regular directory.");
  for (const name of await fs.readdir(dir)) {
    if (!keep.has(name)) await fs.rm(path.join(dir, name), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function finishPendingWorkspaceReset({ userData, sessionData, runtime, nextctl, workspace, protectedRoots }) {
  const marker = path.join(userData, RESET_MARKER);
  const markerStat = await fs.lstat(marker).catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!markerStat) return;
  if (!markerStat.isFile()) throw new Error("Invalid Nextbrowser reset marker.");
  const dirs = [...new Set([userData, sessionData, runtime, nextctl, workspace].filter(Boolean).map(dir => path.resolve(dir)))];
  for (const dir of dirs) {
    const real = await fs.realpath(dir).catch(error => {
      if (error.code === "ENOENT") return dir;
      throw error;
    });
    const protectedDirectory = protectedRoots.some(root => {
      const relative = path.relative(dir, path.resolve(root));
      return !relative || (!path.isAbsolute(relative) && relative.split(path.sep)[0] !== "..");
    });
    const markerPath = path.relative(dir, userData);
    const containsMarkerDirectory = markerPath && !path.isAbsolute(markerPath) && markerPath.split(path.sep)[0] !== "..";
    if (path.relative(dir, real) || dir === path.parse(dir).root || protectedDirectory || containsMarkerDirectory) {
      throw new Error("Refusing to erase a shared directory.");
    }
  }
  for (const dir of dirs) {
    const ownsMarker = path.relative(dir, userData) === "";
    await removeContents(dir, ownsMarker ? APP_LOCK_FILES : undefined);
  }
  // An empty config marks this as an initialized, signed-out installation
  // so the legacy migration cannot restore the previous login and profiles.
  const configDir = path.join(runtime, "config");
  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(configDir, "config.json"), "{}", { mode: 0o600 });
  await fs.rm(marker);
}

module.exports = { RESET_MARKER, deleteCloudWorkspaces, finishPendingWorkspaceReset };
