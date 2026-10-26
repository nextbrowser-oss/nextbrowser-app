const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CamoufoxPythonMissingError,
  createCamoufoxVenv,
  isWindowsStorePython,
  parseCamoufoxPythonProbe,
} = require("./camoufox-python.cjs");

const VENV = "C:\\Users\\a\\AppData\\Roaming\\nextbrowser\\runtime\\sessions\\_camoufox\\venv";
const VENV_PYTHON = `${VENV}\\Scripts\\python.exe`;
const STORE = "C:\\Users\\a\\AppData\\Local\\Microsoft\\WindowsApps\\PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0\\python.exe";
const STORE_PREFIX = "C:\\Program Files\\WindowsApps\\PythonSoftwareFoundation.Python.3.13_3.13.2032.0_x64__qbz5n2kfra8p0";
const PYTHON_ORG = "C:\\Users\\a\\AppData\\Local\\Programs\\Python\\Python313\\python.exe";

// A Windows machine: `pythons` maps a command to the interpreter it really
// runs; `venvWorks` says whether a venv that interpreter makes is visible.
function machine({ pythons = {}, venvWorks = {}, uv = "works" } = {}) {
  const calls = [];
  let venvBuiltBy = "";
  const probe = (executable) => {
    const prefix = executable === STORE ? STORE_PREFIX : executable.replace(/\\python\.exe$/, "");
    return { code: 0, stdout: `executable=${executable}\r\nprefix=${prefix}\r\n`, stderr: "" };
  };
  return {
    calls,
    removed: () => calls.filter(([kind]) => kind === "remove").length,
    options: {
      platform: "win32",
      venv: VENV,
      venvPython: VENV_PYTHON,
      run: async (file, args) => {
        calls.push(["run", file, ...args]);
        if (file === VENV_PYTHON) return venvBuiltBy ? probe(VENV_PYTHON) : { code: -1, stdout: "", stderr: "spawn ENOENT" };
        const executable = pythons[[file, ...args.slice(0, args.indexOf("-c") >= 0 ? args.indexOf("-c") : 0)].join(" ")];
        if (args.includes("-c")) return executable ? probe(executable) : { code: -1, stdout: "", stderr: "spawn ENOENT" };
        if (args[0] === "-m" && args[1] === "venv") {
          if (venvWorks[file]) venvBuiltBy = file;
          return { code: 0, stdout: "", stderr: "" };
        }
        throw new Error(`unexpected ${file} ${args.join(" ")}`);
      },
      exists: async (file) => file === VENV_PYTHON && !!venvBuiltBy,
      remove: async (dir) => { calls.push(["remove", dir]); venvBuiltBy = ""; },
      uvVenv: async (args) => {
        calls.push(["uv", ...args]);
        if (uv === "fails") return { code: 2, stdout: "", stderr: "error: Failed to download https://github.com/astral-sh/python-build-standalone: fetch failed" };
        venvBuiltBy = "uv";
        return { code: 0, stdout: "", stderr: "" };
      },
    },
  };
}

test("a Microsoft Store Python is never used; uv provides Python 3.13 instead", async () => {
  // The Store's `python3.13 -m venv` exits 0 but writes where nbc cannot see it.
  const m = machine({ pythons: { "python3.13": STORE, python: STORE }, venvWorks: { [STORE]: true } });
  await createCamoufoxVenv(m.options);
  assert.ok(!m.calls.some(([kind, file, ...args]) => kind === "run" && args[0] === "-m" && args[1] === "venv"), "no venv from a Store Python");
  assert.deepEqual(m.calls.find(([kind]) => kind === "uv"), ["uv", "venv", "--seed", "--python", "3.13", "--python-preference", "only-managed", VENV]);
});

test("a python.org Python found through the py launcher builds the venv from its real interpreter", async () => {
  const m = machine({ pythons: { "python3.13": STORE, "py -3.13": PYTHON_ORG }, venvWorks: { [PYTHON_ORG]: true } });
  await createCamoufoxVenv(m.options);
  assert.ok(m.calls.some(([kind, file, ...args]) => kind === "run" && file === PYTHON_ORG && args.join(" ") === `-m venv ${VENV}`));
  assert.equal(m.calls.some(([kind]) => kind === "uv"), false);
});

test("a venv whose interpreter is missing after a successful exit is replaced through uv", async () => {
  const m = machine({ pythons: { python: PYTHON_ORG }, venvWorks: { [PYTHON_ORG]: false } });
  await createCamoufoxVenv(m.options);
  assert.ok(m.calls.some(([kind]) => kind === "uv"));
  // The leftover venv, then the invisible one, were removed before uv ran.
  assert.equal(m.removed(), 2);
});

test("no usable Python and no download is CAMOUFOX_PYTHON_MISSING, naming each cause", async () => {
  const m = machine({ pythons: { "python3.13": STORE }, uv: "fails" });
  await assert.rejects(createCamoufoxVenv(m.options), (error) => {
    assert.ok(error instanceof CamoufoxPythonMissingError);
    assert.equal(error.code, "CAMOUFOX_PYTHON_MISSING");
    assert.match(error.message, /^CAMOUFOX_PYTHON_MISSING: Camoufox needs Python 3\.11–3\.13/);
    assert.match(error.message, /not the Microsoft Store version/);
    assert.match(error.message, /only a Microsoft Store Python 3\.11–3\.13 is installed/);
    assert.match(error.message, /create a venv with uv: error: Failed to download/);
    return true;
  });
});

test("Store paths and the probe output are recognized", () => {
  assert.equal(isWindowsStorePython(STORE), true);
  assert.equal(isWindowsStorePython(STORE_PREFIX.replace(/\\/g, "/")), true);
  assert.equal(isWindowsStorePython(PYTHON_ORG), false);
  assert.deepEqual(parseCamoufoxPythonProbe(`executable=${PYTHON_ORG}\r\nprefix=C:\\Python313\r\n`), { executable: PYTHON_ORG, prefix: "C:\\Python313" });
});
