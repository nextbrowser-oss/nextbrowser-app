// Builds the Python environment (venv) the Camoufox runtime runs in, the
// same way nbc does (nextctl cmd/nbc/camoufox_runtime.go).
//
// A Python's own "success" is not enough. On Windows the Microsoft Store
// Python runs as a packaged app, and Windows redirects what it creates under
// AppData to that app's private folder: its `python -m venv` exits 0, but the
// venv is invisible to everyone else, so Scripts\python.exe "cannot be found".
// So a Store Python is never used, and a venv counts only once its own
// interpreter exists and starts. Without a usable Python, uv downloads its
// own Python 3.13 (only-managed: uv must not fall back to the same system
// Python).

// Prints where the interpreter really lives (the py launcher and the Store's
// aliases are only stubs) and exits 0 only for Python 3.11–3.13.
const CAMOUFOX_PYTHON_PROBE = "import sys; print('executable=' + sys.executable); print('prefix=' + sys.base_prefix); raise SystemExit(0 if (3, 11) <= sys.version_info[:2] < (3, 14) else 1)";

function camoufoxPythonCandidates(platform) {
  const candidates = [["python3.13"], ["python3.12"], ["python3.11"], ["python3"]];
  if (platform === "win32") candidates.push(["python"], ["py", "-3.13"], ["py", "-3.12"], ["py", "-3.11"]);
  return candidates;
}

function parseCamoufoxPythonProbe(stdout) {
  let executable = "";
  let prefix = "";
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const text = line.trim();
    if (text.startsWith("executable=")) executable = text.slice("executable=".length);
    else if (text.startsWith("prefix=")) prefix = text.slice("prefix=".length);
  }
  return { executable, prefix };
}

/** True for a path inside a Microsoft Store app, where the Store's Python lives. */
function isWindowsStorePython(file) {
  return String(file || "").replace(/\//g, "\\").toLowerCase().includes("\\windowsapps\\");
}

/** A failure the user fixes by installing Python (nbc's CAMOUFOX_PYTHON_MISSING). */
class CamoufoxPythonMissingError extends Error {
  constructor(causes) {
    super(`CAMOUFOX_PYTHON_MISSING: Camoufox needs Python 3.11–3.13, and it could not be downloaded automatically. Install Python 3.13 from https://www.python.org/downloads/ (on Windows, not the Microsoft Store version), or check that this computer can reach github.com, then try again. (${causes.join("; ")})`);
    this.name = "CamoufoxPythonMissingError";
    this.code = "CAMOUFOX_PYTHON_MISSING";
  }
}

function outputOf(result) {
  return String(result?.stderr || result?.stdout || "").trim().slice(0, 300);
}

/**
 * Creates the venv whose interpreter is `venvPython`, replacing whatever is
 * at `venv`. Programs are reached only through the arguments, so tests can
 * play a Windows machine with a Store Python or no network.
 *
 * run(file, args, { timeoutMs }) resolves to { code, stdout, stderr };
 * exists(file) tells whether a file is there; remove(dir) deletes a folder;
 * uvVenv(args) downloads uv if needed and runs it with these arguments.
 */
async function createCamoufoxVenv({ platform, venv, venvPython, run, exists, remove, uvVenv }) {
  const causes = [];
  const interpreterRuns = async () => {
    if (!(await exists(venvPython))) return false;
    const result = await run(venvPython, ["-c", CAMOUFOX_PYTHON_PROBE], { timeoutMs: 30_000 }).catch(() => null);
    return result?.code === 0;
  };
  // A venv-making command counts only when its interpreter starts.
  const makeVenv = async (label, attempt) => {
    const result = await attempt().catch((error) => ({ code: -1, stderr: String(error?.message || error) }));
    if (result.code === 0 && await interpreterRuns()) return true;
    causes.push(result.code === 0
      ? `${label} created a venv, but ${venvPython} is missing or does not start`
      : `create a venv with ${label}: ${outputOf(result) || `exit ${result.code}`}`);
    await remove(venv);
    return false;
  };

  await remove(venv);
  let skippedStore = false;
  let base = "";
  for (const [command, ...prefixArgs] of camoufoxPythonCandidates(platform)) {
    const probe = await run(command, [...prefixArgs, "-c", CAMOUFOX_PYTHON_PROBE], { timeoutMs: 30_000 }).catch(() => null);
    if (!probe || probe.code !== 0) continue;
    const { executable, prefix } = parseCamoufoxPythonProbe(probe.stdout);
    if (!executable) continue;
    if (platform === "win32" && (isWindowsStorePython(executable) || isWindowsStorePython(prefix))) {
      skippedStore = true;
      continue;
    }
    base = executable;
    break;
  }
  if (base) {
    if (await makeVenv(base, () => run(base, ["-m", "venv", venv], { timeoutMs: 120_000 }))) return;
  } else {
    causes.push(skippedStore
      ? "only a Microsoft Store Python 3.11–3.13 is installed, and a venv it creates cannot be used"
      : "Python 3.11–3.13 is not installed");
  }
  if (await makeVenv("uv", () => uvVenv(["venv", "--seed", "--python", "3.13", "--python-preference", "only-managed", venv]))) return;
  throw new CamoufoxPythonMissingError(causes);
}

module.exports = {
  CAMOUFOX_PYTHON_PROBE,
  CamoufoxPythonMissingError,
  camoufoxPythonCandidates,
  createCamoufoxVenv,
  isWindowsStorePython,
  parseCamoufoxPythonProbe,
};
