const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  claudeGlobalConfigFile,
  claudeProjectKey,
  prepareClaudeTerminalConfig,
  seededClaudeConfig,
} = require("./claude-terminal-config.cjs");

async function tempHome(t) {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "nb-claude-config-"));
  t.after(() => fs.rm(homeDir, { recursive: true, force: true }));
  return homeDir;
}

async function readJSON(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

test("a new user's Claude Code starts at its prompt in the workspace folder", async (t) => {
  const homeDir = await tempHome(t);
  const workspaceDir = path.join(homeDir, ".nextbrowser", "workspace");
  // Claude Code keys projects by path with forward slashes on Windows.
  const key = claudeProjectKey(workspaceDir);
  assert.equal(await prepareClaudeTerminalConfig({ workspaceDir, homeDir, env: {} }), true);
  const file = path.join(homeDir, ".claude.json");
  assert.deepEqual(await readJSON(file), {
    hasCompletedOnboarding: true,
    fullscreenUpsellSeenCount: 3,
    projects: { [key]: { hasTrustDialogAccepted: true } },
  });
  if (process.platform !== "win32") assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.deepEqual((await fs.readdir(homeDir)).filter((name) => name.endsWith(".tmp")), []);
});

test("an existing config keeps every value and only gains the missing answers", async (t) => {
  const homeDir = await tempHome(t);
  const workspaceDir = path.join(homeDir, ".nextbrowser", "workspace");
  // Claude Code keys projects by path with forward slashes on Windows.
  const key = claudeProjectKey(workspaceDir);
  const file = path.join(homeDir, ".claude.json");
  const existing = {
    numStartups: 30,
    oauthAccount: { emailAddress: "user@example.com" },
    theme: "light",
    projects: {
      "/home/user/code/site": { allowedTools: ["Bash"], hasTrustDialogAccepted: false },
      // What a chat run (`claude -p`) in the workspace folder leaves behind.
      [key]: { allowedTools: [], lastCost: 0.42, lastSessionId: "s1", hasTrustDialogAccepted: false },
    },
  };
  await fs.writeFile(file, JSON.stringify(existing, null, 2), { mode: 0o640 });
  assert.equal(await prepareClaudeTerminalConfig({ workspaceDir, homeDir, env: {} }), true);
  assert.deepEqual(await readJSON(file), {
    ...existing,
    hasCompletedOnboarding: true,
    fullscreenUpsellSeenCount: 3,
    projects: {
      ...existing.projects,
      [key]: { allowedTools: [], lastCost: 0.42, lastSessionId: "s1", hasTrustDialogAccepted: true },
    },
  });
  if (process.platform !== "win32") assert.equal((await fs.stat(file)).mode & 0o777, 0o640);
});

test("answers the user already gave are not changed", async (t) => {
  const homeDir = await tempHome(t);
  const workspaceDir = path.join(homeDir, ".nextbrowser", "workspace");
  // Claude Code keys projects by path with forward slashes on Windows.
  const key = claudeProjectKey(workspaceDir);
  const file = path.join(homeDir, ".claude.json");
  // Claude Code resets onboarding to false itself after an account switch.
  const text = JSON.stringify({ hasCompletedOnboarding: false, fullscreenUpsellSeenCount: 1, projects: { [key]: { hasTrustDialogAccepted: true } } });
  await fs.writeFile(file, text);
  assert.equal(await prepareClaudeTerminalConfig({ workspaceDir, homeDir, env: {} }), false);
  assert.equal(await fs.readFile(file, "utf8"), text);
});

test("a config that is not a JSON object is left alone", async (t) => {
  const homeDir = await tempHome(t);
  const workspaceDir = path.join(homeDir, ".nextbrowser", "workspace");
  const file = path.join(homeDir, ".claude.json");
  for (const text of ["{\"numStartups\": 3,", "[]", "null", ""]) {
    await fs.writeFile(file, text);
    assert.equal(await prepareClaudeTerminalConfig({ workspaceDir, homeDir, env: {} }), false, JSON.stringify(text));
    assert.equal(await fs.readFile(file, "utf8"), text);
  }
});

test("a read-only config is left alone", { skip: process.platform === "win32" || process.getuid?.() === 0 }, async (t) => {
  const homeDir = await tempHome(t);
  const file = path.join(homeDir, ".claude.json");
  await fs.writeFile(file, "{}", { mode: 0o400 });
  assert.equal(await prepareClaudeTerminalConfig({ workspaceDir: path.join(homeDir, "w"), homeDir, env: {} }), false);
  assert.equal(await fs.readFile(file, "utf8"), "{}");
});

test("a symlinked config is updated where it points", { skip: process.platform === "win32" }, async (t) => {
  const homeDir = await tempHome(t);
  const target = path.join(homeDir, "dotfiles", "claude.json");
  await fs.mkdir(path.dirname(target));
  await fs.writeFile(target, "{\"numStartups\":1}");
  await fs.symlink(target, path.join(homeDir, ".claude.json"));
  assert.equal(await prepareClaudeTerminalConfig({ workspaceDir: path.join(homeDir, "w"), homeDir, env: {} }), true);
  assert.ok((await fs.lstat(path.join(homeDir, ".claude.json"))).isSymbolicLink());
  assert.equal((await readJSON(target)).hasCompletedOnboarding, true);
});

test("the config file is the one Claude Code reads", async (t) => {
  const homeDir = await tempHome(t);
  assert.equal(await claudeGlobalConfigFile({ env: {}, homeDir }), path.join(homeDir, ".claude.json"));
  const configDir = path.join(homeDir, "claude-config");
  assert.equal(await claudeGlobalConfigFile({ env: { CLAUDE_CONFIG_DIR: configDir }, homeDir }), path.join(configDir, ".claude.json"));
  // A custom sign-in endpoint uses a file of its own name.
  assert.equal(await claudeGlobalConfigFile({ env: { CLAUDE_CODE_CUSTOM_OAUTH_URL: "https://auth.example" }, homeDir }), null);
  // An old ~/.claude/.config.json is read instead of ~/.claude.json.
  await fs.mkdir(path.join(homeDir, ".claude"));
  await fs.writeFile(path.join(homeDir, ".claude", ".config.json"), "{}");
  assert.equal(await claudeGlobalConfigFile({ env: {}, homeDir }), null);
  assert.equal(await prepareClaudeTerminalConfig({ workspaceDir: path.join(homeDir, "w"), homeDir, env: {} }), false);
  await assert.rejects(fs.stat(path.join(homeDir, ".claude.json")), { code: "ENOENT" });
});

test("on Windows the folder key uses forward slashes, as Claude Code writes it", () => {
  assert.equal(claudeProjectKey("C:\\Users\\a\\.nextbrowser\\workspace", "win32"), "C:/Users/a/.nextbrowser/workspace");
  assert.equal(claudeProjectKey("/Users/a/.nextbrowser/workspace", "darwin"), "/Users/a/.nextbrowser/workspace");
});

test("projects in an unexpected shape are not touched", () => {
  assert.deepEqual(seededClaudeConfig({ projects: null }, "/w"), { projects: null, hasCompletedOnboarding: true, fullscreenUpsellSeenCount: 3 });
  assert.deepEqual(seededClaudeConfig({ hasCompletedOnboarding: true, fullscreenUpsellSeenCount: 3, projects: { "/w": "odd" } }, "/w"), null);
});
