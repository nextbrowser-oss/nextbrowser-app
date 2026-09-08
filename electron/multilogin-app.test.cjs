const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  MULTILOGIN_DOWNLOAD_URL,
  multiloginAppCandidates,
  resolveMultiloginApp,
  windowsInstallPathsFromRegistry,
} = require("./multilogin-app.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nextbrowser-multilogin-app-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("finds the macOS app in the user Applications folder", (t) => {
  const home = fixture(t);
  const bundle = path.join(home, "Applications", "Multilogin X.app");
  fs.mkdirSync(path.join(bundle, "Contents", "MacOS"), { recursive: true });
  assert.equal(resolveMultiloginApp({ platform: "darwin", homeDir: home, env: {} }), bundle);
});

test("finds the documented Windows desktop app path", (t) => {
  const home = fixture(t);
  const local = path.join(home, "AppData", "Local");
  const executable = path.join(local, "Multilogin App", "MLXDesktopApp.exe");
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, "binary");
  assert.equal(resolveMultiloginApp({ platform: "win32", homeDir: home, env: { LOCALAPPDATA: local } }), executable);
});

test("finds a Windows install under Local Programs", (t) => {
  const home = fixture(t);
  const local = path.join(home, "AppData", "Local");
  const executable = path.join(local, "Programs", "Multilogin X", "Multilogin X.exe");
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, "binary");
  assert.equal(resolveMultiloginApp({ platform: "win32", homeDir: home, env: { LOCALAPPDATA: local } }), executable);
});

test("scans a renamed Windows folder for the MLX executable", (t) => {
  const home = fixture(t);
  const local = path.join(home, "AppData", "Local");
  const executable = path.join(local, "Multilogin App 12", "MLXDesktopApp.exe");
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, "binary");
  fs.writeFileSync(path.join(local, "Multilogin App 12", "MLX Uninstall.exe"), "binary");
  assert.equal(resolveMultiloginApp({ platform: "win32", homeDir: home, env: { LOCALAPPDATA: local } }), executable);
});

test("falls back to the Windows uninstall registry for a custom install location", (t) => {
  const home = fixture(t);
  const local = path.join(home, "AppData", "Local");
  const executable = path.join(home, "Tools", "Multilogin App", "MLXDesktopApp.exe");
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, "binary");
  const queryRegistry = () => [
    "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Multilogin App",
    "    DisplayName    REG_SZ    Multilogin",
    `    InstallLocation    REG_SZ    ${path.dirname(executable)}`,
    `    DisplayIcon    REG_SZ    ${executable},0`,
    "",
  ].join("\r\n");
  const options = { platform: "win32", homeDir: home, env: { LOCALAPPDATA: local }, queryRegistry };
  assert.equal(resolveMultiloginApp(options), executable);
});

test("ignores registry values that belong to another product", () => {
  const output = [
    "    DisplayIcon    REG_SZ    C:\\Program Files\\Other\\other.exe,0",
    "    InstallLocation    REG_SZ    C:\\Users\\a\\AppData\\Local\\Multilogin App",
  ].join("\r\n");
  assert.deepEqual(windowsInstallPathsFromRegistry(output), ["C:\\Users\\a\\AppData\\Local\\Multilogin App"]);
});

test("scans a Windows install folder the known paths do not cover", (t) => {
  const home = fixture(t);
  const local = path.join(home, "AppData", "Local");
  const executable = path.join(local, "Programs", "multilogin-x-12", "app", "multiloginx.exe");
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, "binary");
  fs.writeFileSync(path.join(local, "Programs", "multilogin-x-12", "Multilogin Uninstall.exe"), "binary");
  assert.equal(resolveMultiloginApp({ platform: "win32", homeDir: home, env: { LOCALAPPDATA: local } }), executable);
});

test("prefers an explicit MULTILOGIN_APP override", (t) => {
  const home = fixture(t);
  const override = path.join(home, "custom", "Multilogin.exe");
  fs.mkdirSync(path.dirname(override), { recursive: true });
  fs.writeFileSync(override, "binary");
  const local = path.join(home, "AppData", "Local");
  const installed = path.join(local, "Programs", "Multilogin X", "Multilogin X.exe");
  fs.mkdirSync(path.dirname(installed), { recursive: true });
  fs.writeFileSync(installed, "binary");
  const env = { LOCALAPPDATA: local, MULTILOGIN_APP: override };
  assert.equal(resolveMultiloginApp({ platform: "win32", homeDir: home, env }), override);
  assert.equal(multiloginAppCandidates({ platform: "win32", homeDir: home, env })[0], override);
});

test("reports nothing installed so the caller can offer the download page", (t) => {
  const home = fixture(t);
  assert.equal(resolveMultiloginApp({ platform: "win32", homeDir: home, env: { LOCALAPPDATA: path.join(home, "none") } }), null);
  assert.equal(MULTILOGIN_DOWNLOAD_URL, "https://multilogin.com/download/");
});
