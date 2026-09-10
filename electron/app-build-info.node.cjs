const assert = require("node:assert/strict");
const test = require("node:test");
const { feedbackBuildContext, sourceRevision } = require("./app-build-info.cjs");

test("reports the installed release version without an internal packaged flag", () => {
  const result = feedbackBuildContext({
    app: { isPackaged: true, getVersion: () => "0.2.44", getAppPath: () => "/app" },
    execFileSync: () => { throw new Error("must not read git for releases"); },
  });
  assert.deepEqual(result, { app_version: "0.2.44", build: "release" });
});

test("identifies a development build by its source revision instead of package.json version", () => {
  const result = feedbackBuildContext({
    app: { isPackaged: false, getVersion: () => "0.1.13", getAppPath: () => "/repo" },
    execFileSync: () => "166f50f12345\n",
  });
  assert.deepEqual(result, { app_version: "development-166f50f12345", build: "development" });
});

test("keeps an unresolvable development checkout understandable", () => {
  assert.equal(sourceRevision("/repo", () => { throw new Error("no git"); }), undefined);
  const result = feedbackBuildContext({
    app: { isPackaged: false, getVersion: () => "0.1.13", getAppPath: () => "/repo" },
    execFileSync: () => { throw new Error("no git"); },
  });
  assert.deepEqual(result, { app_version: "development", build: "development" });
});
