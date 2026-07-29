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

module.exports = { REPOSITORY_API_URL, fetchGitHubStars };
