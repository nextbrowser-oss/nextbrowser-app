const { app, BrowserWindow, ipcMain, shell, nativeImage, nativeTheme, dialog, Menu, clipboard, safeStorage } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const http = require("node:http");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { agentWorkspaceDir } = require("./agent-workspace.cjs");
const { resolveScopedProfile } = require("./agent-control-scope.cjs");
const {
  executableNames,
  expand,
  findBinaryUnderRoots,
  launchable,
  resolveBinary,
  searchDirs,
} = require("./binary-resolver.cjs");
const { applyLegacyRuntimeMigration, applyRuntimeRootMigration, clearRuntimeCredential, runtimeAPIBaseURL } = require("./runtime-config.cjs");
const { fetchGitHubStars, readLocalGitHubStars, writeLocalGitHubStars } = require("./github-stars.cjs");
const { ensureWorkspaceInstructions } = require("./workspace-instructions.cjs");
const pty = require("node-pty");
const {
  cancelAllCommands,
  cancelCommand,
  runCommand,
} = require("./command-runner.cjs");
const { terminateProcessTree } = require("./process-tree.cjs");
const {
  createPersonalProxy,
  deletePersonalProxy,
  deleteProject,
  deleteWorkspace,
  listPersonalProxies,
  listProjects,
  listWorkspaces,
  putProject,
  putWorkspace,
  resolvePersonalProxy,
} = require("./project-sync.cjs");
const { defaultSSHConfigPath, discoverSSHHosts, isAllowedExplicitConfigPath } = require("./ssh-config.cjs");
const { createLocalArtifactStore } = require("./local-artifacts.cjs");
const { buildArtifactDataContract, saveAutomationArtifact } = require("./automation-artifact.cjs");
const { AGENT_ARTIFACT_BODY_LIMIT, saveAgentArtifact } = require("./agent-artifact.cjs");
const {
  acceptAutomationShare,
  createAutomationShare,
  declineAutomationShare,
  createAutomationRun,
  deleteAutomationRecording,
  deleteAutomationWorkflow,
  listAutomationRecordings,
  listAutomationRuns,
  listAutomationShares,
  listAutomationWorkflows,
  putAutomationRecording,
  putAutomationWorkflow,
  revokeAutomationShare,
  seedAutomationExamples,
  updateAutomationRun,
  updateAutomationRunStep,
} = require("./automation-sync.cjs");
const { cancelAllAutomationRecipes, cancelAutomationRecipe, executeAutomationRecipe } = require("./automation-runner.cjs");
const { cancelAllAutomationElementPicks, cancelAutomationElementPick, pickAutomationElement } = require("./automation-element-picker.cjs");
const { activeAutomationRecordingHasDataAction, activeAutomationTraceFile, attachAutomationPageRecording, cancelAllAutomationPageRecordings, recordAutomationToolAction, startAutomationPageRecording, stopAutomationPageRecording } = require("./automation-page-recorder.cjs");
const { browserInstallArgs, requiresBrowserRuntime, resolveBrowserRuntime } = require("./browser-runtime.cjs");
const {
  assertRuntimeReleaseVersion,
  checkBrowserRuntimeUpdates,
  clawbrowserReleaseAsset,
  compareVersions,
  installedCamoufoxVersion,
  installedClawbrowserVersion,
  installRuntimeUpdateWithVerification,
  selectAvailableRuntimeUpdates,
} = require("./browser-runtime-updates.cjs");
const { createMultiloginCredentialStore, exchangeAutomationToken } = require("./multilogin-credential.cjs");
const { parseMultiloginProfiles, parseMultiloginCreatedProfile } = require("./multilogin-profiles.cjs");
const { runAgentProcess } = require("./agent-process.cjs");
const {
  DASBROWSER_DOWNLOADS,
  adaptDasbrowserArgs,
  dasbrowserAppCopyOptions,
  dasbrowserReleaseVersion,
  officialDasbrowserURLFromHTML,
  requestedBrowserRuntime,
  resolveDasbrowserRuntime,
} = require("./dasbrowser-runtime.cjs");

const children = new Map();
const terminals = new Map();

function killTerminalsForWebContents(webContentsId) {
  for (const [id, record] of terminals) {
    if (record.webContentsId !== webContentsId) continue;
    try { record.process.kill(); } catch { /* process may already have exited */ }
    agentControlScopes.delete(record.controlToken);
    agentControlArtifactScopes.delete(record.controlToken);
    if (record.profileScopeFile) void fs.unlink(record.profileScopeFile).catch(() => undefined);
    terminals.delete(id);
  }
}
const remoteSignalSockets = new Map();
const APP_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const BROWSER_RUNTIME_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const NEXTCTL_RELEASE_BASE = "https://github.com/nextbrowser-oss/nbc_releases/releases/latest/download";
// A workspace state file is read for display only, so it is truncated rather
// than streamed: a runaway file must not be pulled into the renderer whole.
const MAX_WORKSPACE_FILE_BYTES = 256 * 1024;
const DEFAULT_API_BASE_URL = "https://api.nextbrowser.com";
const DEFAULT_AUTH_BASE_URL = "https://app.nextbrowser.com";
const DEFAULT_AUTH0_ISSUER_BASE_URL = "https://dev-5v20zhlfh5c7o71v.us.auth0.com";
const DEFAULT_AUTH0_CLIENT_ID = "E9Net5ggtBdR18nKT08eAqaXeSpbhCKt";
const DEEP_LINK_PROTOCOL = "nextbrowser";
let appUpdateStatus = { status: "idle" };
let appUpdateTimer = null;
let nextctlInstallStatus = { status: "idle" };
let browserRuntimeInstallStatus = { status: "idle" };
let browserRuntimeUpdateStatus = { status: "idle", runtimes: [] };
let browserRuntimeUpdateCheckPromise = null;
let browserRuntimeUpdateTimer = null;
let browserRuntimeUpdateInstallStatus = { status: "idle", runtimes: [] };
let browserRuntimeUpdateInstallPromise = null;
let nextctlInstallPromise = null;
let browserInstallPromise = null;
let dasbrowserInstallPromise = null;
const browserRuntimeInstallAbortControllers = new Map();
let agentControlServer = null;
let agentControlURL = "";
const agentControlScopes = new Map();
const agentControlArtifactScopes = new Map();
const agentControlProfileOwners = new Map();
let multiloginCredentialStore = null;
let automationArtifactStore = null;
let multiloginAutomationToken = "";
let multiloginCredentialLoadError = "";
let multiloginCredentialLoadPromise = null;
const nextctlAutomationTraceSupport = new Map();

const CODEX_TERMINAL_PROFILE = "nextbrowser";
const CODEX_TERMINAL_PROFILE_CONTENT = `[plugins."browser@openai-bundled"]
enabled = false

[plugins."clawbrowser@clawctl-local"]
enabled = false

[plugins."clawbrowser@clawctl-local".mcp_servers.clawbrowser]
enabled = false
default_tools_approval_mode = "approve"

[plugins."clawbrowser@nbc-local"]
enabled = false
`;

function codexClawbrowserMCPArgs(nextctlBin, automationTraceFile = "") {
  const runtimeEnv = childEnv(automationTraceFile ? { NEXTBROWSER_AUTOMATION_TRACE_FILE: automationTraceFile } : {});
  const mcpEnvKeys = [
    "NEXTBROWSER_CONFIG_DIR",
    "CLAWBROWSER_CACHE_DIR",
    "CLAWBROWSER_DATA_DIR",
    "CLAWBROWSER_STATE_ROOT",
    "CLAWBROWSER_SESSION_ROOT",
    "NBC_PROFILE_ROOT",
    "CLAWBROWSER_API_BASE_URL",
    ...(automationTraceFile ? ["NEXTBROWSER_AUTOMATION_TRACE_FILE"] : []),
  ];
  const mcpEnv = `{${mcpEnvKeys.map((key) => `${key}=${JSON.stringify(runtimeEnv[key])}`).join(",")}}`;
  return [
    "--profile", CODEX_TERMINAL_PROFILE,
    "-c", 'plugins."clawbrowser@clawctl-local".enabled=false',
    "-c", 'plugins."clawbrowser@clawctl-local".mcp_servers.clawbrowser.enabled=false',
    "-c", 'plugins."clawbrowser@nbc-local".enabled=false',
    "-c", `mcp_servers.nextbrowser.command=${JSON.stringify(nextctlBin)}`,
    "-c", `mcp_servers.nextbrowser.args=${JSON.stringify(["mcp", ...(automationTraceFile ? ["--automation-trace-file", automationTraceFile] : [])])}`,
    "-c", `mcp_servers.nextbrowser.env=${mcpEnv}`,
    // Codex starts the MCP server itself. Forward the Recorder's ephemeral
    // trace path from the agent process; putting it only in the parent env is
    // not enough when an explicit MCP env allow-list is configured.
    "-c", `mcp_servers.nextbrowser.env_vars=${JSON.stringify(["MULTILOGIN_TOKEN", "NEXTBROWSER_AUTOMATION_TRACE_FILE", "NEXTBROWSER_CONTROL_URL", "NEXTBROWSER_CONTROL_TOKEN"])}`,
    "-c", "mcp_servers.nextbrowser.startup_timeout_sec=30",
    "-c", "mcp_servers.nextbrowser.default_tools_approval_mode=approve",
  ];
}

function codexClawbrowserArgs(nextctlBin, automationTraceFile = "") {
  return [
    ...codexClawbrowserMCPArgs(nextctlBin, automationTraceFile),
    "--ask-for-approval", "never",
    "--sandbox", "workspace-write",
    "-c", "sandbox_workspace_write.network_access=true",
  ];
}

async function ensureCodexTerminalProfile() {
  const codexDir = String(process.env.CODEX_HOME || path.join(home(), ".codex"));
  await fs.mkdir(codexDir, { recursive: true });
  await fs.writeFile(
    path.join(codexDir, `${CODEX_TERMINAL_PROFILE}.config.toml`),
    CODEX_TERMINAL_PROFILE_CONTENT,
    { encoding: "utf8", mode: 0o600 },
  );
}

function clawbrowserWritableDirs() {
  if (process.platform === "win32") {
    const localAppData = String(process.env.LOCALAPPDATA || path.join(home(), "AppData", "Local"));
    return [
      path.join(localAppData, "Clawbrowser"),
      path.join(localAppData, "Dasbrowser"),
    ];
  }
  return [
    nextbrowserRuntimeRoot(),
    // DasBrowser's Chromium process keeps its runtime state here. Grant only
    // this product directory, never the surrounding Application Support tree.
    path.join(home(), "Library", "Application Support", "Dasbrowser"),
    path.join(home(), ".cache", "clawbrowser"),
    path.join(home(), ".config", "clawbrowser"),
    path.join(home(), ".local", "share", "clawbrowser"),
    path.join(home(), ".local", "state", "clawbrowser"),
  ];
}

