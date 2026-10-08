async function requireVerificationCapableCLI(binary, run) {
  if (!binary) throw new Error("VERIFY_REQUIRED: Nextbrowser CLI is unavailable.");
  // Parse both safety flags without executing version's authenticated pre-run.
  // Otherwise a fresh install cannot pass this check in order to sign in.
  const result = await run(binary, ["--verify-on-start-only", "--proxy-safety-file", "", "version", "--help"], {}, { timeoutMs: 5000 });
  if (result.code !== 0) throw new Error("VERIFY_REQUIRED: Update the Nextbrowser CLI. This version cannot enforce mandatory browser verification.");
}
module.exports = { requireVerificationCapableCLI };

const SUPPORT_BUTTON = "Get help in Discord";

function verificationFailureDialogOptions({ failedSurfaces, proxyExpected = true, attempts = 0 } = {}) {
  const surfaces = Array.isArray(failedSurfaces) ? failedSurfaces.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 8) : [];
  const offerDirect = proxyExpected && attempts === 3;
  return {
    type: "warning",
    title: "Browser verification failed",
    message: proxyExpected ? "This profile couldn’t connect through its proxy." : "The browser didn’t pass its safety check.",
    detail: [
      offerDirect
        ? "Three attempts with the same proxy failed. The profile is stopped. Continue in a separate session without a proxy? Websites will see your real IP. The original proxy profile and its browser data will not be transferred or changed."
        : proxyExpected
        ? "The browser was stopped so it never runs without its proxy. This is a problem on our side, not with your setup. Message us in Discord and we’ll sort it out."
        : "The browser was stopped before any action ran. This is a problem on our side, not with your setup. Message us in Discord and we’ll sort it out.",
      // Support reads this line off a screenshot; it names what failed.
      surfaces.length ? `Failed checks: ${surfaces.join(", ")}.` : "",
    ].filter(Boolean).join("\n\n"),
    buttons: offerDirect ? ["Cancel", "Continue without proxy", SUPPORT_BUTTON] : ["Cancel", SUPPORT_BUTTON],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
}
function verificationFailureDialogChoice(proxyExpected, response, attempts) {
  const offerDirect = proxyExpected !== false && attempts === 3;
  if (offerDirect && response === 1) return "direct";
  if (response === (offerDirect ? 2 : 1)) return "support";
  return "cancel";
}
module.exports.verificationFailureDialogOptions = verificationFailureDialogOptions;
module.exports.verificationFailureDialogChoice = verificationFailureDialogChoice;
