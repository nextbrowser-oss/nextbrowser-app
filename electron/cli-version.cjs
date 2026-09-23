// Version is informational; compatibility is enforced separately by the safety
// capability probe. Older CLIs may require authentication for `version`.
async function readCLIVersion(binary, run) {
  for (const args of [["--version"], ["version"]]) {
    const result = await run(binary, args, {}, { timeoutMs: 5000 });
    const value = String(result.stdout || "").trim();
    if (result.code === 0 && /^(?:nbc|nextctl)\s+\S[^\r\n]*$/.test(value)) return value;
  }
  return "version unavailable";
}
module.exports = { readCLIVersion };
