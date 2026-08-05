const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { expand, launchable, resolveBinary } = require("./binary-resolver.cjs");

function executable(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "#!/bin/sh\n");
  fs.chmodSync(file, 0o755);
  return file;
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nextbrowser-binary-resolver-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("prefers an explicit Codex override", (t) => {
  const root = fixture(t);
  const configured = executable(path.join(root, "configured", "codex"));
  executable(path.join(root, "ChatGPT.app", "Contents", "Resources", "codex"));
  executable(path.join(root, "bin", "codex"));

  assert.equal(resolveBinary("codex", "CODEX_BIN", {
    platform: "darwin",
    homeDir: root,
    env: { CODEX_BIN: configured },
    fallbackRoots: [path.join(root, "ChatGPT.app", "Contents", "Resources")],
    searchPaths: [path.join(root, "bin")],
  }), configured);
});

test("prefers Codex bundled with the desktop app over a CLI", (t) => {
  const root = fixture(t);
  const appBinary = executable(path.join(root, "ChatGPT.app", "Contents", "Resources", "codex"));
  executable(path.join(root, "bin", "codex"));

  assert.equal(resolveBinary("codex", "CODEX_BIN", {
    platform: "darwin",
    homeDir: root,
    env: {},
    fallbackRoots: [path.join(root, "ChatGPT.app", "Contents", "Resources")],
    searchPaths: [path.join(root, "bin")],
  }), appBinary);
});

test("falls back to the Codex CLI when no desktop app binary exists", (t) => {
  const root = fixture(t);
  const cliBinary = executable(path.join(root, "bin", "codex"));

  assert.equal(resolveBinary("codex", "CODEX_BIN", {
    platform: "darwin",
    homeDir: root,
    env: {},
    fallbackRoots: [path.join(root, "missing-app")],
    searchPaths: [path.join(root, "bin")],
  }), cliBinary);
});

test("reports whether a binary can be launched", (t) => {
  const root = fixture(t);
  const binary = executable(path.join(root, "bin", "nbc"));

  assert.equal(launchable(binary, "darwin"), true);
  assert.equal(launchable(path.join(root, "missing"), "darwin"), false);
});

test("expands a home-relative binary override", () => {
  assert.equal(expand("~/bin/nbc", "/tmp/demo-home"), path.join("/tmp/demo-home", "bin/nbc"));
});
