import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Explicit files make deletion/renaming fail instead of silently dropping coverage.
const renderer = [
  "src/preflight.test.ts",
  "src/agent-login-status.test.ts",
  "src/components/AgentConnectionGate.test.tsx",
  "src/store.bootstrap.test.ts",
  "src/store.vps.test.ts",
  "src/store.conversations.test.ts",
  "src/components/BrowserRuntimeUpdatePrompt.test.tsx",
  "src/lib/automationExecution.test.ts",
  "src/lib/automationTrust.test.ts",
  "src/store.profileDeletion.test.ts",
  "src/store.auditFixes.test.ts",
];
const native = [
  "electron/verification-policy.test.cjs",
  "electron/agent-workspace.test.cjs",
  "electron/mcp-profile-scope.test.cjs",
  "electron/automation-runner.test.cjs",
  "electron/automation-element-picker.test.cjs",
  "electron/browser-runtime-updates.test.cjs",
  "electron/manual-proxy-runtime.test.cjs",
];
for (const file of [...renderer, ...native]) {
  if (!existsSync(file)) throw new Error(`Missing critical regression suite: ${file}`);
}
for (const args of [
  ["node_modules/vitest/vitest.mjs", "run", ...renderer],
  ["--test", ...native],
]) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
