// nextctl release asset for this machine. Releases ship macOS builds for Apple
// silicon only (nbc-macos-arm64); there is no nbc-macos-amd64.
const INTEL_MAC_UNSUPPORTED =
  "Nextbrowser needs a Mac with Apple silicon. nextctl is not built for Intel Macs.";

/**
 * @param {{ platform: string, arch: string, translated?: boolean }} host
 *   translated is true when this process runs under Rosetta on Apple silicon.
 */
function nextctlPlatformArchive({ platform, arch, translated = false }) {
  if (platform === "darwin") {
    // An x64 build under Rosetta still runs on Apple silicon, where the arm64
    // nextctl runs natively. A real Intel Mac has no matching build.
    if (arch === "arm64" || (arch === "x64" && translated)) return { name: "nbc-macos-arm64.tar.gz", kind: "tar" };
    if (arch === "x64") throw new Error(INTEL_MAC_UNSUPPORTED);
  }
  if (platform === "linux") {
    if (arch === "arm64") return { name: "nbc-linux-arm64.tar.gz", kind: "tar" };
    if (arch === "x64") return { name: "nbc-linux-amd64.tar.gz", kind: "tar" };
  }
  if (platform === "win32" && arch === "x64") return { name: "nbc-win-amd64.zip", kind: "zip" };
  throw new Error(`Unsupported nextctl platform: ${platform}/${arch}`);
}

/** True when this macOS process is an x64 build translated by Rosetta. */
function runningUnderRosetta(execFileSync) {
  try {
    return String(execFileSync("sysctl", ["-in", "sysctl.proc_translated"], { encoding: "utf8", timeout: 2000 })).trim() === "1";
  } catch {
    return false;
  }
}

module.exports = { INTEL_MAC_UNSUPPORTED, nextctlPlatformArchive, runningUnderRosetta };
