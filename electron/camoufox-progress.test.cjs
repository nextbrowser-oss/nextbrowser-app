const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CAMOUFOX_FETCH_PROGRESS_SCRIPT, camoufoxProgressReader, stripCamoufoxProgress } = require("./camoufox-progress.cjs");
const prefix = "NBC_CAMOUFOX_PROGRESS ";

test("progress records do not obscure a real download failure", () => {
  assert.equal(stripCamoufoxProgress(prefix + '{"phase":"downloading"}\nNetwork timeout\n'), "Network timeout\n");
});

test("progress accepts split records and reports real bytes, with indeterminate fallback", () => {
  const updates = [];
  const read = camoufoxProgressReader((update) => updates.push(update));
  const first = prefix + JSON.stringify({ phase: "downloading", receivedBytes: 25, totalBytes: 100 }) + "\n";
  read(first.slice(0, 13)); read(first.slice(13));
  read(prefix + JSON.stringify({ phase: "downloading", receivedBytes: 10, totalBytes: 0 }) + "\n");
  read(prefix + JSON.stringify({ phase: "installing" }) + "\n");
  assert.deepEqual(updates.map((update) => update.percent), [25, undefined, undefined]);
  assert.equal(updates[0].receivedBytes, 25);
  assert.equal(updates[0].totalBytes, 100);
  assert.equal(updates[2].phase, "installing");
  assert.equal(updates[2].receivedBytes, undefined);
});

test("unrelated output and malformed or unbounded data do not become progress", () => {
  const updates = [];
  const read = camoufoxProgressReader((update) => updates.push(update));
  read("Package installed\n" + prefix + "null\n" + prefix + "bad json\n" + prefix + JSON.stringify({ phase: "secret", percent: 99 }) + "\n");
  read(prefix + JSON.stringify({ phase: "downloading", receivedBytes: -1, totalBytes: Infinity, raw: "ignored" }) + "\n");
  assert.equal(updates.length, 1);
  assert.equal(updates[0].percent, undefined);
  assert.equal(updates[0].raw, undefined);
});

const python = [process.env.PYTHON_BIN, "python3", "python"].filter(Boolean).find((file) => spawnSync(file, ["--version"], { windowsHide: true }).status === 0);
for (const callback of [true, false]) test(`actual Python bridge preserves the fetch command (${callback ? "download callback" : "older package fallback"})`, { skip: !python }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nextbrowser-camoufox-progress-"));
  try {
    fs.mkdirSync(path.join(root, "camoufox"));
    fs.writeFileSync(path.join(root, "camoufox", "__init__.py"), "");
    fs.writeFileSync(path.join(root, "camoufox", "pkgman.py"), callback
      ? "def webdl(url, progress_callback=None):\n    progress_callback(50, 100)\n    progress_callback(100, 100)\n    return 'verified-download'\n"
      : "def webdl(url):\n    return 'verified-download'\n");
    fs.writeFileSync(path.join(root, "camoufox", "__main__.py"), "import sys\nfrom .pkgman import webdl\nassert sys.argv == ['camoufox','fetch']\nassert webdl('https://fixture.example/browser') == 'verified-download'\n");
    const result = spawnSync(python, ["-u", "-c", CAMOUFOX_FETCH_PROGRESS_SCRIPT], { cwd: root, windowsHide: true, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const updates = [];
    camoufoxProgressReader((update) => updates.push(update))(result.stderr);
    assert.equal(updates[0].phase, "downloading");
    assert.equal(updates.at(-1).phase, "installing");
    if (callback) assert.ok(updates.some((update) => update.percent === 100));
    else assert.ok(updates.every((update) => update.percent === undefined));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
