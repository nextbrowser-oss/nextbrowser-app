const assert = require("node:assert/strict");
const test = require("node:test");
const { isAgentIntegrationInstall, nbcInstallBinDir, nbcVersion, newerNbcAtInstallTarget } = require("./nbc-install-guard.cjs");

const WINDOWS = { platform: "win32", homeDir: "C:\\Users\\a", env: { LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" } };
const APP_NBC = "C:\\Users\\a\\AppData\\Roaming\\nextbrowser\\managed-nextctl\\nextctl.exe";
const PATH_NBC = "C:\\Users\\a\\AppData\\Local\\Clawbrowser\\bin\\nbc.exe";

function guard(versions, present = [PATH_NBC]) {
  const read = [];
  return {
    read,
    run: () => newerNbcAtInstallTarget({
      ...WINDOWS,
      appBinary: APP_NBC,
      exists: async (file) => present.includes(file),
      readVersion: async (binary) => { read.push(binary); return versions[binary] ?? "version unavailable"; },
    }),
  };
}

test("an older app nbc does not replace a newer nbc on PATH", async () => {
  const check = guard({ [PATH_NBC]: "nbc v1.2.37", [APP_NBC]: "nbc v1.2.35" });
  assert.deepEqual(await check.run(), { target: PATH_NBC, installed: "1.2.37", own: "1.2.35" });
});

test("the install goes ahead for an equal or older nbc, an unreadable one, or none", async () => {
  assert.equal(await guard({ [PATH_NBC]: "nbc v1.2.37", [APP_NBC]: "nbc v1.2.37" }).run(), undefined);
  assert.equal(await guard({ [PATH_NBC]: "nbc v1.2.35", [APP_NBC]: "nbc v1.2.37" }).run(), undefined);
  assert.equal(await guard({ [PATH_NBC]: "nbc v1.2.37-rc1", [APP_NBC]: "nbc v1.2.37" }).run(), undefined, "a pre-release suffix is ignored");
  assert.equal(await guard({ [APP_NBC]: "nbc v1.2.35" }).run(), undefined, "an nbc too old to answer --version");
  assert.equal(await guard({ [APP_NBC]: "nbc dev", [PATH_NBC]: "nbc v1.2.37" }).run(), undefined, "a development build");
  const absent = guard({ [APP_NBC]: "nbc v1.2.35" }, []);
  assert.equal(await absent.run(), undefined);
  assert.deepEqual(absent.read, [], "nothing to ask when nothing is installed");
});

test("the install target follows nbc's own default and CLAWBROWSER_BIN_DIR", () => {
  assert.equal(nbcInstallBinDir(WINDOWS), "C:\\Users\\a\\AppData\\Local\\Clawbrowser\\bin");
  assert.equal(nbcInstallBinDir({ platform: "win32", homeDir: "C:\\Users\\a", env: {} }), "C:\\Users\\a\\AppData\\Local\\Clawbrowser\\bin");
  assert.equal(nbcInstallBinDir({ platform: "darwin", homeDir: "/Users/a", env: {} }), "/Users/a/.local/bin");
  assert.equal(nbcInstallBinDir({ platform: "darwin", homeDir: "/Users/a", env: { CLAWBROWSER_BIN_DIR: "/opt/nbc" } }), "/opt/nbc");
  assert.equal(nbcVersion("version unavailable"), null);
  assert.deepEqual(nbcVersion("nextctl 1.10.2"), [1, 10, 2]);
});

test("only the agent integration install without its own bin directory is checked", () => {
  assert.equal(isAgentIntegrationInstall(["install", "--agent", "codex", "--no-api-key-prompt"]), true);
  assert.equal(isAgentIntegrationInstall(["install", "--agent=claude-code"]), true);
  assert.equal(isAgentIntegrationInstall(["install", "generic", "--bin-dir", "/runtime/installer-bin", "--format", "json"]), false);
  assert.equal(isAgentIntegrationInstall(["install", "--agent", "codex", "--bin-dir=/x"]), false);
  assert.equal(isAgentIntegrationInstall(["update"]), false);
  assert.equal(isAgentIntegrationInstall(undefined), false);
});
