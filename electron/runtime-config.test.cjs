const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  legacyConfigPath,
  legacyStateRoot,
  planRuntimeMigration,
  applyLegacyRuntimeMigration,
} = require("./runtime-config.cjs");

const homeDir = "/home/u";
const runtimeRoot = "/data/NextBrowser/runtime";
const isolatedConfig = path.join(runtimeRoot, "config", "config.json");
const legacyConfig = "/home/u/.config/clawbrowser/config.json";
const legacyProfiles = "/home/u/.local/state/clawbrowser/profiles";
const legacyProxies = "/home/u/.local/state/clawbrowser/profile-proxies";

function plan(files) {
  return planRuntimeMigration({
    runtimeRoot,
    homeDir,
    platform: "linux",
    env: {},
    exists: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFile: (p) => {
      if (!(p in files)) throw new Error(`missing ${p}`);
      return files[p];
    },
  });
}

const nbKey = JSON.stringify({ api_key: "nb_live_abc123", theme: "dark" });

test("migrates config + profile metadata, with config.json copied last", () => {
  const steps = plan({ [legacyConfig]: nbKey, [legacyProfiles]: "", [legacyProxies]: "" });
  assert.deepEqual(steps, [
    { kind: "dir", from: legacyProfiles, to: path.join(runtimeRoot, "profiles", "profiles") },
    { kind: "dir", from: legacyProxies, to: path.join(runtimeRoot, "profiles", "profile-proxies") },
    { kind: "file", from: legacyConfig, to: isolatedConfig },
  ]);
});

test("migrates only the config when there are no legacy profiles", () => {
  const steps = plan({ [legacyConfig]: nbKey });
  assert.deepEqual(steps, [{ kind: "file", from: legacyConfig, to: isolatedConfig }]);
});

test("no-op once the isolated config already exists", () => {
  assert.deepEqual(plan({ [legacyConfig]: nbKey, [isolatedConfig]: nbKey, [legacyProfiles]: "" }), []);
});

test("no-op when there is no legacy config", () => {
  assert.deepEqual(plan({}), []);
});

test("does not import a non-NextBrowser (e.g. Clawbrowser) key or its profiles", () => {
  const steps = plan({ [legacyConfig]: JSON.stringify({ api_key: "claw_live_xyz" }), [legacyProfiles]: "" });
  assert.deepEqual(steps, []);
});

test("ignores a malformed legacy config instead of throwing", () => {
  assert.deepEqual(plan({ [legacyConfig]: "{not json" }), []);
});

test("never overwrites an already-migrated profile dir", () => {
  const steps = plan({
    [legacyConfig]: nbKey,
    [legacyProfiles]: "",
    [path.join(runtimeRoot, "profiles", "profiles")]: "",
  });
  // profiles/ already present -> skipped; profile-proxies absent -> skipped; config still migrates.
  assert.deepEqual(steps, [{ kind: "file", from: legacyConfig, to: isolatedConfig }]);
});

test("applies the migration against a real filesystem, then is a no-op", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nb-migrate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const homeDir = path.join(root, "home");
  const runtimeRoot = path.join(root, "userData", "runtime");
  const cfgDir = path.join(homeDir, ".config", "clawbrowser");
  const stateRoot = path.join(homeDir, ".local", "state", "clawbrowser");
  await fs.mkdir(cfgDir, { recursive: true });
  await fs.mkdir(path.join(stateRoot, "profiles"), { recursive: true });
  await fs.mkdir(path.join(stateRoot, "profile-proxies"), { recursive: true });
  await fs.writeFile(path.join(cfgDir, "config.json"), JSON.stringify({ api_key: "nb_live_key", theme: "dark" }));
  await fs.writeFile(path.join(stateRoot, "profiles", "work.json"), JSON.stringify({ name: "work", country: "US" }));
  await fs.writeFile(path.join(stateRoot, "profile-proxies", "work.json"), "{}");

  const opts = { runtimeRoot, homeDir, platform: "linux", env: {} };
  const first = await applyLegacyRuntimeMigration(opts);
  assert.equal(first.length, 3);

  const migratedConfig = path.join(runtimeRoot, "config", "config.json");
  assert.equal(
    JSON.parse(await fs.readFile(migratedConfig, "utf8")).api_key,
    "nb_live_key",
  );
  assert.ok(fsSync.existsSync(path.join(runtimeRoot, "profiles", "profiles", "work.json")));
  assert.ok(fsSync.existsSync(path.join(runtimeRoot, "profiles", "profile-proxies", "work.json")));
  assert.equal((await fs.stat(migratedConfig)).mode & 0o777, 0o600);

  // Second run: isolated config now exists -> nothing to do.
  const second = await applyLegacyRuntimeMigration(opts);
  assert.deepEqual(second, []);
});

test("legacyConfigPath and legacyStateRoot match nbc defaults", () => {
  assert.equal(legacyConfigPath({ homeDir, platform: "linux", env: {} }), legacyConfig);
  assert.equal(
    legacyConfigPath({ homeDir: "C:\\Users\\u", platform: "win32", env: { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" } }),
    path.join("C:\\Users\\u\\AppData\\Local", "Clawbrowser", "config.json"),
  );
  assert.equal(legacyStateRoot({ homeDir, env: {} }), "/home/u/.local/state/clawbrowser");
  assert.equal(legacyStateRoot({ homeDir, env: { XDG_STATE_HOME: "/xdg/state" } }), "/xdg/state/clawbrowser");
});
