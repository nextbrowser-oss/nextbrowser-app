const { spawnSync } = require("node:child_process");
const { existsSync, mkdirSync } = require("node:fs");
const path = require("node:path");

if (process.platform !== "win32") process.exit(0);

const root = path.resolve(__dirname, "..");
const workspaceGo = path.join(root, "..", "..", ".tools", "go", "bin", "go.exe");
const go = process.env.NEXTBROWSER_GO || (existsSync(workspaceGo) ? workspaceGo : "go");
mkdirSync(path.join(root, "build"), { recursive: true });
const result = spawnSync(go, ["build", "-trimpath", "-ldflags=-H=windowsgui", "-o",
  "build/live-window-helper.exe", "electron/native/live_window_windows.go"], {
  cwd: root, stdio: "inherit", windowsHide: true,
  env: { ...process.env, CGO_ENABLED: "0", GOOS: "windows", GOARCH: "amd64" },
});
if (result.error) console.error("Building Windows Live requires Go on PATH.", result.error.message);
process.exitCode = result.status ?? 1;
