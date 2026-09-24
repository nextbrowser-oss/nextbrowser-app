const { loadBackendConfig } = require("./proxy-traffic.cjs");

const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_REPO_URL = "https://github.com/nextbrowser-oss/nextbrowser-app";

// An account that signed in with GitHub starts with a small proxy limit and is
// asked to star the NextBrowser repository; the backend checks the star and
// raises the limit once. The key stays in the main process, like every other
// backend call the renderer asks for.
function normalizeGitHubStarStatus(body) {
  const rewardBytes = Number(body?.reward_bytes);
  return {
    required: body?.required === true,
    claimed: body?.claimed === true,
    repoUrl: typeof body?.repo_url === "string" && body.repo_url.startsWith("https://github.com/")
      ? body.repo_url
      : DEFAULT_REPO_URL,
    rewardBytes: Number.isFinite(rewardBytes) && rewardBytes > 0 ? rewardBytes : 0,
  };
}

async function githubStarRequest(route, method, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const { apiKey, baseURL } = await loadBackendConfig(deps);
  let response;
  try {
    response = await fetchImpl(`${baseURL}${route}`, {
      method,
      headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(deps.timeoutMs || REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    const error = new Error("NextBrowser could not reach the service. Check your internet connection and try again.");
    error.cause = cause;
    throw error;
  }
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = null; }
  }
  if (!response.ok) {
    const error = new Error(
      typeof body?.message === "string" && body.message
        ? body.message
        : `The star check failed (${response.status}).`,
    );
    error.status = response.status;
    error.code = typeof body?.code === "string" ? body.code : undefined;
    throw error;
  }
  return normalizeGitHubStarStatus(body);
}

// The status is a nudge, not a gate: anything that goes wrong (no account yet,
// an older backend without the endpoint, no network) means no prompt.
async function githubStarStatus(deps) {
  try {
    return await githubStarRequest("/v1/proxy/github-star", "GET", deps);
  } catch {
    return null;
  }
}

function verifyGitHubStar(deps) {
  return githubStarRequest("/v1/proxy/github-star/verify", "POST", deps);
}

module.exports = { githubStarStatus, normalizeGitHubStarStatus, verifyGitHubStar };
