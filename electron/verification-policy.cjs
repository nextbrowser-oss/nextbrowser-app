async function requireVerificationCapableCLI(binary, run) {
  if (!binary) throw new Error("VERIFY_REQUIRED: NextBrowser CLI is unavailable.");
  const result = await run(binary, ["--require-verify", "--proxy-safety-file", "", "version"], {}, { timeoutMs: 5000 });
  if (result.code !== 0) throw new Error("VERIFY_REQUIRED: Update the NextBrowser CLI. This version cannot enforce mandatory browser verification.");
}
module.exports = { requireVerificationCapableCLI };

function verificationFailureDialogOptions({ failedSurfaces, proxyExpected = true, attempts = 0 } = {}) {
  const surfaces = Array.isArray(failedSurfaces) ? failedSurfaces.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 8) : [];
  return {
    type: "warning",
    title: "Browser verification failed",
    message: proxyExpected ? "Sorry, the proxy is not working." : "The browser has not passed verification.",
    detail: [
      surfaces.length ? `Failed checks: ${surfaces.join(", ")}.` : "The browser verification did not complete successfully.",
      proxyExpected && attempts === 3
        ? "Three attempts with the same proxy failed. The profile is stopped. Continue in a separate session without a proxy? Websites will see your real IP. The original proxy profile and its browser data will not be transferred or changed."
        : proxyExpected
        ? "The profile is stopped. You can retry after fixing the proxy."
        : "The browser was stopped because verification failed. No browser actions were allowed.",
    ].join("\n\n"),
    buttons: proxyExpected && attempts === 3 ? ["Cancel", "Continue without proxy"] : ["Cancel"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
}
function verificationFailureDialogChoice(proxyExpected, response, attempts) {
  return proxyExpected !== false && attempts === 3 && response === 1 ? "direct" : "cancel";
}
module.exports.verificationFailureDialogOptions = verificationFailureDialogOptions;
module.exports.verificationFailureDialogChoice = verificationFailureDialogChoice;
