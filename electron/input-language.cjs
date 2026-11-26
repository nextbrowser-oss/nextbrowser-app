const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);

// Read the input source once at launch or when the user selects Automatic.
async function inputLanguages({ platform, helper, windowHandle, preferredLanguages, run = execute }) {
  const fallback = preferredLanguages();
  if (platform !== "win32" && platform !== "darwin") return fallback;
  try {
    const args = platform === "win32" ? ["--input-language", windowHandle || "0"] : [];
    const { stdout } = await run(helper, args, { windowsHide: true, timeout: 1500, maxBuffer: 1024 });
    const tag = stdout.trim();
    return /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(tag) ? [tag, ...fallback] : fallback;
  } catch {
    return fallback;
  }
}
module.exports = { inputLanguages };
