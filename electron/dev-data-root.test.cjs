const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { devDataPaths } = require("./dev-data-root.cjs");
const homeDir = path.resolve("test-home");
const root = path.join(homeDir, "qa-dedicated");

test("default storage is unchanged with no development override", () => {
  for (const isPackaged of [true, false]) {
    assert.equal(devDataPaths({ env: {}, isPackaged, homeDir }), null);
  }
});
test("development app, runtime and CLI share a dedicated root", () => {
  assert.deepEqual(devDataPaths({ env: { NEXTBROWSER_DEV_DATA_ROOT: root }, isPackaged: false, homeDir }), {
    userData: path.join(root, "app"), runtime: path.join(root, "runtime"), nextctl: path.join(root, "managed-nextctl"),
  });
});
test("rejects packaged, relative, empty and broad paths", () => {
  const resolve = (value, isPackaged = false) => devDataPaths({ env: { NEXTBROWSER_DEV_DATA_ROOT: value }, isPackaged, homeDir });
  for (const value of ["", "relative", homeDir, path.parse(root).root, path.join(homeDir, ".nextbrowser")]) {
    assert.throws(() => resolve(value));
  }
  assert.throws(() => resolve(root, true));
});
test("main wires isolated roots before lock and skips real-data migration and protocol changes", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  assert.ok(main.indexOf('app.setPath("userData", devStorage.userData)') < main.indexOf("app.requestSingleInstanceLock()"));
  assert.match(main, /function nextbrowserRuntimeRoot\(\) \{\s*if \(devStorage\) return devStorage.runtime;/);
  assert.match(main, /function managedNextctlRoot\(\) \{\s*if \(devStorage\) return devStorage.nextctl;/);
  for (const name of ["migrateLegacyData", "migrateLegacyRuntimeConfig"]) {
    assert.match(main, new RegExp(`async function ${name}\\(\\) \\{\\s*if \\(devStorage\\) return;`));
  }
  assert.match(main, /if \(devStorage\) \{\s*\/\/ Isolated QA[^\n]*\n\s*\} else if \(!app.isPackaged\)/);
});
