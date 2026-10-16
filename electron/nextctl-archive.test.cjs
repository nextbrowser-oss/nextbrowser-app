const { test } = require("node:test");
const assert = require("node:assert/strict");
const { INTEL_MAC_UNSUPPORTED, nextctlPlatformArchive, runningUnderRosetta } = require("./nextctl-archive.cjs");

test("never asks for a macOS amd64 nextctl, which releases do not ship", () => {
  assert.equal(nextctlPlatformArchive({ platform: "darwin", arch: "arm64" }).name, "nbc-macos-arm64.tar.gz");
  assert.equal(nextctlPlatformArchive({ platform: "darwin", arch: "x64", translated: true }).name, "nbc-macos-arm64.tar.gz");
  assert.throws(() => nextctlPlatformArchive({ platform: "darwin", arch: "x64" }), { message: INTEL_MAC_UNSUPPORTED });
});

test("keeps the Linux and Windows assets", () => {
  assert.deepEqual(nextctlPlatformArchive({ platform: "linux", arch: "x64" }), { name: "nbc-linux-amd64.tar.gz", kind: "tar" });
  assert.deepEqual(nextctlPlatformArchive({ platform: "linux", arch: "arm64" }), { name: "nbc-linux-arm64.tar.gz", kind: "tar" });
  assert.deepEqual(nextctlPlatformArchive({ platform: "win32", arch: "x64" }), { name: "nbc-win-amd64.zip", kind: "zip" });
  assert.throws(() => nextctlPlatformArchive({ platform: "win32", arch: "arm64" }), /Unsupported nextctl platform: win32\/arm64/);
});

test("reads Rosetta translation from sysctl and treats any failure as native", () => {
  assert.equal(runningUnderRosetta(() => "1\n"), true);
  assert.equal(runningUnderRosetta(() => "0\n"), false);
  assert.equal(runningUnderRosetta(() => { throw new Error("unknown oid"); }), false);
});
