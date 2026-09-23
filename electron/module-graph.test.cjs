const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// A relative require that points at a deleted file only fails when Electron
// loads the module, so packaging and every unit test still pass while the
// released app dies at startup. Resolve the specifiers statically instead.
function relativeRequires(source) {
  return [...source.matchAll(/require\(\s*["'](\.[^"']+)["']\s*\)/g)].map((match) => match[1]);
}

test("every relative require in the main process resolves", () => {
  const unresolved = [];
  for (const name of fs.readdirSync(__dirname).filter((file) => file.endsWith(".cjs"))) {
    for (const specifier of relativeRequires(fs.readFileSync(path.join(__dirname, name), "utf8"))) {
      try {
        require.resolve(path.resolve(__dirname, specifier));
      } catch {
        unresolved.push(`${name} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(unresolved, [], `unresolvable requires: ${unresolved.join(", ")}`);
});

test("the packaged entry point is a real file", () => {
  const { main } = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.ok(main, "package.json must declare an Electron entry point");
  assert.ok(fs.existsSync(path.join(__dirname, "..", main)), `missing entry point: ${main}`);
});