const TERMINAL_AGENTS = {
  claude: { binary: "claude", envVar: "CLAUDE_BIN" },
  // Terminal chat runs inside NextBrowser's dedicated workspace. Let Codex use
  // browser MCP tools without prompting on every call, while retaining a
  // workspace-write filesystem sandbox.
  codex: {
    binary: "codex",
    envVar: "CODEX_BIN",
  },
  hermes: { binary: "hermes", envVar: "HERMES_BIN" },
  kilo: { binary: "kilo", envVar: "KILO_BIN" },
  openclaw: { binary: "openclaw", envVar: "OPENCLAW_BIN" },
  cline: { binary: "cline", envVar: "CLINE_BIN" },
  pi: { binary: "pi", envVar: "PI_BIN" },
  gemini: { binary: "gemini", envVar: "GEMINI_BIN" },
  qwen: { binary: "qwen", envVar: "QWEN_BIN" },
  opencode: { binary: "opencode", envVar: "OPENCODE_BIN" },
  cursor: { binary: "cursor-agent", envVar: "CURSOR_AGENT_BIN" },
  crush: { binary: "crush", envVar: "CRUSH_BIN" },
  goose: { binary: "goose", envVar: "GOOSE_BIN" },
  aider: { binary: "aider", envVar: "AIDER_BIN" },
  amp: { binary: "amp", envVar: "AMP_BIN" },
  llm: { binary: "llm", envVar: "LLM_BIN" },
  aichat: { binary: "aichat", envVar: "AICHAT_BIN" },
  sgpt: { binary: "sgpt", envVar: "SGPT_BIN" },
  mods: { binary: "mods", envVar: "MODS_BIN" },
  gptme: { binary: "gptme", envVar: "GPTME_BIN" },
  cody: { binary: "cody", envVar: "CODY_BIN" },
  plandex: { binary: "plandex", envVar: "PLANDEX_BIN" },
  codebuff: { binary: "codebuff", envVar: "CODEBUFF_BIN" },
  interpreter: { binary: "interpreter", envVar: "INTERPRETER_BIN" },
  amazonq: { binary: "q", envVar: "Q_BIN" },
  continue: { binary: "cn", envVar: "CN_BIN" },
  droid: { binary: "droid", envVar: "DROID_BIN" },
};

function home() { return os.homedir(); }
function legacyAppRuntimeRoot() { return path.join(app.getPath("userData"), "runtime"); }
function nextbrowserRuntimeRoot() {
  return process.platform === "darwin"
    ? path.join(home(), ".nextbrowser", "runtime")
    : legacyAppRuntimeRoot();
}
function childEnv(extra = {}) {
  const runtimeRoot = nextbrowserRuntimeRoot();
  const commandPaths = [managedNextctlRoot(), ...searchDirs()];
  const clawbrowserBin = resolveBrowserRuntime({
    platform: process.platform,
    homeDir: home(),
    env: process.env,
    runtimeRoot,
  });
  const dasbrowserBin = resolveDasbrowserRuntime({
    platform: process.platform,
    homeDir: home(),
    env: process.env,
    runtimeRoot,
  });
  return {
    ...process.env,
    // The managed CLI is intentionally outside the user's global PATH. Agent
    // terminals still need to resolve `nextctl` exactly like app-owned calls.
    PATH: [...new Set(commandPaths)].join(path.delimiter),
    NEXTBROWSER_CONFIG_DIR: path.join(runtimeRoot, "config"),
    CLAWBROWSER_CACHE_DIR: path.join(runtimeRoot, "cache"),
    CLAWBROWSER_DATA_DIR: path.join(runtimeRoot, "data"),
    CLAWBROWSER_STATE_ROOT: path.join(runtimeRoot, "state"),
    CLAWBROWSER_SESSION_ROOT: path.join(runtimeRoot, "sessions"),
    NBC_PROFILE_ROOT: path.join(runtimeRoot, "profiles"),
    CLAWBROWSER_API_BASE_URL: runtimeAPIBaseURL(process.env),
    ...(clawbrowserBin ? { CLAWBROWSER_BIN: clawbrowserBin } : {}),
    ...(dasbrowserBin ? { DASBROWSER_BIN: dasbrowserBin } : {}),
    ...(multiloginAutomationToken ? { MULTILOGIN_TOKEN: multiloginAutomationToken } : {}),
    ...extra,
  };
}
function terminalEnv(extra = {}) {
  return Object.fromEntries(
    Object.entries(childEnv({ TERM: "xterm-256color", COLORTERM: "truecolor", ...extra }))
      .filter(([, value]) => typeof value === "string"),
  );
}
function commandSpec(binary, args) {
  const ext = path.extname(binary).toLowerCase();
  if (process.platform === "win32" && [".cmd", ".bat"].includes(ext)) return { file: "cmd.exe", args: ["/D", "/S", "/C", binary, ...args] };
  if (process.platform === "win32" && ext === ".ps1") return { file: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", binary, ...args] };
  return { file: binary, args };
}
async function run(binary, args, extraEnv = {}, options = {}) {
  const spec = commandSpec(binary, args);
  return runCommand(spec.file, spec.args, {
    env: childEnv(extraEnv),
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    requestId: options.requestId,
    timeoutMs: options.timeoutMs,
  });
}
async function nextctlHasSkill(binary) {
  const r = await run(binary, ["--help"]); return `${r.stdout}\n${r.stderr}`.includes("\n  skill");
}
async function nextctlHasAutomationTrace(binary) {
  if (!nextctlAutomationTraceSupport.has(binary)) {
    // The internal Recorder flag is intentionally hidden from --help. Probe
    // parsing with a relative path: supporting builds reject it as non-absolute,
    // while older builds reject the flag itself before starting the MCP server.
    // A fresh binary without this app's isolated credential can reject auth
    // after parsing; that also proves Cobra accepted the flag.
    nextctlAutomationTraceSupport.set(binary, run(binary, ["mcp", "--automation-trace-file", "nextbrowser-capability-probe"], {}, { timeoutMs: 5_000 })
      .then((result) => /automation trace file must be an absolute path|API_KEY_REQUIRED|Missing Clawbrowser API key/i.test(`${result.stdout}\n${result.stderr}`))
      .catch(() => false));
  }
  return nextctlAutomationTraceSupport.get(binary);
}
function setNextctlInstallStatus(status, patch = {}) {
  nextctlInstallStatus = { status, ...patch, updatedAt: Date.now() };
  emit("nextctl:install", nextctlInstallStatus);
}
function setBrowserRuntimeInstallStatus(runtime, status, patch = {}) {
  browserRuntimeInstallStatus = { runtime, status, ...patch, updatedAt: Date.now() };
  emit("browser-runtime:install", browserRuntimeInstallStatus);
}
function runtimeInstallRequestId(value) {
  const requestId = String(value || "").trim();
  return requestId ? requestId.slice(0, 128) : "";
}
function beginBrowserRuntimeInstall(requestId) {
  const id = runtimeInstallRequestId(requestId);
  if (!id) return { id: "", controller: undefined };
  const controller = new AbortController();
  browserRuntimeInstallAbortControllers.set(id, controller);
  return { id, controller };
}
function finishBrowserRuntimeInstall(requestId, controller) {
  const id = runtimeInstallRequestId(requestId);
  if (id && browserRuntimeInstallAbortControllers.get(id) === controller) browserRuntimeInstallAbortControllers.delete(id);
}
function cancelBrowserRuntimeInstall(requestId) {
  const controller = browserRuntimeInstallAbortControllers.get(runtimeInstallRequestId(requestId));
  if (!controller) return false;
  controller.abort();
  return true;
}
function setBrowserRuntimeUpdateStatus(status) {
  browserRuntimeUpdateStatus = status;
  emit("browser-runtime:update", browserRuntimeUpdateStatus);
}
function setBrowserRuntimeUpdateInstallStatus(status, patch = {}) {
  browserRuntimeUpdateInstallStatus = {
    ...browserRuntimeUpdateInstallStatus,
    status,
    ...patch,
    updatedAt: Date.now(),
  };
  emit("browser-runtime:update-install", browserRuntimeUpdateInstallStatus);
}
function legacyManagedNextctlRoot() { return path.join(app.getPath("userData"), "managed-nextctl"); }
function managedNextctlRoot() {
  return process.platform === "darwin"
    ? path.join(home(), ".nextbrowser", "managed-nextctl")
    : legacyManagedNextctlRoot();
}
function managedNextctlBin() {
  return process.platform === "win32"
    ? path.join(managedNextctlRoot(), "nextctl.exe")
    : path.join(managedNextctlRoot(), "nextctl");
}
function nextctlPlatformArchive() {
  const arch = os.arch();
  if (process.platform === "darwin") {
    if (arch === "arm64") return { name: "nbc-macos-arm64.tar.gz", kind: "tar" };
    if (arch === "x64") return { name: "nbc-macos-amd64.tar.gz", kind: "tar" };
  }
  if (process.platform === "linux") {
    if (arch === "arm64") return { name: "nbc-linux-arm64.tar.gz", kind: "tar" };
    if (arch === "x64") return { name: "nbc-linux-amd64.tar.gz", kind: "tar" };
  }
  if (process.platform === "win32" && arch === "x64") return { name: "nbc-win-amd64.zip", kind: "zip" };
  throw new Error(`Unsupported nextctl platform: ${process.platform}/${arch}`);
}
function findNextctlInTree(root) {
  return findBinaryUnderRoots("nextctl", [root]) || findBinaryUnderRoots("nbc", [root]);
}
async function downloadFile(url, target, options = {}) {
  const response = await fetch(url, { signal: options.signal });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(target, buffer);
}
async function extractArchive(archive, kind, targetDir) {
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetDir, { recursive: true });
  if (kind === "tar") {
    const result = await run("tar", ["-xzf", archive, "-C", targetDir]);
    if (result.code !== 0) throw new Error((result.stderr || result.stdout || "tar extraction failed").trim());
    return;
  }
  if (process.platform === "win32") {
    const result = await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `Expand-Archive -Force ${JSON.stringify(archive)} ${JSON.stringify(targetDir)}`]);
    if (result.code !== 0) throw new Error((result.stderr || result.stdout || "zip extraction failed").trim());
    return;
  }
  const result = await run("unzip", ["-q", archive, "-d", targetDir]);
  if (result.code !== 0) throw new Error((result.stderr || result.stdout || "zip extraction failed").trim());
}
async function installManagedNextctl() {
  if (nextctlInstallPromise) return nextctlInstallPromise;
  nextctlInstallPromise = (async () => {
    setNextctlInstallStatus("downloading");
    const archive = nextctlPlatformArchive();
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nextbrowser-nextctl-"));
    const archivePath = path.join(tempDir, archive.name);
    try {
      await downloadFile(`${NEXTCTL_RELEASE_BASE}/${archive.name}`, archivePath);
      setNextctlInstallStatus("installing");
      const extractDir = path.join(tempDir, "extract");
      await extractArchive(archivePath, archive.kind, extractDir);
      const extracted = findNextctlInTree(extractDir);
      if (!extracted) throw new Error("Downloaded nextctl archive did not contain a nextctl binary.");
      await fs.mkdir(managedNextctlRoot(), { recursive: true });
      await fs.copyFile(extracted, managedNextctlBin());
      if (process.platform !== "win32") await fs.chmod(managedNextctlBin(), 0o755);
      const version = await run(managedNextctlBin(), ["version"]);
      if (version.code !== 0) throw new Error((version.stderr || version.stdout || "nextctl version check failed").trim());
      setNextctlInstallStatus("ready", { path: managedNextctlBin(), version: version.stdout.trim() });
      return managedNextctlBin();
    } catch (error) {
      setNextctlInstallStatus("failed", { message: error?.message || String(error) });
      throw error;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      nextctlInstallPromise = null;
    }
  })();
  return nextctlInstallPromise;
}
async function resolveNextctl() {
  if (process.env.NEXTCTL_BIN && launchable(expand(process.env.NEXTCTL_BIN))) return expand(process.env.NEXTCTL_BIN);
  const candidates = [];
  const dev = path.join(home(), "projects/ClawBrowser/nextctl/bin/nextctl");
  const nbcDev = path.join(home(), "projects/ClawBrowser/nextctl/bin/nbc");
  if (!app.isPackaged) {
    if (launchable(dev)) candidates.push(dev);
    if (launchable(nbcDev)) candidates.push(nbcDev);
  }
  const managed = managedNextctlBin(); if (launchable(managed)) candidates.push(managed);
  if (launchable(dev)) candidates.push(dev);
  for (const dir of searchDirs()) for (const name of executableNames("nextctl")) { const f = path.join(dir, name); if (launchable(f)) candidates.push(f); }
  if (launchable(nbcDev)) candidates.push(nbcDev);
  for (const dir of searchDirs()) for (const name of executableNames("nbc")) { const f = path.join(dir, name); if (launchable(f)) candidates.push(f); }
  for (const candidate of [...new Set(candidates)]) if (await nextctlHasSkill(candidate)) return candidate;
  return candidates[0] || null;
}
async function resolveOrInstallNextctl() {
  const existing = await resolveNextctl();
  if (existing) {
    setNextctlInstallStatus("ready", { path: existing });
    return existing;
  }
  return installManagedNextctl();
}

