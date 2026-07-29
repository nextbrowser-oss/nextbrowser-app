const test = require("node:test");
const assert = require("node:assert/strict");
const { REPOSITORY_API_URL, fetchGitHubStars } = require("./github-stars.cjs");

test("returns the repository star count", async () => {
  const count = await fetchGitHubStars(async (url, options) => {
    assert.equal(url, REPOSITORY_API_URL);
    assert.equal(options.headers["user-agent"], "NextBrowser");
    return {
      ok: true,
      json: async () => ({ stargazers_count: 8 }),
    };
  });

  assert.equal(count, 8);
});

test("returns null when GitHub responds with an error", async () => {
  const count = await fetchGitHubStars(async () => ({ ok: false }));
  assert.equal(count, null);
});

test("returns null for an invalid star count", async () => {
  const count = await fetchGitHubStars(async () => ({
    ok: true,
    json: async () => ({ stargazers_count: "8" }),
  }));
  assert.equal(count, null);
});
