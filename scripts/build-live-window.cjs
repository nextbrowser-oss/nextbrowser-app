const { spawnSync } = require("node:child_process");
const { existsSync, mkdirSync, rmSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
mkdirSync(path.join(root, "build"), { recursive: true });

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", windowsHide: true, env });
  if (result.error) console.error(`Building the Live window helper requires ${command}.`, result.error.message);
  return result.status ?? 1;
}

if (process.platform === "darwin") {
  const language = run("xcrun", ["clang", "-arch", "arm64", "-arch", "x86_64", "-framework", "Carbon",
    "electron/native/input_language_mac.c", "-o", "build/input-language"]);
  // A universal helper, so an x64 package built on Apple silicon still runs it.
  const parts = ["arm64", "x86_64"].map(arch => {
    const output = `build/live-window-helper-${arch}`;
    const status = run("xcrun", ["swiftc", "-O", "-target", `${arch}-apple-macos12`, "-o", output, "electron/native/live_window_darwin.swift"]);
    return status === 0 ? output : null;
  });
  const live = parts.every(Boolean) ? run("lipo", ["-create", ...parts, "-output", "build/live-window-helper"]) : 1;
  process.exitCode = language || live;
  for (const part of parts) if (part) rmSync(path.join(root, part), { force: true });
} else if (process.platform === "win32") {
  const workspaceGo = path.join(root, "..", "..", ".tools", "go", "bin", "go.exe");
  const go = process.env.NEXTBROWSER_GO || (existsSync(workspaceGo) ? workspaceGo : "go");
  process.exitCode = run(go, ["build", "-trimpath", "-ldflags=-H=windowsgui", "-o",
    "build/live-window-helper.exe", "electron/native/live_window_windows.go"],
  { ...process.env, CGO_ENABLED: "0", GOOS: "windows", GOARCH: "amd64" });
}
