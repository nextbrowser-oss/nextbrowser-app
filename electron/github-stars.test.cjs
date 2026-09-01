const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  REPOSITORY_API_URL,
  fetchGitHubStars,
  readLocalGitHubStars,
  writeLocalGitHubStars,
} = require("./github-stars.cjs");

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

test("persists and restores the last GitHub count locally", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nextbrowser-stars-"));
  const filePath = path.join(directory, "github-stars.json");
  try {
    assert.equal(await readLocalGitHubStars(filePath), null);
    assert.equal(await writeLocalGitHubStars(filePath, 19), true);
    assert.equal(await readLocalGitHubStars(filePath), 19);
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    assert.equal(parsed.count, 19);
    assert.equal(typeof parsed.fetchedAt, "string");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("rejects malformed local cache values", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nextbrowser-stars-"));
  const filePath = path.join(directory, "github-stars.json");
  try {
    await fs.writeFile(filePath, JSON.stringify({ count: "19" }), "utf8");
    assert.equal(await readLocalGitHubStars(filePath), null);
    assert.equal(await writeLocalGitHubStars(filePath, -1), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
