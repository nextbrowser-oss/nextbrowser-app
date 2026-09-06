const fs = require("node:fs/promises");
const path = require("node:path");

const RUNTIME_UPDATE_SOURCES = Object.freeze([
  {
    runtime: "clawbrowser",
    name: "ClawBrowser",
    releasePage: "https://github.com/clawbrowser/clawbrowser/releases/latest",
  },
  {
    runtime: "camoufox",
    name: "Camoufox",
    releasePage: "https://pypi.org/project/camoufox/",
  },
  {
    runtime: "dasbrowser",
    name: "DasBrowser",
    releasePage: "https://www.dasbrowser.com/download",
  },
]);

function normalizeVersion(value) {
  return String(value || "").trim().replace(/^v/i, "");
}

function assertRuntimeReleaseVersion(value) {
  const version = normalizeVersion(value);
  if (!/^\d+(?:\.\d+){1,3}(?:[-+.][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("The update source returned an invalid version.");
  }
  return version;
}

function selectAvailableRuntimeUpdates(status, requestedRuntimes) {
  const requested = new Set(Array.isArray(requestedRuntimes) ? requestedRuntimes.map(String) : []);
  return (status?.runtimes || []).filter((runtime) => runtime.status === "available" && requested.has(runtime.runtime));
}

function conciseFailureMessage(error) {
  const message = String(error?.message || error || "The update process stopped unexpectedly.")
    .replace(/\s+/g, " ")
    .trim();
  return message.length > 240 ? `${message.slice(0, 237)}…` : message;
}

function classifyRuntimeUpdateFailure(error) {
  const message = conciseFailureMessage(error);
  const normalized = message.toLowerCase();
  if (/enospc|no space|disk full|not enough space/.test(normalized)) {
    return { code: "UPDATE_DISK_SPACE", category: "Not enough disk space", retryable: false, message, recovery: "Free up disk space, then try again." };
  }
  if (/eacces|eperm|permission denied|operation not permitted|administrator/.test(normalized)) {
    return { code: "UPDATE_PERMISSION", category: "Permission required", retryable: false, message, recovery: "Check that NextBrowser can write to its application data, then try again." };
  }
  if (/ebusy|locked|in use|already running|running browser|process.*running/.test(normalized)) {
    return { code: "UPDATE_RUNTIME_IN_USE", category: "Browser is still running", retryable: true, message, recovery: "Close this browser toolset completely, then retry." };
  }
  if (/timeout|timed out|fetch failed|network|econn|enotfound|eai_again|http\s*[45]\d\d|update source returned/.test(normalized)) {
    return { code: "UPDATE_NETWORK", category: "Connection problem", retryable: true, message, recovery: "Keep NextBrowser open and check your internet connection, then retry." };
  }
  if (/invalid version|signature verification|release did not contain|installed version is still|not available for/.test(normalized)) {
    return { code: "UPDATE_RELEASE_VALIDATION", category: "Release verification failed", retryable: false, message, recovery: "Use the official manual update page below, or try again after a newer release is published." };
  }
  return { code: "UPDATE_UNKNOWN", category: "Update could not finish", retryable: true, message, recovery: "Keep NextBrowser open, check disk space and your connection, then retry." };
}

function updateInstallMessage(completed, errors) {
  if (errors.length) {
    return completed.length
      ? "Some browser toolsets were updated, but others need attention."
      : "The browser toolset updates could not be installed.";
  }
  return `${completed.length === 1 ? "The browser toolset is" : "Browser toolsets are"} ready to use.`;
}

// Keep the multi-toolset update policy independent from Electron. This makes
// the important guarantee explicit: a failed runtime never prevents later,
// confirmed runtimes from being attempted.
async function installSelectedRuntimeUpdates({ requestedRuntimes, checkForUpdates, installRuntime, onStatus = () => {} }) {
  const fresh = await checkForUpdates();
  const updates = selectAvailableRuntimeUpdates(fresh, requestedRuntimes);
  if (!updates.length) {
    const result = {
      status: "failed",
      runtimes: [],
      completed: [],
      errors: [],
      progress: 100,
      message: "The selected browser toolsets are already up to date.",
    };
    onStatus(result);
    return result;
  }

  const runtimes = updates.map((runtime) => runtime.runtime);
  const completed = [];
  const errors = [];
  onStatus({
    status: "installing",
    runtimes,
    completed: [],
    errors: [],
    currentRuntime: updates[0].runtime,
    currentName: updates[0].name,
    currentVersion: updates[0].latestVersion,
    total: updates.length,
    progress: 0,
    message: "Downloading the confirmed updates in the background.",
  });

  for (let index = 0; index < updates.length; index += 1) {
    const update = updates[index];
    onStatus({
      status: "installing",
      runtimes,
      completed: [...completed],
      errors: [...errors],
      currentRuntime: update.runtime,
      currentName: update.name,
      currentVersion: update.latestVersion,
      total: updates.length,
      progress: Math.round((index / updates.length) * 100),
      message: `Installing ${update.name} ${update.latestVersion || "update"} in the background.`,
    });
    try {
      await installRuntime(update);
      completed.push(update.runtime);
    } catch (error) {
      errors.push({
        runtime: update.runtime,
        name: update.name,
        releasePage: update.releasePage,
        ...classifyRuntimeUpdateFailure(error),
      });
    }
  }

  // A transient refresh failure must not turn completed updates into a failed
  // operation. The next hourly check will refresh the available versions.
  await checkForUpdates().catch(() => undefined);
  const result = {
    status: errors.length ? (completed.length ? "partial" : "failed") : "ready",
    runtimes,
    completed,
    errors,
    currentRuntime: undefined,
    currentName: undefined,
    currentVersion: undefined,
    total: updates.length,
    progress: 100,
    message: updateInstallMessage(completed, errors),
  };
  onStatus(result);
  return result;
}

function clawbrowserReleaseAsset(platform, arch, version) {
  const release = assertRuntimeReleaseVersion(version);
  let assetName = "";
  let kind = "tar";
  if (platform === "darwin" && arch === "arm64") assetName = "clawbrowser-macos-arm64.tar.gz";
  else if (platform === "linux" && arch === "x64") assetName = "clawbrowser-linux-x64.tar.gz";
  else if (platform === "linux" && arch === "arm64") assetName = "clawbrowser-linux-arm64.tar.gz";
  else if (platform === "win32" && arch === "x64") {
    assetName = "clawbrowser-win-amd64.zip";
    kind = "zip";
  }
  if (!assetName) throw new Error(`ClawBrowser updates are not available for ${platform}/${arch}.`);
  return {
    assetName,
    kind,
    url: `https://github.com/clawbrowser/clawbrowser/releases/download/${release}/${assetName}`,
    version: release,
  };
}

async function installRuntimeUpdateWithVerification({ label, expectedVersion, attempts = 1, install, readInstalledVersion }) {
  const expected = assertRuntimeReleaseVersion(expectedVersion);
  let installed = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await install(attempt);
    installed = normalizeVersion(await readInstalledVersion());
    if (installed && compareVersions(installed, expected) >= 0) return installed;
  }
  throw new Error(`${label} ${expected} downloaded, but the installed runtime version is still ${installed || "unknown"}.`);
}

function parsedVersion(value) {
  const normalized = normalizeVersion(value);
  const withoutBuild = normalized.split("+", 1)[0];
  const dash = withoutBuild.indexOf("-");
  const core = dash >= 0 ? withoutBuild.slice(0, dash) : withoutBuild;
  const prerelease = dash >= 0 ? withoutBuild.slice(dash + 1).split(".").filter(Boolean) : [];
  return {
    core: core.split(".").map((part) => Number.parseInt(part, 10) || 0),
    prerelease,
  };
}

function compareVersions(left, right) {
  const a = parsedVersion(left);
  const b = parsedVersion(right);
  const length = Math.max(a.core.length, b.core.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a.core[index] || 0) - (b.core[index] || 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  if (!a.prerelease.length && b.prerelease.length) return 1;
  if (a.prerelease.length && !b.prerelease.length) return -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber > rightNumber ? 1 : -1;
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

async function readJSON(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function installedClawbrowserVersion(runtimeRoot) {
  const metadata = await readJSON(path.join(runtimeRoot, "data", ".clawbrowser-browser-release.json"));
  return normalizeVersion(metadata?.version);
}

async function installedCamoufoxVersion(runtimeRoot) {
  const venv = path.join(runtimeRoot, "sessions", "_camoufox", "venv");
  const candidates = [path.join(venv, "Lib", "site-packages")];
  try {
    const libEntries = await fs.readdir(path.join(venv, "lib"), { withFileTypes: true });
    for (const entry of libEntries) {
      if (entry.isDirectory() && /^python\d/i.test(entry.name)) {
        candidates.push(path.join(venv, "lib", entry.name, "site-packages"));
      }
    }
  } catch {
    // A missing venv means Camoufox has not been prepared on this machine.
  }
  for (const sitePackages of candidates) {
    try {
      const entries = await fs.readdir(sitePackages, { withFileTypes: true });
      const metadataDir = entries.find((entry) => entry.isDirectory() && /^camoufox-(.+)\.dist-info$/i.test(entry.name));
      const match = metadataDir?.name.match(/^camoufox-(.+)\.dist-info$/i);
      if (match) return normalizeVersion(match[1]);
    } catch {
      // Try the next platform-specific site-packages directory.
    }
  }
  return "";
}

async function fetchJSON(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json", "User-Agent": "NextBrowser-runtime-update-checker" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Update source returned ${response.status}`);
  return response.json();
}

async function fetchText(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: { Accept: "text/html", "User-Agent": "NextBrowser-runtime-update-checker" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Update source returned ${response.status}`);
  return response.text();
}

async function latestClawbrowserVersion(fetchImpl) {
  try {
    const release = await fetchJSON(fetchImpl, "https://api.github.com/repos/clawbrowser/clawbrowser/releases/latest");
    const version = normalizeVersion(release?.tag_name);
    if (version) return version;
  } catch {
    // The unauthenticated GitHub API is rate-limited per IP. The public latest
    // release redirect remains available and resolves to the same official tag.
  }
  const response = await fetchImpl("https://github.com/clawbrowser/clawbrowser/releases/latest", {
    headers: { Accept: "text/html", "User-Agent": "NextBrowser-runtime-update-checker" },
    redirect: "follow",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Update source returned ${response.status}`);
  const finalTag = String(response.url || "").match(/\/releases\/tag\/([^/?#]+)/i)?.[1];
  const html = finalTag ? "" : await response.text();
  const htmlTag = html.match(/\/clawbrowser\/clawbrowser\/releases\/tag\/([^"'/?#]+)/i)?.[1];
  const version = normalizeVersion(decodeURIComponent(finalTag || htmlTag || ""));
  if (!version) throw new Error("Latest ClawBrowser release did not include a version");
  return version;
}

async function latestCamoufoxVersion(fetchImpl) {
  const release = await fetchJSON(fetchImpl, "https://pypi.org/pypi/camoufox/json");
  const version = normalizeVersion(release?.info?.version);
  if (!version) throw new Error("Latest Camoufox package did not include a version");
  return version;
}

async function latestDasbrowserVersion(fetchImpl) {
  const html = await fetchText(fetchImpl, "https://www.dasbrowser.com/download");
  const versions = [...html.matchAll(/cdn\.dasbrowser\.com\/(\d+(?:\.\d+)+)\//gi)].map((match) => match[1]);
  if (!versions.length) throw new Error("DasBrowser download page did not include a release version");
  return versions.sort(compareVersions).at(-1);
}

function runtimeResult(source, currentVersion, latestVersion, error = "", installed = !!normalizeVersion(currentVersion)) {
  const current = normalizeVersion(currentVersion);
  const latest = normalizeVersion(latestVersion);
  let status = installed ? "unknown" : "not-installed";
  if (error) status = "error";
  else if (current && latest) status = compareVersions(current, latest) < 0 ? "available" : "up-to-date";
  else if (current) status = "unknown";
  return {
    ...source,
    status,
    currentVersion: current || undefined,
    latestVersion: latest || undefined,
    error: error || undefined,
  };
}

async function checkBrowserRuntimeUpdates({ fetchImpl = fetch, runtimeRoot, readDasbrowserVersion = async () => "", isRuntimeInstalled = {} }) {
  const installed = {
    clawbrowser: await installedClawbrowserVersion(runtimeRoot),
    camoufox: await installedCamoufoxVersion(runtimeRoot),
    dasbrowser: normalizeVersion(await readDasbrowserVersion()),
  };
  const latestReaders = {
    clawbrowser: latestClawbrowserVersion,
    camoufox: latestCamoufoxVersion,
    dasbrowser: latestDasbrowserVersion,
  };
  const runtimes = await Promise.all(RUNTIME_UPDATE_SOURCES.map(async (source) => {
    try {
      const latest = await latestReaders[source.runtime](fetchImpl);
      return runtimeResult(source, installed[source.runtime], latest, "", isRuntimeInstalled[source.runtime] ?? !!installed[source.runtime]);
    } catch (error) {
      return runtimeResult(source, installed[source.runtime], "", error?.message || String(error), isRuntimeInstalled[source.runtime] ?? !!installed[source.runtime]);
    }
  }));
  return {
    status: runtimes.some((runtime) => runtime.status === "error") ? "partial" : "ready",
    checkedAt: Date.now(),
    runtimes,
  };
}

module.exports = {
  RUNTIME_UPDATE_SOURCES,
  assertRuntimeReleaseVersion,
  checkBrowserRuntimeUpdates,
  clawbrowserReleaseAsset,
  classifyRuntimeUpdateFailure,
  compareVersions,
  installedCamoufoxVersion,
  installedClawbrowserVersion,
  installSelectedRuntimeUpdates,
  installRuntimeUpdateWithVerification,
  normalizeVersion,
  runtimeResult,
  selectAvailableRuntimeUpdates,
};
