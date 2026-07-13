const { app, BrowserWindow, ipcMain, shell, nativeImage, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { defaultSSHConfigPath, discoverSSHHosts, isAllowedExplicitConfigPath } = require("./ssh-config.cjs");

const execFileAsync = promisify(execFile);
const children = new Map();
const remoteSignalSockets = new Map();
const APP_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
let appUpdateStatus = { status: "idle" };
let appUpdateTimer = null;

function home() { return os.homedir(); }
function executableNames(name) {
  return process.platform === "win32"
    ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`, `${name}.ps1`, `${name}.com`, name]
    : [name];
}
function searchDirs() {
  const h = home();
  const dirs = process.platform === "win32"
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
      ].map((p) => path.join(h, p))
    : [".local/bin", ".openclaw/bin", ".npm-global/bin", ".bun/bin", "Library/pnpm", ".local/share/pnpm", ".yarn/bin", ".volta/bin", ".cargo/bin", "go/bin", ".asdf/shims", ".local/share/mise/shims", ".nodenv/shims"].map((p) => path.join(h, p)).concat(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]);
  if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, "npm"));
  if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, "pnpm"), path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links"));
  if (process.env.ChocolateyInstall) dirs.push(path.join(process.env.ChocolateyInstall, "bin"));
  dirs.push(...(process.env.PATH || "").split(path.delimiter));
  return [...new Set(dirs.filter(Boolean))];
}
function launchable(file) {
  try { fsSync.accessSync(file, process.platform === "win32" ? fsSync.constants.F_OK : fsSync.constants.X_OK); return fsSync.statSync(file).isFile(); }
  catch { return false; }
}
function expand(raw) {
  if (raw === "~") return home();
  if (raw.startsWith("~/") || raw.startsWith("~\\")) return path.join(home(), raw.slice(2));
  return raw;
}
function findBinaryUnderRoots(name, roots) {
  const names = new Set(executableNames(name).map((candidate) => candidate.toLowerCase()));
  const queue = roots.filter((root) => fsSync.existsSync(root)).map((root) => ({ dir: root, depth: 0 }));
  const seen = new Set();
  let visited = 0;
  while (queue.length && visited < 500) {
    const { dir, depth } = queue.shift();
    const key = dir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    visited += 1;
    for (const candidate of executableNames(name)) {
      const file = path.join(dir, candidate);
      if (launchable(file)) return file;
    }
    if (depth >= 5) continue;
    let entries = [];
    try { entries = fsSync.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      if (entry.isFile() && names.has(entry.name.toLowerCase())) {
        const file = path.join(dir, entry.name);
        if (launchable(file)) return file;
      }
      if (entry.isDirectory()) queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }
  return null;
}
function resolveBinary(name, envVar) {
  if (envVar && process.env[envVar] && launchable(expand(process.env[envVar]))) return expand(process.env[envVar]);
  for (const dir of searchDirs()) for (const candidate of executableNames(name)) {
    const file = path.join(dir, candidate); if (launchable(file)) return file;
  }
  if (process.platform === "win32" && ["codex", "claude"].includes(name)) {
    const found = findBinaryUnderRoots(name, [path.join(home(), ".codex"), path.join(home(), ".claude")]);
    if (found) return found;
  }
  if (process.platform === "darwin" && name === "codex") {
    for (const file of ["/Applications/Codex.app/Contents/Resources/codex", path.join(home(), "Applications/Codex.app/Contents/Resources/codex")]) if (launchable(file)) return file;
  }
  if (process.platform !== "win32" && name === "hermes") {
    const file = path.join(home(), ".hermes/hermes-agent/.venv/bin/hermes"); if (launchable(file)) return file;
  }
  return null;
}
function childEnv(extra = {}) { return { ...process.env, PATH: searchDirs().join(path.delimiter), ...extra }; }
function commandSpec(binary, args) {
  const ext = path.extname(binary).toLowerCase();
  if (process.platform === "win32" && [".cmd", ".bat"].includes(ext)) return { file: "cmd.exe", args: ["/D", "/S", "/C", binary, ...args] };
  if (process.platform === "win32" && ext === ".ps1") return { file: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", binary, ...args] };
  return { file: binary, args };
}
async function run(binary, args, extraEnv = {}) {
  const spec = commandSpec(binary, args);
  try {
    const result = await execFileAsync(spec.file, spec.args, { env: childEnv(extraEnv), windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    return { stdout: result.stdout || "", stderr: result.stderr || "", code: 0 };
  } catch (error) {
    return { stdout: error.stdout || "", stderr: error.stderr || error.message || "", code: Number.isInteger(error.code) ? error.code : -1 };
  }
}
async function clawctlHasSkill(binary) {
  const r = await run(binary, ["--help"]); return `${r.stdout}\n${r.stderr}`.includes("\n  skill");
}
async function resolveClawctl() {
  if (process.env.CLAWCTL_BIN && launchable(expand(process.env.CLAWCTL_BIN))) return expand(process.env.CLAWCTL_BIN);
  const candidates = [];
  const dev = path.join(home(), "projects/ClawBrowser/clawctl/bin/clawctl"); if (launchable(dev)) candidates.push(dev);
  for (const dir of searchDirs()) for (const name of executableNames("clawctl")) { const f = path.join(dir, name); if (launchable(f)) candidates.push(f); }
  for (const candidate of [...new Set(candidates)]) if (await clawctlHasSkill(candidate)) return candidate;
  return candidates[0] || null;
}
function dataDir() { return path.join(app.getPath("userData")); }
async function migrateLegacyData() {
  const legacy = path.join(app.getPath("appData"), "clawdesk-electron");
  const current = dataDir();
  if (legacy === current || !fsSync.existsSync(legacy) || fsSync.existsSync(current)) return;
  await fs.cp(legacy, current, { recursive: true, errorOnExist: false });
}
function safeName(name) {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes("..")) throw new Error("Invalid app-data filename.");
  return name;
}
function emit(channel, payload) { for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload); }
function quotePosix(value) { return `'${String(value).replaceAll("'", "'\\''")}'`; }
function setAppUpdateStatus(status, patch = {}) {
  appUpdateStatus = { status, ...patch, updatedAt: Date.now() };
  emit("app:update", appUpdateStatus);
}
function configureAutoUpdater() {
  if (!app.isPackaged || !["darwin", "win32"].includes(process.platform)) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("checking-for-update", () => setAppUpdateStatus("checking"));
  autoUpdater.on("update-available", (info) => setAppUpdateStatus("available", { version: info.version }));
  autoUpdater.on("update-not-available", (info) => setAppUpdateStatus("not-available", { version: info.version }));
  autoUpdater.on("download-progress", (progress) => setAppUpdateStatus("downloading", { percent: Math.round(progress.percent ?? 0) }));
  autoUpdater.on("update-downloaded", (info) => setAppUpdateStatus("downloaded", { version: info.version }));
  autoUpdater.on("error", (error) => setAppUpdateStatus("error", { message: error?.message || String(error) }));
}
function reportUpdaterError(error) {
  const message = error?.message || String(error);
  // Builds without an update manifest (dev / electron-builder --dir) can't
  // self-update — treat that as disabled rather than a hard error, and never
  // let it bubble up as an uncaught exception.
  if (/app-update\.yml/i.test(message)) {
    setAppUpdateStatus("disabled", { message: "App updates unavailable in this build." });
  } else {
    setAppUpdateStatus("error", { message });
  }
}
function checkForAppUpdate() {
  if (!app.isPackaged || !["darwin", "win32"].includes(process.platform)) {
    setAppUpdateStatus("disabled", { message: "App updates run only in packaged macOS/Windows builds." });
    return null;
  }
  try {
    return autoUpdater.checkForUpdates().catch((error) => {
      reportUpdaterError(error);
      return null;
    });
  } catch (error) {
    reportUpdaterError(error);
    return null;
  }
}
function startAutoUpdater() {
  try {
    configureAutoUpdater();
  } catch (error) {
    reportUpdaterError(error);
    return;
  }
  if (!app.isPackaged || !["darwin", "win32"].includes(process.platform)) return;
  setTimeout(() => { void checkForAppUpdate(); }, 3000);
  if (appUpdateTimer) clearInterval(appUpdateTimer);
  appUpdateTimer = setInterval(() => { void checkForAppUpdate(); }, APP_UPDATE_CHECK_INTERVAL_MS);
}

async function invokeCommand(command, args = {}) {
  switch (command) {
    case "app_update_status": return appUpdateStatus;
    case "app_check_for_update": {
      await checkForAppUpdate();
      return appUpdateStatus;
    }
    case "app_download_update": {
      if (!app.isPackaged || !["darwin", "win32"].includes(process.platform)) {
        setAppUpdateStatus("disabled", { message: "App updates run only in packaged macOS/Windows builds." });
        return appUpdateStatus;
      }
      if (!["available", "downloaded"].includes(appUpdateStatus.status)) {
        await checkForAppUpdate();
      }
      if (appUpdateStatus.status === "available") {
        try {
          await autoUpdater.downloadUpdate();
        } catch (error) {
          reportUpdaterError(error);
        }
      }
      return appUpdateStatus;
    }
    case "app_install_update": {
      if (appUpdateStatus.status !== "downloaded") return false;
      try {
        autoUpdater.quitAndInstall(false, true);
        return true;
      } catch (error) {
        reportUpdaterError(error);
        return false;
      }
    }
    case "clawctl_resolve": return await resolveClawctl();
    case "clawctl_run": {
      const bin = await resolveClawctl(); if (!bin) throw new Error("clawctl not found. Install Clawbrowser CLI or set CLAWCTL_BIN.");
      return run(bin, args.args || [], args.extraEnv || {});
    }
    case "clawctl_version": {
      const bin = await resolveClawctl(); if (!bin) throw new Error("not found");
      const r = await run(bin, ["version"]); return r.stdout.trim();
    }
    case "clawctl_supports_skill": { const bin = await resolveClawctl(); if (!bin) throw new Error("not found"); return clawctlHasSkill(bin); }
    case "agent_authorize": {
      const bin = resolveBinary(args.binary, args.envVar); if (!bin) throw new Error(`${args.binary} CLI not found.`);
      const r = await run(bin, ["--version"]); if (r.code !== 0) throw new Error(`${args.binary} is not ready: ${(r.stdout + r.stderr).trim()}`);
      return (r.stdout + r.stderr).trim() || args.binary;
    }
    case "agent_check_login": {
      if (!args.statusArgs?.length) return null;
      const bin = resolveBinary(args.binary, args.envVar); if (!bin) throw new Error(`${args.binary} CLI not found.`);
      const r = await run(bin, args.statusArgs); const text = `${r.stdout}${r.stderr}`.toLowerCase();
      if (["not logged in", "logged out", "please run", "not authenticated"].some((v) => text.includes(v))) return false;
      if (["logged in", "authenticated", "account", "email", "subscription", "api key"].some((v) => text.includes(v))) return true;
      return r.code === 0;
    }
    case "open_terminal_login": {
      const bin = resolveBinary(args.binary, args.envVar); if (!bin) throw new Error(`${args.binary} CLI not found.`);
      const loginArgs = args.loginArgs || [];
      if (process.platform === "darwin") {
        const cmd = [bin, ...loginArgs].map(quotePosix).join(" ").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
        spawn("osascript", ["-e", `tell application "Terminal"\nactivate\ndo script "${cmd}"\nend tell`], { detached: true, stdio: "ignore" }).unref();
      } else if (process.platform === "win32") {
        spawn("cmd.exe", ["/D", "/S", "/C", "start", "NextBrowser agent login", "cmd", "/k", bin, ...loginArgs], { detached: true, stdio: "ignore", windowsHide: false }).unref();
      } else {
        const commandText = [bin, ...loginArgs].map(quotePosix).join(" ");
        let started = false;
        for (const terminal of ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"]) try {
          spawn(terminal, terminal === "gnome-terminal" ? ["--", "sh", "-lc", commandText] : ["-e", "sh", "-lc", commandText], { detached: true, stdio: "ignore" }).unref(); started = true; break;
        } catch { /* try next */ }
        if (!started) throw new Error("No terminal emulator found.");
      }
      return null;
    }
    case "read_file": return fs.readFile(args.path, "utf8");
    case "ssh_config_hosts": {
      const requestedPath = typeof args.configPath === "string" ? args.configPath.trim() : "";
      if (requestedPath.length > 4096 || requestedPath.includes("\0")) throw new Error("Invalid SSH config path.");
      if (requestedPath.startsWith("\\\\") || /^\/\/[^/]/.test(requestedPath)) {
        throw new Error("Network SSH config paths are not supported.");
      }
      const configPath = requestedPath ? path.resolve(expand(requestedPath)) : defaultSSHConfigPath(home());
      return discoverSSHHosts({
        configPath,
        homeDir: home(),
        explicitConfig: !!requestedPath,
        env: childEnv(),
      });
    }
    case "select_ssh_config": {
      const owner = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      const options = {
        title: "Choose SSH config",
        defaultPath: defaultSSHConfigPath(home()),
        properties: ["openFile"],
        filters: [
          { name: "SSH config", extensions: ["conf", "config"] },
          { name: "All files", extensions: ["*"] },
        ],
      };
      const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths[0]) return null;
      const selectedPath = result.filePaths[0];
      if (selectedPath.startsWith("\\\\") || /^\/\/[^/]/.test(selectedPath)) {
        throw new Error("Network SSH config paths are not supported.");
      }
      if (!isAllowedExplicitConfigPath(selectedPath)) {
        throw new Error("Choose an SSH config named config or using a .conf or .config extension.");
      }
      return path.resolve(selectedPath);
    }
    case "select_chat_files": {
      const owner = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      const result = await dialog.showOpenDialog(owner, {
        title: "Attach files to chat",
        properties: ["openFile", "multiSelections"],
      });
      if (result.canceled) return [];
      return Promise.all(result.filePaths.map(async (file) => {
        const stat = await fs.stat(file);
        return { name: path.basename(file), path: file, size: stat.size };
      }));
    }
    case "open_path": {
      const error = await shell.openPath(path.resolve(String(args.path || "")));
      if (error) throw new Error(error);
      return null;
    }
    case "show_item_in_folder": {
      shell.showItemInFolder(path.resolve(String(args.path || "")));
      return null;
    }
    case "write_temp_skill": {
      const slug = String(args.slug || "custom").replace(/[^A-Za-z0-9_-]/g, "") || "custom";
      const file = path.join(os.tmpdir(), `${slug}-${process.pid}-${Date.now()}.md`); await fs.writeFile(file, args.content, "utf8"); return file;
    }
    case "remove_temp_file": {
      const file = path.resolve(args.path); if (path.dirname(file) !== path.resolve(os.tmpdir())) throw new Error("Refusing to remove a file outside the temporary directory.");
      await fs.rm(file, { force: true }); return null;
    }
    case "app_data_read": { try { return await fs.readFile(path.join(dataDir(), safeName(args.name)), "utf8"); } catch (e) { if (e.code === "ENOENT") return null; throw e; } }
    case "app_data_write": {
      await fs.mkdir(dataDir(), { recursive: true }); const target = path.join(dataDir(), safeName(args.name)); const temp = `${target}.tmp-${process.pid}-${randomUUID()}`;
      await fs.writeFile(temp, args.content, "utf8");
      try { await fs.rename(temp, target); }
      catch (error) {
        if (process.platform !== "win32") { await fs.rm(temp, { force: true }); throw error; }
        await fs.rm(target, { force: true }); await fs.rename(temp, target);
      }
      return null;
    }
    case "working_directory": { const dir = path.join(dataDir(), "workspace"); await fs.mkdir(dir, { recursive: true }); return dir; }
    case "agent_run": {
      const bin = resolveBinary(args.binary, args.envVar); if (!bin) throw new Error(`${args.binary} CLI not found.`);
      const spec = commandSpec(bin, args.args || []); const child = spawn(spec.file, spec.args, { cwd: args.workingDir || undefined, env: childEnv(), windowsHide: true, stdio: [args.stdinText != null ? "pipe" : "ignore", "pipe", "pipe"] });
      children.set(args.replyId, child); let stderr = "";
      child.stdout.on("data", (chunk) => emit("agent:chunk", [args.replyId, chunk.toString()]));
      child.stderr.on("data", (chunk) => { const text = chunk.toString(); stderr += text; emit("agent:activity", [args.replyId, text]); });
      child.on("error", (error) => { children.delete(args.replyId); emit("agent:done", [args.replyId, -1, error.message]); });
      child.on("close", (code) => { children.delete(args.replyId); emit("agent:done", [args.replyId, code ?? -1, stderr]); });
      if (args.stdinText != null) child.stdin.end(args.stdinText); return null;
    }
    case "agent_terminate": { const child = children.get(args.replyId); if (child) { child.kill(); children.delete(args.replyId); } return null; }
    case "cdp_page_ws_url": {
      const response = await fetch(`${String(args.httpBase).replace(/\/$/, "")}/json/list`); if (!response.ok) throw new Error(`CDP target request failed (${response.status}).`);
      const targets = await response.json(); const target = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl) || targets.find((t) => t.webSocketDebuggerUrl);
      if (!target?.webSocketDebuggerUrl) throw new Error("No page targets found. Open a tab in NextBrowser first."); return target.webSocketDebuggerUrl;
    }
    case "remote_signal_open": {
      const id = randomUUID();
      const url = String(args.url || "");
      if (!/^wss?:\/\//.test(url)) throw new Error("Remote signaling URL must be ws or wss.");
      await new Promise((resolve, reject) => {
        const socket = new WebSocket(url);
        let opened = false;
        socket.addEventListener("open", () => {
          opened = true;
          remoteSignalSockets.set(id, socket);
          emit("remote_signal_event", { id, type: "open" });
          resolve();
        }, { once: true });
        socket.addEventListener("message", (event) => emit("remote_signal_event", { id, type: "message", data: String(event.data || "") }));
        socket.addEventListener("close", (event) => {
          remoteSignalSockets.delete(id);
          emit("remote_signal_event", { id, type: "close", code: event.code, reason: event.reason });
        });
        socket.addEventListener("error", () => {
          emit("remote_signal_event", { id, type: "error", message: "Remote signaling failed." });
          if (!opened) reject(new Error("Remote signaling failed."));
        }, { once: true });
      });
      return id;
    }
    case "remote_signal_send": {
      const socket = remoteSignalSockets.get(String(args.id || ""));
      if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("Remote signaling socket is not open.");
      socket.send(String(args.data || ""));
      return null;
    }
    case "remote_signal_close": {
      const id = String(args.id || "");
      const socket = remoteSignalSockets.get(id);
      if (socket) socket.close();
      remoteSignalSockets.delete(id);
      return null;
    }
    default: throw new Error(`Unknown Electron IPC command: ${command}`);
  }
}

function appIconPath() {
  return path.join(__dirname, "..", "build", "icon.png");
}
function loadAppIcon() {
  const iconFile = appIconPath();
  if (!fsSync.existsSync(iconFile)) return null;
  const image = nativeImage.createFromPath(iconFile);
  return image.isEmpty() ? null : image;
}
function applyAppIcon() {
  const image = loadAppIcon();
  if (!image) return null;
  if (process.platform === "darwin" && app.dock) app.dock.setIcon(image);
  return image;
}

function createWindow() {
  const icon = loadAppIcon();
  const window = new BrowserWindow({
    title: "NextBrowser", width: 1180, height: 760, minWidth: 960, minHeight: 640,
    backgroundColor: "#15141c", show: false,
    ...(icon ? { icon } : {}),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true },
  });
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  window.webContents.on("did-attach-webview", (_event, webContents) => {
    webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  });
  if (process.env.VITE_DEV_SERVER_URL) window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

app.whenReady().then(() => {
  return migrateLegacyData();
}).then(() => {
  applyAppIcon();
  ipcMain.handle("nextbrowser:invoke", (_event, command, args) => invokeCommand(command, args));
  createWindow();
  startAutoUpdater();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => {
  if (appUpdateTimer) clearInterval(appUpdateTimer);
  for (const socket of remoteSignalSockets.values()) socket.close();
  remoteSignalSockets.clear();
  for (const child of children.values()) child.kill();
});
