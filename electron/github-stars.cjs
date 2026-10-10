const fs = require("node:fs/promises");
const path = require("node:path");

const REPOSITORY_API_URL = "https://api.github.com/repos/nextbrowser-oss/nextbrowser-app";

// How long a count read from GitHub is shown without asking again. GitHub
// answers an unchanged count with 304, which does not use up the 60 requests
// an hour it allows an IP without a token, so a short interval stays cheap.
const STARS_MAX_AGE_MS = 2 * 60 * 1000;
// A forced refresh (window focus, a verified star) still waits this long
// after the previous request, so repeated focus changes cannot burn the limit.
const STARS_MIN_REFRESH_MS = 15 * 1000;
const STARS_REQUEST_TIMEOUT_MS = 5000;

function validStarCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

// Reads the count from GitHub. With the ETag of the last answer, an unchanged
// repository comes back as { notModified: true } instead of a count.
async function fetchGitHubStarsResponse(fetchImpl = globalThis.fetch, options = {}) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "Nextbrowser",
  };
  if (options.etag) headers["if-none-match"] = options.etag;
  const response = await fetchImpl(REPOSITORY_API_URL, { headers, signal: options.signal });
  if (response.status === 304) return { notModified: true };
  if (!response.ok) return null;

  const body = await response.json();
  const count = validStarCount(body?.stargazers_count);
  if (count == null) return null;
  const etag = typeof response.headers?.get === "function" ? response.headers.get("etag") : null;
  return { count, etag: etag || undefined };
}

async function fetchGitHubStars(fetchImpl = globalThis.fetch, options = {}) {
  const result = await fetchGitHubStarsResponse(fetchImpl, { signal: options.signal });
  return result?.count ?? null;
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

// The count the header shows, kept as close to GitHub as its rate limit
// allows: reused for STARS_MAX_AGE_MS, read again when older or when a
// refresh is asked for, and one request at a time. When GitHub cannot be
// reached the last count stands (from memory, then from disk); with neither
// the answer is null, never a number that was true once.
function createGitHubStarsSource({
  cachePath,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  maxAgeMs = STARS_MAX_AGE_MS,
  minRefreshMs = STARS_MIN_REFRESH_MS,
  timeoutMs = STARS_REQUEST_TIMEOUT_MS,
} = {}) {
  let count = null;
  let etag;
  let checkedAt = -Infinity;
  let requestedAt = -Infinity;
  let pending;
  let cacheRead = false;

  async function lastKnown() {
    if (count == null && !cacheRead && cachePath) {
      cacheRead = true;
      count = await readLocalGitHubStars(cachePath);
    }
    return count;
  }

  async function request() {
    requestedAt = now();
    let result = null;
    try {
      result = await fetchGitHubStarsResponse(fetchImpl, {
        etag: count != null ? etag : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // The last count is still the best answer while GitHub is unreachable.
    }
    if (result?.notModified && count != null) {
      checkedAt = now();
    } else if (result && result.count != null) {
      const changed = result.count !== count;
      count = result.count;
      etag = result.etag;
      checkedAt = now();
      if (changed && cachePath) await writeLocalGitHubStars(cachePath, count);
    }
    return lastKnown();
  }

  return {
    async get({ refresh = false } = {}) {
      if (pending) return pending;
      const age = now() - checkedAt;
      const sinceRequest = now() - requestedAt;
      const stale = age >= maxAgeMs;
      const wanted = stale || refresh;
      if (!wanted || sinceRequest < minRefreshMs) return lastKnown();
      pending = request().finally(() => { pending = undefined; });
      return pending;
    },
  };
}

module.exports = {
  REPOSITORY_API_URL,
  STARS_MAX_AGE_MS,
  createGitHubStarsSource,
  fetchGitHubStars,
  fetchGitHubStarsResponse,
  readLocalGitHubStars,
  writeLocalGitHubStars,
};