async function executeNextctl(commandArgs, options = {}) {
  const bin = await resolveOrInstallNextctl();
  if (!bin) throw new Error("nextctl not found. Install Clawbrowser CLI or set NEXTCTL_BIN.");
  let adaptedArgs = commandArgs;
  const browserRuntime = requestedBrowserRuntime(adaptedArgs);
  if (browserRuntime === "multilogin") await initializeMultiloginCredential();
  if (browserRuntime === "dasbrowser") {
    const executable = await ensureDasbrowserRuntime({ requestId: options.requestId });
    adaptedArgs = adaptDasbrowserArgs(adaptedArgs, executable);
  } else if (browserRuntime === "clawbrowser" && requiresBrowserRuntime(adaptedArgs)) {
    await ensureClawbrowserRuntime(bin, { requestId: options.requestId });
  } else if (browserRuntime === "camoufox" && requiresBrowserRuntime(adaptedArgs)) {
    setBrowserRuntimeInstallStatus("camoufox", "installing", { message: "Preparing the Camoufox browser runtime…", requestId: options.requestId });
    try {
      const result = await run(bin, adaptedArgs, options.extraEnv || {}, options);
      if (result.code === 0) {
        setBrowserRuntimeInstallStatus("camoufox", "ready");
      } else {
        setBrowserRuntimeInstallStatus("camoufox", "failed", { message: "We couldn't prepare Camoufox. Please retry." });
      }
      return result;
    } catch (error) {
      setBrowserRuntimeInstallStatus("camoufox", "failed", { message: String(error?.message || error) });
      throw error;
    }
  }
  return run(bin, adaptedArgs, options.extraEnv || {}, options);
}

