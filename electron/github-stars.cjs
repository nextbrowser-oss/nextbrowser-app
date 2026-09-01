const fs = require("node:fs/promises");
const path = require("node:path");

const REPOSITORY_API_URL = "https://api.github.com/repos/nextbrowser-oss/nextbrowser-app";

async function fetchGitHubStars(fetchImpl = globalThis.fetch, options = {}) {
  const response = await fetchImpl(REPOSITORY_API_URL, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "NextBrowser",
    },
    signal: options.signal,
  });
  if (!response.ok) return null;

  const body = await response.json();
  const count = body?.stargazers_count;
  return Number.isInteger(count) && count >= 0 ? count : null;
}

function validStarCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

async function readLocalGitHubStars(filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    return validStarCount(parsed?.count);
  } catch {
    return null;
  }
}

async function writeLocalGitHubStars(filePath, count) {
  if (validStarCount(count) == null) return false;
  const directory = path.dirname(filePath);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      temporaryPath,
      JSON.stringify({ count, fetchedAt: new Date().toISOString() }, null, 2),
      "utf8",
    );
    await fs.rename(temporaryPath, filePath);
    return true;
  } catch {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    return false;
  }
}

module.exports = {
  REPOSITORY_API_URL,
  fetchGitHubStars,
  readLocalGitHubStars,
  writeLocalGitHubStars,
};