function sendControlResponse(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function ensureAgentControlServer() {
  if (agentControlServer) return agentControlURL;
  agentControlServer = http.createServer((request, response) => {
    void (async () => {
      const action = request.url === "/profile/start" ? "start" : request.url === "/profile/stop" ? "stop" : "";
      const artifactSave = request.url === "/artifact/save";
      if (request.method !== "POST" || (!action && !artifactSave)) {
        sendControlResponse(response, 404, { ok: false, error: "not_found" });
        return;
      }
      const token = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const profileScope = agentControlScopes.get(token);
      const artifactScope = agentControlArtifactScopes.get(token);
      if ((action && !profileScope) || (artifactSave && !artifactScope)) {
        sendControlResponse(response, 401, { ok: false, error: "unauthorized" });
        return;
      }
      let raw = "";
      for await (const chunk of request) {
        raw += chunk;
        if (raw.length > (artifactSave ? AGENT_ARTIFACT_BODY_LIMIT : 8192)) throw new Error("request_too_large");
      }
      const payload = JSON.parse(raw || "{}");
      if (artifactSave) {
        if (payload.content == null || (typeof payload.content === "string" && !payload.content.trim())) {
          sendControlResponse(response, 400, {
            ok: false,
            error: "artifact_content_missing",
            message: "No artifact content was received. If curl uses --data-binary @-, attach a heredoc or stdin body to the same command.",
          });
          return;
        }
        const recorderHasData = await activeAutomationRecordingHasDataAction();
        let result = artifactScope.pendingArtifact;
        if (!result) {
          result = await saveAgentArtifact({
            workspaceId: artifactScope.workspaceId,
            payload,
            store: localAutomationArtifacts(),
          });
        }
        if (!recorderHasData) {
          artifactScope.pendingArtifact = result;
          sendControlResponse(response, 409, {
            ok: false,
            error: "artifact_saved_recording_incomplete",
            artifactSaved: true,
            artifact: result.artifact,
            message: "The local artifact is saved, but Recorder has no deterministic data step. Call extract, paginate_extract, tabs_extract, or a read-only evaluate for the exact final dataset, then repeat this same artifact request once; it will confirm without creating a duplicate.",
          });
          return;
        }
        artifactScope.pendingArtifact = undefined;
        recordAutomationToolAction("save_artifact", {
          source: "last_result",
          format: String(payload.format || result.artifact?.extension || "json").replace(/^\./, ""),
          name: String(result.artifact?.name || payload.name || "workflow-result.json"),
          contract: buildArtifactDataContract(payload.content, payload.format || result.artifact?.extension || "json"),
        });
        sendControlResponse(response, 200, { ok: true, artifact: result.artifact });
        return;
      }
      const profile = resolveScopedProfile(profileScope, payload.profile);
      const profileAccess = profileScope.get(profile);
      if (!profileAccess) {
        sendControlResponse(response, 403, { ok: false, error: "profile_outside_workspace" });
        return;
      }
      const ownerId = agentControlProfileOwners.get(profile) || profileAccess.ownerConversationId;
      if (ownerId && ownerId !== profileAccess.conversationId) {
        sendControlResponse(response, 409, { ok: false, error: "profile_in_use_by_another_chat" });
        return;
      }
      const result = await executeNextctl([
        action, "--profile", profile, "--runtime", profileAccess.runtime, "--format", "json",
      ], { timeoutMs: 240_000 });
      if (result.code === 0) {
        if (action === "start") agentControlProfileOwners.set(profile, profileAccess.conversationId);
        else agentControlProfileOwners.delete(profile);
        emit(action === "start" ? "profile:host-started" : "profile:host-stopped", [profile, profileAccess.conversationId]);
      }
      let output;
      try { output = JSON.parse(result.stdout); } catch { output = undefined; }
      sendControlResponse(response, result.code === 0 ? 200 : 500, {
        ok: result.code === 0,
        code: result.code,
        ...(output ? { data: output.data } : { stdout: result.stdout }),
        stderr: result.stderr,
      });
    })().catch((error) => sendControlResponse(response, 500, { ok: false, error: error?.message || "start_failed" }));
  });
  await new Promise((resolve, reject) => {
    agentControlServer.once("error", reject);
    agentControlServer.listen(0, "127.0.0.1", resolve);
  });
  const address = agentControlServer.address();
  agentControlURL = `http://127.0.0.1:${address.port}`;
  return agentControlURL;
}
async function ensureClawbrowserRuntime(nextctlBin, options = {}) {
  const runtimeOptions = {
    platform: process.platform,
    homeDir: home(),
    env: process.env,
    runtimeRoot: nextbrowserRuntimeRoot(),
  };
  const existing = resolveBrowserRuntime(runtimeOptions);
  if (existing) return existing;
  if (browserInstallPromise) return browserInstallPromise;

  browserInstallPromise = (async () => {
    setBrowserRuntimeInstallStatus("clawbrowser", "downloading", { requestId: options.requestId });
    const runtimeRoot = nextbrowserRuntimeRoot();
    await Promise.all([
      "data", "cache", "installer-bin", "agent-plugins",
    ].map((dir) => fs.mkdir(path.join(runtimeRoot, dir), { recursive: true })));
    const result = await run(nextctlBin, browserInstallArgs(runtimeRoot), {}, {
      requestId: options.requestId,
      timeoutMs: 60 * 60 * 1000,
    });
    const installed = resolveBrowserRuntime(runtimeOptions);
    if (!installed) {
      const detail = (result.stderr || result.stdout || "Clawbrowser installation failed").trim();
      throw new Error(detail);
    }
    setBrowserRuntimeInstallStatus("clawbrowser", "ready");
    return installed;
  })().catch((error) => {
    setBrowserRuntimeInstallStatus("clawbrowser", "failed");
    throw error;
  }).finally(() => {
    browserInstallPromise = null;
  });
  return browserInstallPromise;
}
function dasbrowserRuntimeOptions() {
  return {
    platform: process.platform,
    homeDir: home(),
    env: process.env,
    runtimeRoot: nextbrowserRuntimeRoot(),
  };
}
async function officialDasbrowserDownloadUrl(options = {}) {
  const fallback = DASBROWSER_DOWNLOADS[process.platform];
  if (!fallback) throw new Error(`DasBrowser is not available for ${process.platform}.`);
  try {
    const response = await fetch("https://www.dasbrowser.com/download", { signal: options.signal });
    if (!response.ok) return fallback;
    const html = await response.text();
    return officialDasbrowserURLFromHTML(html, process.platform, fallback);
  } catch {
    return fallback;
  }
}
async function ensureDasbrowserRuntime({ force = false, reportStatus = true, requestId } = {}) {
  const options = dasbrowserRuntimeOptions();
  const existing = resolveDasbrowserRuntime(options);
  if (existing && !force) return existing;
  if (dasbrowserInstallPromise) return dasbrowserInstallPromise;

  dasbrowserInstallPromise = (async () => {
    const install = beginBrowserRuntimeInstall(requestId);
    if (process.platform === "darwin" && process.arch !== "arm64") {
      throw new Error("The official DasBrowser download currently supports Apple Silicon Macs only.");
    }
    if (process.platform !== "darwin" && process.platform !== "win32") {
      throw new Error("DasBrowser is currently available only for macOS and Windows.");
    }
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nextbrowser-dasbrowser-"));
    try {
      const url = await officialDasbrowserDownloadUrl({ signal: install.controller?.signal });
      if (reportStatus) setBrowserRuntimeInstallStatus("dasbrowser", "downloading", { requestId: install.id });
      if (process.platform === "darwin") {
        const image = path.join(tempDir, "dasbrowser.dmg");
        const mount = path.join(tempDir, "mount");
        await fs.mkdir(mount, { recursive: true });
        await downloadFile(url, image, { signal: install.controller?.signal });
        if (reportStatus) setBrowserRuntimeInstallStatus("dasbrowser", "installing", { requestId: install.id });
        const attached = await run("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, image], {}, { requestId: install.id, timeoutMs: 120_000 });
        if (attached.code !== 0) throw new Error((attached.stderr || attached.stdout || "Could not mount DasBrowser installer.").trim());
        try {
          const source = path.join(mount, "Dasbrowser.app");
          const target = path.join(nextbrowserRuntimeRoot(), "data", "Dasbrowser.app");
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.rm(target, { recursive: true, force: true });
          await fs.cp(source, target, dasbrowserAppCopyOptions());
          const signature = await run("codesign", ["--verify", "--deep", "--strict", target], {}, { requestId: install.id, timeoutMs: 120_000 });
          if (signature.code !== 0) {
            await fs.rm(target, { recursive: true, force: true });
            throw new Error("The downloaded DasBrowser app failed macOS signature verification.");
          }
        } finally {
          await run("hdiutil", ["detach", mount, "-force"], {}, { requestId: install.id, timeoutMs: 30_000 }).catch(() => undefined);
        }
      } else {
        const installer = path.join(tempDir, "DasbrowserSetup.exe");
        await downloadFile(url, installer, { signal: install.controller?.signal });
        if (reportStatus) setBrowserRuntimeInstallStatus("dasbrowser", "installing", { requestId: install.id });
        const installed = await run(installer, ["--silent", "--install"], {}, { requestId: install.id, timeoutMs: 10 * 60 * 1000 });
        if (installed.code !== 0) throw new Error((installed.stderr || installed.stdout || "DasBrowser installation failed.").trim());
        for (let attempt = 0; attempt < 30 && !resolveDasbrowserRuntime(options); attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
      }
      const executable = resolveDasbrowserRuntime(options);
      if (!executable) throw new Error("DasBrowser installed, but its browser executable could not be found.");
      const releaseVersion = dasbrowserReleaseVersion(url);
      if (releaseVersion) {
        await fs.writeFile(
          path.join(nextbrowserRuntimeRoot(), "data", ".dasbrowser-browser-release.json"),
          JSON.stringify({ version: releaseVersion, download_url: url, updated_at: new Date().toISOString() }, null, 2),
          "utf8",
        );
      }
      if (reportStatus) setBrowserRuntimeInstallStatus("dasbrowser", "ready");
      return executable;
    } catch (error) {
      if (install.controller?.signal.aborted) throw new Error("Command cancelled.");
      throw error;
    } finally {
      finishBrowserRuntimeInstall(install.id, install.controller);
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  })().catch((error) => {
    if (reportStatus) setBrowserRuntimeInstallStatus("dasbrowser", "failed");
    throw error;
  }).finally(() => {
    dasbrowserInstallPromise = null;
  });
  return dasbrowserInstallPromise;
}
function dataDir() { return path.join(app.getPath("userData")); }
function githubStarsCachePath() { return path.join(dataDir(), "github-stars.json"); }
function localAutomationArtifacts() {
  if (!automationArtifactStore) {
    automationArtifactStore = createLocalArtifactStore({ rootDir: path.join(dataDir(), "automation-artifacts") });
  }
  return automationArtifactStore;
}
function multiloginCredentialPath() { return path.join(dataDir(), "credentials", "multilogin.json"); }
function initializeMultiloginCredential() {
  if (multiloginCredentialLoadPromise) return multiloginCredentialLoadPromise;
  multiloginCredentialStore = createMultiloginCredentialStore({
    safeStorage,
    filePath: multiloginCredentialPath(),
  });
  multiloginCredentialLoadPromise = (async () => {
    try {
      multiloginAutomationToken = await multiloginCredentialStore.load();
      multiloginCredentialLoadError = "";
    } catch (error) {
      multiloginAutomationToken = "";
      multiloginCredentialLoadError = error?.message || String(error);
    }
  })();
  return multiloginCredentialLoadPromise;
}
function multiloginCommandError(result) {
  try {
    const payload = JSON.parse(result.stdout || "{}");
    const message = String(payload?.error?.message || "").trim();
    if (message) return new Error(message);
  } catch {
    // Fall through to the bounded command output below.
  }
  const output = String(result.stderr || result.stdout || "").trim().slice(0, 800);
  return new Error(output || "Multilogin connection check failed.");
}
async function listMultiloginProfiles(token, args) {
  const bin = await resolveOrInstallNextctl();
  if (!bin) throw new Error("nextctl is required to connect Multilogin.");
  const result = await run(
    bin,
    ["--runtime", "multilogin", ...args, "--json"],
    { MULTILOGIN_TOKEN: token },
    { timeoutMs: 60_000 },
  );
  if (result.code !== 0) throw multiloginCommandError(result);
  return parseMultiloginProfiles(result.stdout);
}
async function loadMultiloginProfiles(token) {
  const [browserResult, mobileResult] = await Promise.allSettled([
    listMultiloginProfiles(token, ["profiles", "list"]),
    listMultiloginProfiles(token, ["mobile", "profiles", "list"]),
  ]);
  if (browserResult.status === "rejected" && mobileResult.status === "rejected") {
    throw browserResult.reason;
  }
  return {
    browserProfiles: browserResult.status === "fulfilled" ? browserResult.value : [],
    cloudPhones: mobileResult.status === "fulfilled" ? mobileResult.value : [],
    browserProfilesError: browserResult.status === "rejected"
      ? browserResult.reason?.message || String(browserResult.reason)
      : undefined,
    cloudPhonesError: mobileResult.status === "rejected"
      ? mobileResult.reason?.message || String(mobileResult.reason)
      : undefined,
  };
}
async function multiloginLocalStatus() {
  return {
    connected: Boolean(multiloginAutomationToken),
    valid: false,
    secureStorageAvailable: Boolean(await multiloginCredentialStore?.available()),
    error: multiloginCredentialLoadError || undefined,
  };
}
async function multiloginStatus() {
  await initializeMultiloginCredential();
  const status = await multiloginLocalStatus();
  if (!status.connected || status.error) return status;
  try {
    const profiles = await loadMultiloginProfiles(multiloginAutomationToken);
    return { ...status, ...profiles, valid: true, error: undefined };
  } catch (error) {
    return { ...status, error: error?.message || String(error) };
  }
}
async function connectMultilogin(bearerToken) {
  await initializeMultiloginCredential();
  if (!await multiloginCredentialStore?.available()) {
    throw new Error("Secure credential storage is unavailable on this device.");
  }
  const automationToken = await exchangeAutomationToken({ bearerToken });
  const profiles = await loadMultiloginProfiles(automationToken);
  await multiloginCredentialStore.save(automationToken);
  multiloginAutomationToken = automationToken;
  multiloginCredentialLoadError = "";
  return {
    connected: true,
    valid: true,
    secureStorageAvailable: true,
    ...profiles,
  };
}
const MULTILOGIN_OS_TYPES = ["windows", "macos", "linux"];

// Multilogin profiles live in the Multilogin workspace rather than the local
// profile store, so creation goes straight to `nbc --runtime multilogin`.
async function createMultiloginProfile(args = {}) {
  await initializeMultiloginCredential();
  if (!multiloginAutomationToken) throw new Error("Connect Multilogin before creating a profile.");
  const name = String(args.name || "").trim();
  if (!name) throw new Error("Profile name is required.");
  const country = String(args.country || "").trim().toUpperCase();
  const osType = String(args.osType || "").trim().toLowerCase();
  const bin = await resolveOrInstallNextctl();
  if (!bin) throw new Error("nextctl is required to create Multilogin profiles.");
  const result = await run(
    bin,
    [
      "--runtime", "multilogin",
      "profiles", "create", name,
      ...(/^[A-Z]{2}$/.test(country) ? ["--country", country] : []),
      ...(MULTILOGIN_OS_TYPES.includes(osType) ? ["--os-type", osType] : []),
      "--format", "json",
    ],
    { MULTILOGIN_TOKEN: multiloginAutomationToken },
    { requestId: args.requestId, timeoutMs: Number(args.timeoutMs) || 120_000 },
  );
  if (result.code !== 0) throw multiloginCommandError(result);
  return parseMultiloginCreatedProfile(result.stdout);
}

async function disconnectMultilogin() {
  await initializeMultiloginCredential();
  await multiloginCredentialStore?.clear();
  multiloginAutomationToken = "";
  multiloginCredentialLoadError = "";
  return await multiloginLocalStatus();
}
async function migrateLegacyData() {
  const legacy = path.join(app.getPath("appData"), "clawdesk-electron");
  const current = dataDir();
  if (legacy === current || !fsSync.existsSync(legacy) || fsSync.existsSync(current)) return;
  await fs.cp(legacy, current, { recursive: true, errorOnExist: false });
}
// Pre-isolation builds wrote config and profiles to nbc's shared default dirs.
// On the first isolated launch, seed the runtime root from them once so existing
// users keep their session (proxy stays on) and see all their profiles without
// signing in again. Best-effort and idempotent; see runtime-config.cjs.
async function migrateLegacyRuntimeConfig() {
  await applyRuntimeRootMigration({
    fromRoot: legacyAppRuntimeRoot(),
    toRoot: nextbrowserRuntimeRoot(),
  });
  await applyRuntimeRootMigration({
    fromRoot: legacyManagedNextctlRoot(),
    toRoot: managedNextctlRoot(),
  });
  await applyLegacyRuntimeMigration({ runtimeRoot: nextbrowserRuntimeRoot() });
}
function safeName(name) {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes("..")) throw new Error("Invalid app-data filename.");
  return name;
}
function emit(channel, payload) { for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload); }
function focusMainWindow() {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window) return null;
  if (process.platform === "darwin") app.focus({ steal: true });
  if (window.isMinimized()) window.restore();
  window.show();
  window.moveTop();
  window.focus();
  return window;
}
function handleDeepLink(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return false;
  let parsed;
  try { parsed = new URL(rawUrl); }
  catch { return false; }
  if (parsed.protocol !== `${DEEP_LINK_PROTOCOL}:`) return false;
  const payload = {
    url: rawUrl,
    host: parsed.host,
    pathname: parsed.pathname,
    pairingId: parsed.searchParams.get("pairing_id") || "",
    status: parsed.searchParams.get("status") || "",
  };
  focusMainWindow();
  emit("auth:deeplink", payload);
  return true;
}
function quotePosix(value) { return `'${String(value).replaceAll("'", "'\\''")}'`; }
function setAppUpdateStatus(status, patch = {}) {
  appUpdateStatus = { status, ...patch, updatedAt: Date.now() };
  emit("app:update", appUpdateStatus);
}
function appUpdatesSupported() {
  return app.isPackaged &&
    ["darwin", "win32"].includes(process.platform) &&
    !app.getVersion().includes("-demo.");
}
function configureAutoUpdater() {
  if (!appUpdatesSupported()) return;
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
  if (/app-update\.yml|No published versions on GitHub/i.test(message)) {
    setAppUpdateStatus("disabled", { message: "App updates unavailable in this build." });
  } else {
    setAppUpdateStatus("error", { message });
  }
}
function checkForAppUpdate() {
  if (!appUpdatesSupported()) {
    setAppUpdateStatus("disabled", { message: "App updates are unavailable in this build." });
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
  if (!appUpdatesSupported()) return;
  setTimeout(() => { void checkForAppUpdate(); }, 3000);
  if (appUpdateTimer) clearInterval(appUpdateTimer);
  appUpdateTimer = setInterval(() => { void checkForAppUpdate(); }, APP_UPDATE_CHECK_INTERVAL_MS);
}
async function installedDasbrowserVersion() {
  const executable = resolveDasbrowserRuntime(dasbrowserRuntimeOptions());
  if (!executable) return "";
  try {
    const metadata = JSON.parse(await fs.readFile(path.join(nextbrowserRuntimeRoot(), "data", ".dasbrowser-browser-release.json"), "utf8"));
    return String(metadata?.version || "").trim();
  } catch {
    // DasBrowser's internal Chromium version is not the public download
    // channel version, so it must not be compared with e.g. 144.32.
    const managed = path.join(nextbrowserRuntimeRoot(), "data", "Dasbrowser.app", "Contents", "MacOS", "Dasbrowser");
    return process.platform === "darwin" && path.resolve(executable) === path.resolve(managed)
      ? dasbrowserReleaseVersion(DASBROWSER_DOWNLOADS.darwin)
      : "";
  }
}
async function checkForBrowserRuntimeUpdates() {
  if (browserRuntimeUpdateCheckPromise) return browserRuntimeUpdateCheckPromise;
  setBrowserRuntimeUpdateStatus({
    ...browserRuntimeUpdateStatus,
    status: "checking",
  });
  browserRuntimeUpdateCheckPromise = checkBrowserRuntimeUpdates({
    fetchImpl: fetch,
    runtimeRoot: nextbrowserRuntimeRoot(),
    readDasbrowserVersion: installedDasbrowserVersion,
    isRuntimeInstalled: {
      clawbrowser: !!resolveBrowserRuntime({ platform: process.platform, homeDir: home(), env: process.env, runtimeRoot: nextbrowserRuntimeRoot() }),
      dasbrowser: !!resolveDasbrowserRuntime(dasbrowserRuntimeOptions()),
    },
  }).then((status) => {
    setBrowserRuntimeUpdateStatus(status);
    return status;
  }).catch((error) => {
    const status = {
      status: "error",
      checkedAt: Date.now(),
      message: error?.message || String(error),
      runtimes: browserRuntimeUpdateStatus.runtimes || [],
    };
    setBrowserRuntimeUpdateStatus(status);
    return status;
  }).finally(() => {
    browserRuntimeUpdateCheckPromise = null;
  });
  return browserRuntimeUpdateCheckPromise;
}
function camoufoxVenvPython() {
  const venv = path.join(nextbrowserRuntimeRoot(), "sessions", "_camoufox", "venv");
  return process.platform === "win32"
    ? path.join(venv, "Scripts", "python.exe")
    : path.join(venv, "bin", "python");
}
async function downloadFileStreaming(url, target) {
  const response = await fetch(url, {
    headers: { "User-Agent": "NextBrowser-runtime-updater" },
    signal: AbortSignal.timeout(60 * 60 * 1000),
  });
  if (!response.ok || !response.body) throw new Error(`ClawBrowser download failed (${response.status}).`);
  await pipeline(Readable.fromWeb(response.body), fsSync.createWriteStream(target, { mode: 0o600 }));
}
async function findClawbrowserReleaseAsset(root) {
  const expected = process.platform === "darwin" ? "Clawbrowser.app" : process.platform === "win32" ? "clawbrowser.exe" : "clawbrowser";
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.join(current, entry.name);
      if (entry.name.toLowerCase() === expected.toLowerCase() && (entry.isFile() || entry.isDirectory())) return candidate;
      if (entry.isDirectory() && !entry.isSymbolicLink()) queue.push(candidate);
    }
  }
  return "";
}
async function replaceClawbrowserRelease(source, release) {
  const dataDir = path.join(nextbrowserRuntimeRoot(), "data");
  await fs.mkdir(dataDir, { recursive: true });
  const isBundle = process.platform === "darwin";
  const target = isBundle
    ? path.join(dataDir, "Clawbrowser.app")
    : path.join(dataDir, process.platform === "win32" ? "clawbrowser.exe" : "clawbrowser");
  const staged = `${target}.update-${randomUUID()}`;
  const backup = `${target}.previous-${randomUUID()}`;
  let backedUp = false;
  try {
    if (isBundle) {
      await fs.cp(source, staged, dasbrowserAppCopyOptions());
      const signature = await run("codesign", ["--verify", "--deep", "--strict", staged], {}, { timeoutMs: 120_000 });
      if (signature.code !== 0) throw new Error("The downloaded ClawBrowser app failed macOS signature verification.");
    } else {
      await fs.copyFile(source, staged);
      if (process.platform !== "win32") await fs.chmod(staged, 0o755);
    }
    try {
      await fs.rename(target, backup);
      backedUp = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await fs.rename(staged, target);
    await fs.writeFile(
      path.join(dataDir, ".clawbrowser-browser-release.json"),
      JSON.stringify({
        repository: "clawbrowser/clawbrowser",
        version: release.version,
        asset_name: release.assetName,
        archive_url: release.url,
        browser_path: target,
        source: "release-archive",
        updated_at: new Date().toISOString(),
      }, null, 2),
      "utf8",
    );
    if (backedUp) await fs.rm(backup, { recursive: true, force: true });
  } catch (error) {
    await fs.rm(staged, { recursive: true, force: true }).catch(() => undefined);
    if (backedUp) {
      await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
      await fs.rename(backup, target).catch(() => undefined);
    }
    throw error;
  }
}
async function updateClawbrowserRuntime(latestVersion) {
  const runtimeRoot = nextbrowserRuntimeRoot();
  const release = clawbrowserReleaseAsset(process.platform, process.arch, latestVersion);
  return installRuntimeUpdateWithVerification({
    label: "ClawBrowser",
    expectedVersion: latestVersion,
    install: async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nextbrowser-clawbrowser-update-"));
      try {
        const archive = path.join(tempDir, release.assetName);
        const extracted = path.join(tempDir, "extract");
        await downloadFileStreaming(release.url, archive);
        await extractArchive(archive, release.kind, extracted);
        const source = await findClawbrowserReleaseAsset(extracted);
        if (!source) throw new Error("The ClawBrowser release did not contain a browser executable.");
        await replaceClawbrowserRelease(source, release);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
    readInstalledVersion: () => installedClawbrowserVersion(runtimeRoot),
  });
}
async function updateCamoufoxRuntime(latestVersion) {
  const python = camoufoxVenvPython();
  if (!launchable(python)) throw new Error("Camoufox is not installed on this device.");
  const version = assertRuntimeReleaseVersion(latestVersion);
  const install = await run(python, [
    "-m", "pip", "install", "--disable-pip-version-check", "--upgrade", `camoufox[geoip]==${version}`,
  ], {}, { timeoutMs: 30 * 60 * 1000 });
  if (install.code !== 0) throw new Error((install.stderr || install.stdout || "Camoufox package update failed.").trim());
  const browser = await run(python, ["-m", "camoufox", "fetch"], {}, { timeoutMs: 30 * 60 * 1000 });
  if (browser.code !== 0) throw new Error((browser.stderr || browser.stdout || "Camoufox browser download failed.").trim());
}
async function installedBrowserRuntimeVersion(runtime) {
  if (runtime === "clawbrowser") return installedClawbrowserVersion(nextbrowserRuntimeRoot());
  if (runtime === "camoufox") return installedCamoufoxVersion(nextbrowserRuntimeRoot());
  if (runtime === "dasbrowser") return installedDasbrowserVersion();
  return "";
}
async function installBrowserRuntimeUpdates(requestedRuntimes = []) {
  if (browserRuntimeUpdateInstallPromise) return browserRuntimeUpdateInstallPromise;
  browserRuntimeUpdateInstallPromise = (async () => {
    const fresh = await checkForBrowserRuntimeUpdates();
    const updates = selectAvailableRuntimeUpdates(fresh, requestedRuntimes);
    if (!updates.length) {
      setBrowserRuntimeUpdateInstallStatus("failed", {
        runtimes: [],
        message: "The selected browser toolsets are already up to date.",
      });
      return browserRuntimeUpdateInstallStatus;
    }
    const completed = [];
    const errors = [];
    setBrowserRuntimeUpdateInstallStatus("installing", {
      runtimes: updates.map((runtime) => runtime.runtime),
      completed,
      errors: [],
      currentRuntime: updates[0].runtime,
      currentName: updates[0].name,
      currentVersion: updates[0].latestVersion,
      total: updates.length,
      progress: 0,
      message: "Downloading the confirmed updates in the background.",
    });
    for (let index = 0; index < updates.length; index += 1) {
      const update = updates[index];
      setBrowserRuntimeUpdateInstallStatus("installing", {
        currentRuntime: update.runtime,
        currentName: update.name,
        currentVersion: update.latestVersion,
        completed: [...completed],
        progress: Math.round((index / updates.length) * 100),
        message: `Installing ${update.name} ${update.latestVersion || "update"} in the background.`,
      });
      try {
        if (update.runtime === "clawbrowser") await updateClawbrowserRuntime(update.latestVersion);
        else if (update.runtime === "camoufox") await updateCamoufoxRuntime(update.latestVersion);
        else if (update.runtime === "dasbrowser") await ensureDasbrowserRuntime({ force: true, reportStatus: false });
        const expected = assertRuntimeReleaseVersion(update.latestVersion);
        const installed = await installedBrowserRuntimeVersion(update.runtime);
        if (!installed || compareVersions(installed, expected) < 0) {
          throw new Error(`${update.name} ${expected} was downloaded, but the installed version is still ${installed || "unknown"}.`);
        }
        completed.push(update.runtime);
      } catch (error) {
        errors.push({ runtime: update.runtime, name: update.name, message: error?.message || String(error) });
      }
    }
    await checkForBrowserRuntimeUpdates();
    const status = errors.length ? (completed.length ? "partial" : "failed") : "ready";
    setBrowserRuntimeUpdateInstallStatus(status, {
      currentRuntime: undefined,
      currentName: undefined,
      currentVersion: undefined,
      completed,
      errors,
      progress: 100,
      message: errors.length
        ? completed.length
          ? "Some browser toolsets were updated, but others need attention."
          : "The browser toolset updates could not be installed."
        : `${completed.length === 1 ? "The browser toolset is" : "Browser toolsets are"} ready to use.`,
    });
    return browserRuntimeUpdateInstallStatus;
  })().finally(() => {
    browserRuntimeUpdateInstallPromise = null;
  });
  return browserRuntimeUpdateInstallPromise;
}
function startBrowserRuntimeUpdateChecks() {
  setTimeout(() => { void checkForBrowserRuntimeUpdates(); }, 5_000);
  if (browserRuntimeUpdateTimer) clearInterval(browserRuntimeUpdateTimer);
  browserRuntimeUpdateTimer = setInterval(() => {
    void checkForBrowserRuntimeUpdates();
  }, BROWSER_RUNTIME_UPDATE_CHECK_INTERVAL_MS);
}
function apiBaseURL(raw) {
  return String(
    raw
      || process.env.NEXTBROWSER_DEV_API_BASE_URL
      || process.env.NEXTBROWSER_API_BASE_URL
      || process.env.CLAWBROWSER_API_BASE_URL
      || DEFAULT_API_BASE_URL,
  ).replace(/\/$/, "");
}
function authBaseURL() {
  return String(process.env.NEXTBROWSER_AUTH_BASE_URL || DEFAULT_AUTH_BASE_URL).replace(/\/$/, "");
}
function authLogoutURL() {
  const issuer = String(process.env.NEXTBROWSER_AUTH0_ISSUER_BASE_URL || DEFAULT_AUTH0_ISSUER_BASE_URL).replace(/\/$/, "");
  const clientId = String(process.env.NEXTBROWSER_AUTH0_CLIENT_ID || DEFAULT_AUTH0_CLIENT_ID).trim();
  const url = new URL(`${issuer}/v2/logout`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("returnTo", `${authBaseURL()}/`);
  return url.toString();
}
async function apiFetchJSON(baseURL, route, options = {}) {
  const response = await fetch(`${apiBaseURL(baseURL)}${route}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  if (text.trim()) {
    try { body = JSON.parse(text); }
    catch { body = { message: text }; }
  }
  if (!response.ok) {
    const message = body?.message || body?.error || `API request failed (${response.status})`;
    throw new Error(message);
  }
  return body;
}

async function invokeCommand(command, args = {}, sender) {
  switch (command) {
    case "github_stars": {
      let count = null;
      try {
        count = await fetchGitHubStars(fetch, { signal: AbortSignal.timeout(5000) });
      } catch {
        // A local result is still useful when GitHub is unavailable.
      }
      if (typeof count === "number") {
        await writeLocalGitHubStars(githubStarsCachePath(), count);
        return count;
      }
      return (await readLocalGitHubStars(githubStarsCachePath())) ?? 17;
    }
    case "app_update_status": return appUpdateStatus;
    case "browser_runtime_update_status": return browserRuntimeUpdateStatus;
    case "browser_runtime_check_for_updates": return checkForBrowserRuntimeUpdates();
    case "browser_runtime_update_install_status": return browserRuntimeUpdateInstallStatus;
    case "browser_runtime_install_updates": return installBrowserRuntimeUpdates(args.runtimes || []);
    case "app_check_for_update": {
      await checkForAppUpdate();
      return appUpdateStatus;
    }
    case "app_download_update": {
      if (!appUpdatesSupported()) {
        setAppUpdateStatus("disabled", { message: "App updates are unavailable in this build." });
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
    case "multilogin_status": return await multiloginStatus();
    case "multilogin_connect": return await connectMultilogin(args.bearerToken);
    case "multilogin_disconnect": return await disconnectMultilogin();
    case "multilogin_profile_create": return await createMultiloginProfile(args);
    case "manual_proxies_list": return await listPersonalProxies({ env: childEnv() });
    case "manual_proxy_save": return await createPersonalProxy(args.proxy, { env: childEnv() });
    case "manual_proxy_delete": return await deletePersonalProxy(args.id, { env: childEnv() });
    case "manual_proxy_profile_create": {
      const profileName = String(args.profileName || "").trim();
      if (!profileName) throw new Error("Profile name is required.");
      const runtime = ["clawbrowser", "dasbrowser", "camoufox"].includes(args.runtime)
        ? args.runtime
        : "clawbrowser";
      const proxy = await resolvePersonalProxy(args.proxyId, { env: childEnv() });
      return await executeNextctl([
        "profiles", "create", profileName,
        "--manual-proxy",
        "--proxy-scheme", proxy.scheme,
        "--proxy-host", proxy.host,
        "--proxy-port", String(proxy.port),
        ...(proxy.username ? ["--proxy-username", proxy.username] : []),
        "--runtime", runtime,
        "--format", "json",
      ], {
        extraEnv: proxy.password ? { NBC_PROXY_PASSWORD: proxy.password } : {},
        requestId: args.requestId,
        timeoutMs: args.timeoutMs,
      });
    }
    case "manual_proxy_profile_update": {
      const profileName = String(args.profileName || "").trim();
      if (!profileName) throw new Error("Profile name is required.");
      const runtime = ["clawbrowser", "dasbrowser", "camoufox"].includes(args.runtime)
        ? args.runtime
        : "clawbrowser";
      const proxy = await resolvePersonalProxy(args.proxyId, { env: childEnv() });
      return await executeNextctl([
        "profiles", "set-proxy", profileName,
        "--manual-proxy",
        "--proxy-scheme", proxy.scheme,
        "--proxy-host", proxy.host,
        "--proxy-port", String(proxy.port),
        ...(proxy.username ? ["--proxy-username", proxy.username] : []),
        "--runtime", runtime,
        "--format", "json",
      ], {
        extraEnv: proxy.password ? { NBC_PROXY_PASSWORD: proxy.password } : {},
        requestId: args.requestId,
        timeoutMs: args.timeoutMs,
      });
    }
    case "nextctl_resolve": return await resolveOrInstallNextctl();
    case "nextctl_install_status": return nextctlInstallStatus;
    case "browser_runtime_install_status": return browserRuntimeInstallStatus;
    case "browser_runtime_available": {
      const runtime = ["clawbrowser", "dasbrowser", "camoufox"].includes(args.runtime) ? args.runtime : "clawbrowser";
      if (runtime === "camoufox") return !!(await installedCamoufoxVersion(nextbrowserRuntimeRoot()));
      if (runtime === "dasbrowser") return !!resolveDasbrowserRuntime(dasbrowserRuntimeOptions());
      return !!resolveBrowserRuntime({ platform: process.platform, homeDir: home(), env: process.env, runtimeRoot: nextbrowserRuntimeRoot() });
    }
    case "nextctl_run": {
      return executeNextctl(args.args || [], {
        extraEnv: args.extraEnv || {},
        requestId: args.requestId,
        timeoutMs: args.timeoutMs,
      });
    }
    case "nextctl_cancel": return cancelCommand(args.requestId) || cancelBrowserRuntimeInstall(args.requestId);
    case "nextctl_version": {
      const bin = await resolveOrInstallNextctl(); if (!bin) throw new Error("not found");
      const r = await run(bin, ["version"]); return r.stdout.trim();
    }
    case "nextctl_supports_skill": { const bin = await resolveOrInstallNextctl(); if (!bin) throw new Error("not found"); return nextctlHasSkill(bin); }
    case "projects_list": return await listProjects({ env: childEnv() });
    case "project_put": return await putProject(String(args.id || ""), args.project, { env: childEnv() });
    case "project_delete": return await deleteProject(String(args.id || ""), { env: childEnv() });
    case "workspaces_list": return await listWorkspaces({ env: childEnv() });
    case "workspace_put": return await putWorkspace(String(args.id || ""), args.workspace, { env: childEnv() });
    case "workspace_delete": return await deleteWorkspace(String(args.id || ""), { env: childEnv() });
    case "account_logout": {
      await shell.openExternal(authLogoutURL());
      await clearRuntimeCredential({ runtimeRoot: nextbrowserRuntimeRoot() });
      return null;
    }
    case "pairing_start": {
      return apiFetchJSON(args.apiBaseUrl, "/v1/pairing-requests/browser", {
        method: "POST",
        body: JSON.stringify({
          display_name: args.displayName || os.hostname() || "NextBrowser Desktop",
          runtime_name: "nextbrowser-desktop",
          version: args.version || app.getVersion(),
          platform: process.platform,
          os: `${process.platform} ${os.release()}`,
          hostname: os.hostname(),
          metadata: { app: "NextBrowser" },
        }),
      });
    }
    case "pairing_poll": {
      const id = encodeURIComponent(String(args.pairingId || ""));
      const token = encodeURIComponent(String(args.pollToken || ""));
      return apiFetchJSON(args.apiBaseUrl, `/v1/pairing-requests/${id}?poll_token=${token}`);
    }
    case "open_external": {
      await shell.openExternal(String(args.url || ""));
      return null;
    }
    case "app_platform": return { platform: process.platform, arch: process.arch };
    case "app_focus": {
      focusMainWindow();
      setTimeout(() => focusMainWindow(), 400);
      return null;
    }
    case "app_set_theme": {
      const theme = args.theme === "light" ? "light" : "dark";
      nativeTheme.themeSource = theme;
      for (const window of BrowserWindow.getAllWindows()) {
        window.setBackgroundColor(theme === "light" ? "#f5f5f7" : "#15141c");
      }
      return null;
    }
    case "agent_authorize": {
      const bin = resolveBinary(args.binary, args.envVar); if (!bin) throw new Error(`${args.binary} executable not found.`);
      const r = await run(bin, ["--version"]); if (r.code !== 0) throw new Error(`${args.binary} is not ready: ${(r.stdout + r.stderr).trim()}`);
      return (r.stdout + r.stderr).trim() || args.binary;
    }
    case "agent_check_login": {
      if (!args.statusArgs?.length) return null;
      const bin = resolveBinary(args.binary, args.envVar); if (!bin) throw new Error(`${args.binary} executable not found.`);
      const r = await run(bin, args.statusArgs); const text = `${r.stdout}${r.stderr}`.toLowerCase();
      if (["not logged in", "logged out", "please run", "not authenticated"].some((v) => text.includes(v))) return false;
      if (["logged in", "authenticated", "account", "email", "subscription"].some((v) => text.includes(v))) return true;
      if (text.includes("api") && text.includes("key")) return true;
      return r.code === 0;
    }
    case "open_terminal_login": {
      const bin = resolveBinary(args.binary, args.envVar); if (!bin) throw new Error(`${args.binary} executable not found.`);
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
    case "browser_verification_failure_choice": {
      const owner = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      const surfaces = Array.isArray(args.failedSurfaces)
        ? args.failedSurfaces.map((value) => String(value).trim()).filter(Boolean).slice(0, 8)
        : [];
      const detail = [
        surfaces.length ? `Failed checks: ${surfaces.join(", ")}.` : "The browser verification did not complete successfully.",
        "You can retry, or continue this task in the direct browser session without the selected proxy.",
        "Continuing without proxy may expose your real IP and will not preserve the requested country.",
      ].join("\n\n");
      const options = {
        type: "warning",
        title: "Proxy verification failed",
        message: "The selected proxy could not be verified.",
        detail,
        buttons: ["Retry verification", "Continue without proxy", "Cancel"],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      };
      const result = owner
        ? await dialog.showMessageBox(owner, options)
        : await dialog.showMessageBox(options);
      return ["retry", "direct", "cancel"][result.response] || "cancel";
    }
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
    case "artifact_list": {
      return await localAutomationArtifacts().list(String(args.workspaceId || ""));
    }
    case "artifact_validate": {
      return await localAutomationArtifacts().validate(String(args.workspaceId || ""), String(args.id || ""));
    }
    case "artifact_import": {
      const owner = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      const result = await dialog.showOpenDialog(owner, {
        title: "Add artifacts",
        properties: ["openFile", "multiSelections"],
      });
      if (result.canceled) return [];
      for (const selected of result.filePaths.slice(0, 20)) {
        await localAutomationArtifacts().importFile(String(args.workspaceId || ""), selected);
      }
      return await localAutomationArtifacts().list(String(args.workspaceId || ""));
    }
    case "artifact_open": {
      const target = await localAutomationArtifacts().resolvePath(String(args.workspaceId || ""), String(args.id || ""));
      const error = await shell.openPath(target);
      if (error) throw new Error(error);
      return null;
    }
    case "artifact_reveal": {
      const target = await localAutomationArtifacts().resolvePath(String(args.workspaceId || ""), String(args.id || ""));
      shell.showItemInFolder(target);
      return null;
    }
    case "artifact_delete": {
      return await localAutomationArtifacts().delete(String(args.workspaceId || ""), String(args.id || ""));
    }
    case "automation_workflows_list": return await listAutomationWorkflows({ env: childEnv() });
    case "automation_workflow_put": return await putAutomationWorkflow(args.workflow || {}, { env: childEnv() });
    case "automation_workflow_delete": return await deleteAutomationWorkflow(String(args.id || ""), { env: childEnv() });
    case "automation_recordings_list": return await listAutomationRecordings({ env: childEnv() });
    case "automation_recording_put": return await putAutomationRecording(args.recording || {}, { env: childEnv() });
    case "automation_recording_delete": return await deleteAutomationRecording(String(args.id || ""), { env: childEnv() });
    case "automation_shares_list": return await listAutomationShares(String(args.box || "inbox"), { env: childEnv() });
    case "automation_share_create": return await createAutomationShare(args.share || {}, { env: childEnv() });
    case "automation_share_accept": return await acceptAutomationShare(String(args.id || ""), { env: childEnv() });
    case "automation_share_decline": return await declineAutomationShare(String(args.id || ""), { env: childEnv() });
    case "automation_share_revoke": return await revokeAutomationShare(String(args.id || ""), { env: childEnv() });
    case "automation_runs_list": return await listAutomationRuns(String(args.workspaceId || ""), { env: childEnv() });
    case "automation_seed_examples": {
      const workspaceId = String(args.workspaceId || "");
      const [backend, artifacts] = await Promise.all([
        seedAutomationExamples({ env: childEnv() }),
        localAutomationArtifacts().seedExamples(workspaceId),
      ]);
      return { seeded: { ...backend.seeded, artifacts } };
    }
    case "automation_run_create": return await createAutomationRun(args.run || {}, { env: childEnv() });
    case "automation_run_update": return await updateAutomationRun(String(args.id || ""), args.update || {}, { env: childEnv() });
    case "automation_recipe_execute": {
      const binary = await resolveOrInstallNextctl();
      if (!binary) throw new Error("NextBrowser browser runtime is unavailable.");
      const requestedRuntime = ["clawbrowser", "dasbrowser", "camoufox", "multilogin"].includes(args.runtime) ? args.runtime : "clawbrowser";
      if (requestedRuntime === "multilogin") await initializeMultiloginCredential();
      const runtimeBin = requestedRuntime === "dasbrowser" ? await ensureDasbrowserRuntime() : undefined;
      return await executeAutomationRecipe({
        executionId: args.executionId,
        recipe: args.recipe,
        parameters: args.parameters,
        profile: args.profile,
        runtime: requestedRuntime === "dasbrowser" ? "chromium" : requestedRuntime,
        runtimeBin,
      }, {
        binary,
        env: childEnv(),
        onProgress: (progress) => emit("automation:recipe-progress", progress),
        onLocalAction: (action, context) => saveAutomationArtifact({
          action,
          results: context.results,
          workspaceId: String(args.workspaceId || ""),
          runId: args.backendRunId ? String(args.backendRunId) : undefined,
          store: localAutomationArtifacts(),
        }),
        onStep: args.backendRunId ? ({ position, ...update }) => updateAutomationRunStep(String(args.backendRunId), position, update, { env: childEnv() }).catch(() => undefined) : undefined,
      });
    }
    case "automation_recipe_cancel": return cancelAutomationRecipe(String(args.executionId || ""));
    case "automation_page_recording_start": {
      const binary = await resolveOrInstallNextctl();
      if (!binary) throw new Error("NextBrowser browser runtime is unavailable.");
      const requestedRuntime = ["clawbrowser", "dasbrowser", "camoufox", "multilogin"].includes(args.runtime) ? args.runtime : "clawbrowser";
      if (requestedRuntime === "multilogin") await initializeMultiloginCredential();
      const runtimeBin = requestedRuntime === "dasbrowser" ? await ensureDasbrowserRuntime() : undefined;
      return await startAutomationPageRecording({
        recordingId: args.recordingId,
        profile: args.profile,
        runtime: requestedRuntime === "dasbrowser" ? "chromium" : requestedRuntime,
        runtimeBin,
        attach: args.attach !== false,
      }, { binary, env: childEnv() });
    }
    case "automation_page_recording_attach": return await attachAutomationPageRecording(String(args.recordingId || ""));
    case "automation_page_recording_stop": return await stopAutomationPageRecording(String(args.recordingId || ""));
    case "automation_element_pick": {
      const binary = await resolveOrInstallNextctl();
      if (!binary) throw new Error("NextBrowser browser runtime is unavailable.");
      const requestedRuntime = ["clawbrowser", "dasbrowser", "camoufox", "multilogin"].includes(args.runtime) ? args.runtime : "clawbrowser";
      if (requestedRuntime === "multilogin") await initializeMultiloginCredential();
      const runtimeBin = requestedRuntime === "dasbrowser" ? await ensureDasbrowserRuntime() : undefined;
      const owner = sender && !sender.isDestroyed() ? BrowserWindow.fromWebContents(sender) : undefined;
      try {
        return await pickAutomationElement({
          pickId: args.pickId,
          mode: args.mode,
          container: args.container,
          fieldName: args.fieldName,
          openUrl: args.openUrl,
          profile: args.profile,
          runtime: requestedRuntime === "dasbrowser" ? "chromium" : requestedRuntime,
          runtimeBin,
        }, {
          binary,
          env: childEnv(),
          onReady: () => { if (owner && !owner.isDestroyed()) owner.minimize(); },
        });
      } finally {
        if (owner && !owner.isDestroyed()) { owner.restore(); owner.show(); owner.focus(); }
      }
    }
    case "automation_element_pick_cancel": return cancelAutomationElementPick(String(args.pickId || ""));
    case "select_terminal_files": {
      const owner = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      const result = await dialog.showOpenDialog(owner, {
        title: "Attach files to terminal",
        properties: ["openFile", "multiSelections"],
      });
      if (result.canceled) return [];
      const conversation = String(args.conversationId || "terminal")
        .replace(/[^A-Za-z0-9_-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 96) || "terminal";
      const attachmentDir = path.join(agentWorkspaceDir(home()), ".attachments", conversation);
      await fs.mkdir(attachmentDir, { recursive: true, mode: 0o700 });
      const files = [];
      let totalSize = 0;
      for (const selected of result.filePaths.slice(0, 20)) {
        const source = await fs.realpath(selected);
        const stat = await fs.stat(source);
        if (!stat.isFile()) throw new Error(`${path.basename(source)} is not a regular file.`);
        if (stat.size > 30 * 1024 * 1024) throw new Error(`${path.basename(source)} is larger than the 30 MB per-file limit used for reliable Claude Code and Codex attachments.`);
        totalSize += stat.size;
        if (totalSize > 600 * 1024 * 1024) throw new Error("Terminal attachments are limited to 600 MB per selection.");
        const safeName = path.basename(source).replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").slice(0, 180) || "file";
        const target = path.join(attachmentDir, `${randomUUID()}-${safeName}`);
        // Prefer copy-on-write cloning where the filesystem supports it. This
        // keeps large explicit attachments sandbox-readable without doubling
        // their disk usage; Node falls back to a regular copy when unavailable.
        await fs.copyFile(source, target, fsSync.constants.COPYFILE_FICLONE);
        if (process.platform !== "win32") await fs.chmod(target, 0o600);
        files.push({ name: path.basename(source), path: target, size: stat.size });
      }
      return files;
    }
    case "remove_terminal_file": {
      const workspace = agentWorkspaceDir(home());
      const attachmentRoot = path.resolve(workspace, ".attachments");
      const target = path.resolve(String(args.path || ""));
      const relative = path.relative(attachmentRoot, target);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("Refusing to remove a file outside the terminal attachment directory.");
      }
      await fs.rm(target, { force: true });
      return null;
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
    case "write_local_skill": {
      const slug = String(args.slug || "browser-workflow").toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "browser-workflow";
      const dir = path.join(dataDir(), "local-skills", slug);
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, "SKILL.md");
      await fs.writeFile(file, String(args.content || ""), "utf8");
      return file;
    }
    case "delete_local_skill": {
      const slug = String(args.slug || "").toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      if (slug) await fs.rm(path.join(dataDir(), "local-skills", slug), { recursive: true, force: true });
      return null;
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
    case "working_directory": {
      // Keep coding-agent discovery outside ~/Library/Application Support.
      // Agents walk parent directories for config/instruction files; inside
      // Library that can make macOS attribute unrelated TCC access requests
      // (Music, other apps' data, protected folders) to NextBrowser.
      const dir = agentWorkspaceDir(home());
      await fs.mkdir(dir, { recursive: true });
      await ensureWorkspaceInstructions(dir);
      return dir;
    }
    // Read-only view of one file an agent keeps in its workspace, which is how
    // the UI shows what a skill recorded. The renderer never writes there: the
    // file belongs to the agent, and a write from here could overwrite a run.
    case "workspace_file_read": {
      const file = path.join(agentWorkspaceDir(home()), safeName(args.name));
      try {
        const content = await fs.readFile(file, "utf8");
        return content.length > MAX_WORKSPACE_FILE_BYTES ? content.slice(0, MAX_WORKSPACE_FILE_BYTES) : content;
      } catch (e) {
        if (e.code === "ENOENT") return null;
        throw e;
      }
    }
    case "agent_run": {
      const bin = resolveBinary(args.binary, args.envVar); if (!bin) throw new Error(`${args.binary} executable not found.`);
      const conversationId = String(args.conversationId || "");
      const controlToken = randomUUID();
      const controlURL = await ensureAgentControlServer();
      const profileScope = new Map(
        (Array.isArray(args.browserProfiles) ? args.browserProfiles : [])
          .filter((item) => item && typeof item.name === "string" && ["clawbrowser", "dasbrowser", "camoufox"].includes(item.runtime))
          .map((item) => [item.name, {
            runtime: item.runtime,
            conversationId,
            ownerConversationId: typeof item.ownerConversationId === "string" ? item.ownerConversationId : "",
            wasRunning: item.running === true,
          }]),
      );
      for (const [profile, access] of profileScope) {
        if (access.ownerConversationId) agentControlProfileOwners.set(profile, access.ownerConversationId);
      }
      agentControlScopes.set(controlToken, profileScope);
      const artifactScope = args.workspaceId
        ? { workspaceId: String(args.workspaceId), conversationId }
        : null;
      if (artifactScope) agentControlArtifactScopes.set(controlToken, artifactScope);
      const profileScopeDir = path.join(nextbrowserRuntimeRoot(), "chat-scopes");
      const profileScopeFile = path.join(profileScopeDir, `${args.replyId}.json`);
      await fs.mkdir(profileScopeDir, { recursive: true });
      await fs.writeFile(profileScopeFile, JSON.stringify(Object.fromEntries(
        [...profileScope.entries()].map(([name, access]) => [name, access.runtime]),
      )), "utf8");
      if (args.workingDir) await ensureWorkspaceInstructions(args.workingDir, String(args.browserContext || ""));
      let agentArgs = args.args || [];
      if (args.agentId === "codex") {
        await ensureCodexTerminalProfile();
        const nextctlBin = await resolveOrInstallNextctl();
        if (!nextctlBin) throw new Error("nextctl is required for Clawbrowser MCP.");
        const requestedTraceFile = activeAutomationTraceFile();
        const supportedTraceFile = requestedTraceFile && await nextctlHasAutomationTrace(nextctlBin)
          ? requestedTraceFile
          : "";
        agentArgs = [...codexClawbrowserMCPArgs(nextctlBin, supportedTraceFile), ...agentArgs];
      }
      const spec = commandSpec(bin, agentArgs);
      try {
        return await runAgentProcess({
          spawnProcess: spawn,
          file: spec.file,
          args: spec.args,
          cwd: args.workingDir,
          env: childEnv({
            NEXTBROWSER_CONTROL_URL: controlURL,
            NEXTBROWSER_CONTROL_TOKEN: controlToken,
            NEXTBROWSER_ALLOWED_PROFILES_JSON: JSON.stringify(Object.fromEntries(
              [...profileScope.entries()].map(([name, access]) => [name, access.runtime]),
            )),
            NEXTBROWSER_PROFILE_SCOPE_FILE: profileScopeFile,
            ...(activeAutomationTraceFile() ? { NEXTBROWSER_AUTOMATION_TRACE_FILE: activeAutomationTraceFile() } : {}),
          }),
          stdinText: args.stdinText,
          onSpawn: (child) => children.set(args.replyId, child),
          onStdout: (chunk) => emit("agent:chunk", [args.replyId, chunk.toString()]),
          onStderr: (chunk) => emit("agent:activity", [args.replyId, chunk.toString()]),
          onDone: (result) => {
            children.delete(args.replyId);
            emit("agent:done", [args.replyId, result.code, result.stderr, result.stdout]);
          },
        });
      } finally {
        agentControlScopes.delete(controlToken);
        agentControlArtifactScopes.delete(controlToken);
        await fs.unlink(profileScopeFile).catch(() => undefined);
      }
    }
    case "workflow_author_run": {
      const bin = resolveBinary(args.binary, args.envVar); if (!bin) throw new Error(`${args.binary} executable not found.`);
      const spec = commandSpec(bin, args.args || []);
      return new Promise((resolve, reject) => {
        const child = spawn(spec.file, spec.args, {
          cwd: args.workingDir || undefined,
          env: childEnv(), windowsHide: true,
          stdio: [args.stdinText != null ? "pipe" : "ignore", "pipe", "pipe"],
        });
        let stdout = ""; let stderr = ""; let settled = false;
        const append = (current, chunk) => (current + chunk.toString()).slice(-32 * 1024);
        child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
        child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
        const timer = setTimeout(() => { if (!settled) child.kill(); }, 45_000);
        child.on("error", (error) => { clearTimeout(timer); if (!settled) { settled = true; reject(error); } });
        child.on("close", (code) => {
          clearTimeout(timer);
          if (!settled) { settled = true; resolve({ code: code ?? -1, stdout, stderr }); }
        });
        if (args.stdinText != null) child.stdin.end(args.stdinText);
      });
    }
    case "agent_terminate": {
      const child = children.get(args.replyId);
      if (child) {
        await terminateProcessTree(child.pid, { includeRoot: true });
        children.delete(args.replyId);
      }
      return null;
    }
    case "terminal_start": {
      const agent = TERMINAL_AGENTS[String(args.agentId || "")];
      if (!agent) throw new Error("This agent is not available in the experimental terminal.");
      const bin = resolveBinary(agent.binary, agent.envVar);
      if (!bin) throw new Error(`${agent.binary} CLI not found.`);
      const id = randomUUID();
      const controlToken = randomUUID();
      const controlURL = await ensureAgentControlServer();
      const profileScope = new Map(
        (Array.isArray(args.browserProfiles) ? args.browserProfiles : [])
          .filter((item) => item && typeof item.name === "string" && ["clawbrowser", "dasbrowser", "camoufox"].includes(item.runtime))
          .map((item) => [item.name, {
            runtime: item.runtime,
            conversationId: String(args.conversationId || ""),
            ownerConversationId: typeof item.ownerConversationId === "string" ? item.ownerConversationId : "",
            wasRunning: item.running === true,
          }]),
      );
      for (const [profile, access] of profileScope) {
        if (access.ownerConversationId) agentControlProfileOwners.set(profile, access.ownerConversationId);
      }
      agentControlScopes.set(controlToken, profileScope);
      if (args.workspaceId) agentControlArtifactScopes.set(controlToken, {
        workspaceId: String(args.workspaceId),
        conversationId: String(args.conversationId || ""),
      });
      const profileScopeDir = path.join(nextbrowserRuntimeRoot(), "terminal-scopes");
      const profileScopeFile = path.join(profileScopeDir, `${id}.json`);
      await fs.mkdir(profileScopeDir, { recursive: true });
      await fs.writeFile(profileScopeFile, JSON.stringify(Object.fromEntries(
        [...profileScope.entries()].map(([name, access]) => [name, access.runtime]),
      )), "utf8");
      if (args.workingDir) await ensureWorkspaceInstructions(args.workingDir, String(args.browserContext || ""));
      const writableDirs = args.agentId === "codex" ? clawbrowserWritableDirs() : [];
      let agentArgs = agent.args || [];
      if (args.agentId === "codex") {
        await ensureCodexTerminalProfile();
        const nextctlBin = await resolveOrInstallNextctl();
        if (!nextctlBin) throw new Error("nextctl is required for Clawbrowser MCP.");
        const requestedTraceFile = activeAutomationTraceFile();
        const supportedTraceFile = requestedTraceFile && await nextctlHasAutomationTrace(nextctlBin)
          ? requestedTraceFile
          : "";
        agentArgs = codexClawbrowserArgs(nextctlBin, supportedTraceFile);
      }
      await Promise.all(writableDirs.map((dir) => fs.mkdir(dir, { recursive: true })));
      const terminalArgs = [
        ...agentArgs,
        ...writableDirs.flatMap((dir) => ["--add-dir", dir]),
      ];
      const spec = commandSpec(bin, terminalArgs);
      const terminal = pty.spawn(spec.file, spec.args, {
        name: "xterm-256color",
        cols: Math.max(2, Math.min(500, Number(args.cols) || 80)),
        rows: Math.max(2, Math.min(300, Number(args.rows) || 24)),
        cwd: args.workingDir || home(),
        env: terminalEnv({
          NEXTBROWSER_CONTROL_URL: controlURL,
          NEXTBROWSER_CONTROL_TOKEN: controlToken,
          NEXTBROWSER_ALLOWED_PROFILES_JSON: JSON.stringify(Object.fromEntries(
            [...profileScope.entries()].map(([name, access]) => [name, access.runtime]),
          )),
          NEXTBROWSER_PROFILE_SCOPE_FILE: profileScopeFile,
        }),
      });
      const record = {
        process: terminal,
        ready: false,
        buffer: [],
        exit: null,
        controlToken,
        profileScope,
        profileScopeFile,
        webContentsId: sender?.id,
      };
      terminals.set(id, record);
      terminal.onData((data) => {
        if (record.ready) emit("terminal:data", [id, data]);
        else record.buffer.push(data);
      });
      terminal.onExit(({ exitCode, signal }) => {
        record.exit = [exitCode, signal];
        if (record.ready) {
          terminals.delete(id);
          agentControlScopes.delete(record.controlToken);
          agentControlArtifactScopes.delete(record.controlToken);
          void fs.unlink(record.profileScopeFile).catch(() => undefined);
          emit("terminal:exit", [id, exitCode, signal]);
        }
      });
      return id;
    }
    case "terminal_context_menu": {
      const text = typeof args.text === "string" ? args.text.slice(0, 1024 * 1024) : "";
      const window = sender ? BrowserWindow.fromWebContents(sender) : undefined;
      const menu = Menu.buildFromTemplate([{
        label: "Copy",
        enabled: text.length > 0,
        accelerator: "CmdOrCtrl+C",
        click: () => clipboard.writeText(text),
      }]);
      menu.popup(window ? { window } : {});
      return null;
    }
    case "terminal_ready": {
      const id = String(args.id || "");
      const record = terminals.get(id);
      if (!record) return null;
      record.ready = true;
      for (const data of record.buffer) emit("terminal:data", [id, data]);
      record.buffer = [];
      if (record.exit) {
        terminals.delete(id);
        agentControlScopes.delete(record.controlToken);
        agentControlArtifactScopes.delete(record.controlToken);
        emit("terminal:exit", [id, record.exit[0], record.exit[1]]);
      }
      return null;
    }
    case "terminal_update_context": {
      const record = terminals.get(String(args.id || ""));
      if (!record) return null;
      const conversationId = String(args.conversationId || "");
      const nextScope = new Map(
        (Array.isArray(args.browserProfiles) ? args.browserProfiles : [])
          .filter((item) => item && typeof item.name === "string" && ["clawbrowser", "dasbrowser", "camoufox"].includes(item.runtime))
          .map((item) => {
            const previous = record.profileScope.get(item.name);
            return [item.name, {
              runtime: item.runtime,
              conversationId,
              ownerConversationId: typeof item.ownerConversationId === "string" ? item.ownerConversationId : "",
              wasRunning: previous?.wasRunning ?? item.running === true,
            }];
          }),
      );
      record.profileScope = nextScope;
      agentControlScopes.set(record.controlToken, nextScope);
      if (args.workspaceId) agentControlArtifactScopes.set(record.controlToken, {
        workspaceId: String(args.workspaceId),
        conversationId,
      });
      else agentControlArtifactScopes.delete(record.controlToken);
      await fs.writeFile(record.profileScopeFile, JSON.stringify(Object.fromEntries(
        [...nextScope.entries()].map(([name, access]) => [name, access.runtime]),
      )), "utf8");
      if (args.workingDir) await ensureWorkspaceInstructions(args.workingDir, String(args.browserContext || ""));
      return null;
    }
    case "terminal_input": {
      const record = terminals.get(String(args.id || ""));
      if (record) record.process.write(String(args.data || "").slice(0, 1024 * 1024));
      return null;
    }
    case "terminal_interrupt": {
      const record = terminals.get(String(args.id || ""));
      if (record?.process?.pid) {
        // Deliver the interactive cancel even when the renderer's key event is
        // still in flight, then terminate any separate one-shot CLI subtree.
        record.process.write("\x1b");
        await terminateProcessTree(record.process.pid, { includeRoot: false, nextctlOnly: true });
      }
      if (record?.profileScope) {
        const nextctlBin = await resolveOrInstallNextctl().catch(() => null);
        if (nextctlBin) {
          for (const delayMs of [300, 900, 1_800]) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            await Promise.all([...record.profileScope.entries()].map(async ([profile, access]) => {
              const owner = agentControlProfileOwners.get(profile) || access.ownerConversationId;
              if (owner && owner !== access.conversationId) return;
              if (!owner && access.wasRunning) return;
              const status = await executeNextctl(["status", "--profile", profile, "--runtime", access.runtime, "--format", "json"], { timeoutMs: 15_000 }).catch(() => null);
              if (!status || status.code !== 0 || !/"status"\s*:\s*"running"/i.test(status.stdout)) return;
              await executeNextctl(["stop", "--profile", profile, "--runtime", access.runtime, "--format", "json"]).catch(() => undefined);
              agentControlProfileOwners.delete(profile);
              emit("profile:host-stopped", [profile, access.conversationId]);
            }));
          }
        }
      }
      return null;
    }
    case "terminal_resize": {
      const record = terminals.get(String(args.id || ""));
      if (record) record.process.resize(
        Math.max(2, Math.min(500, Number(args.cols) || 80)),
        Math.max(2, Math.min(300, Number(args.rows) || 24)),
      );
      return null;
    }
    case "terminal_kill": {
      const id = String(args.id || "");
      const record = terminals.get(id);
      if (record) record.process.kill();
      if (record) agentControlScopes.delete(record.controlToken);
      if (record) agentControlArtifactScopes.delete(record.controlToken);
      if (record?.profileScopeFile) await fs.unlink(record.profileScopeFile).catch(() => undefined);
      terminals.delete(id);
      return null;
    }
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
    backgroundColor: "#0e0e0e", show: false,
    ...(icon ? { icon } : {}),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true, backgroundThrottling: false },
  });
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  window.webContents.on("did-attach-webview", (_event, webContents) => {
    webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  });
  const windowWebContentsId = window.webContents.id;
  window.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) killTerminalsForWebContents(windowWebContentsId);
  });
  window.webContents.on("render-process-gone", () => killTerminalsForWebContents(windowWebContentsId));
  window.on("closed", () => killTerminalsForWebContents(windowWebContentsId));
  if (process.env.VITE_DEV_SERVER_URL) window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

// Crash breadcrumbs. The app has been seen dying without a trace in stdout, so
// every abnormal process exit is appended to a file the next session can read.
function logCrash(kind, detail) {
  try {
    const line = `${new Date().toISOString()} ${kind} ${JSON.stringify(detail)}\n`;
    require("node:fs").appendFileSync(path.join(dataDir(), "crash.log"), line);
  } catch {}
}
process.on("uncaughtException", (error) => {
  logCrash("main-uncaught", { message: error?.message, stack: String(error?.stack || "").split("\n").slice(0, 12) });
  // Rethrowing would abort with the default handler; the app stays up and the
  // breadcrumb tells us what would have taken it down.
});
process.on("unhandledRejection", (reason) => {
  logCrash("main-unhandled-rejection", { message: reason instanceof Error ? reason.message : String(reason) });
});
app.on("render-process-gone", (_event, _webContents, details) => {
  if (details.reason !== "clean-exit") logCrash("renderer-gone", details);
});
app.on("child-process-gone", (_event, details) => {
  if (details.reason !== "clean-exit" && details.type !== "Utility") logCrash("child-gone", details);
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    focusMainWindow();
    for (const arg of argv) handleDeepLink(arg);
  });
  app.whenReady().then(() => {
    return migrateLegacyData();
  }).then(() => {
    return migrateLegacyRuntimeConfig();
  }).then(() => {
    applyAppIcon();
    // The account-pairing flow is completed by polling, so a development build
    // never needs to own `nextbrowser://`. On macOS LaunchServices associates a
    // dev registration with Electron.app itself and silently drops the script
    // argument; a browser callback then opens Electron's generic welcome window
    // instead of the running NextBrowser app. Clean up only that stale dev
    // handler. Packaged builds keep the normal protocol registration.
    if (!app.isPackaged) {
      if (app.getApplicationNameForProtocol(`${DEEP_LINK_PROTOCOL}://`) === "Electron") {
        app.removeAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
      }
    } else {
      app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
    }
    ipcMain.handle("nextbrowser:invoke", (event, command, args) => invokeCommand(command, args, event.sender));
    createWindow();
    for (const arg of process.argv) handleDeepLink(arg);
    startAutoUpdater();
    startBrowserRuntimeUpdateChecks();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => {
  if (browserRuntimeUpdateTimer) clearInterval(browserRuntimeUpdateTimer);
  if (appUpdateTimer) clearInterval(appUpdateTimer);
  for (const socket of remoteSignalSockets.values()) socket.close();
  remoteSignalSockets.clear();
  for (const child of children.values()) child.kill();
  for (const terminal of terminals.values()) terminal.process.kill();
  terminals.clear();
  agentControlScopes.clear();
  agentControlArtifactScopes.clear();
  agentControlProfileOwners.clear();
  agentControlServer?.close();
  agentControlServer = null;
  cancelAllCommands();
  cancelAllAutomationRecipes();
  cancelAllAutomationElementPicks();
  cancelAllAutomationPageRecordings();
});
