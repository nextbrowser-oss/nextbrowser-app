const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  REPOSITORY_API_URL,
  createGitHubStarsSource,
  fetchGitHubStars,
  readLocalGitHubStars,
  writeLocalGitHubStars,
} = require("./github-stars.cjs");

test("returns the repository star count", async () => {
  const count = await fetchGitHubStars(async (url, options) => {
    assert.equal(url, REPOSITORY_API_URL);
    assert.equal(options.headers["user-agent"], "Nextbrowser");
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

function githubResponse(status, count, etag) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name === "etag" ? etag ?? null : null) },
    json: async () => ({ stargazers_count: count }),
  };
}

function scriptedGitHub(answers) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(options.headers["if-none-match"]);
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { calls, fetchImpl };
}

test("star source reuses a fresh count and reads GitHub again once it is old", async () => {
  let clock = 0;
  const github = scriptedGitHub([githubResponse(200, 33, '"a"'), githubResponse(200, 34, '"b"')]);
  const source = createGitHubStarsSource({ fetchImpl: github.fetchImpl, now: () => clock, maxAgeMs: 1000, minRefreshMs: 100 });

  assert.equal(await source.get(), 33);
  clock = 500;
  assert.equal(await source.get(), 33);
  assert.equal(github.calls.length, 1);
  clock = 1000;
  assert.equal(await source.get(), 34);
  assert.deepEqual(github.calls, [undefined, '"a"']);
});

test("star source refreshes on request, but not more often than the minimum interval", async () => {
  let clock = 0;
  const github = scriptedGitHub([githubResponse(200, 33, '"a"'), githubResponse(200, 34, '"b"')]);
  const source = createGitHubStarsSource({ fetchImpl: github.fetchImpl, now: () => clock, maxAgeMs: 60_000, minRefreshMs: 100 });

  assert.equal(await source.get(), 33);
  clock = 50;
  assert.equal(await source.get({ refresh: true }), 33);
  assert.equal(github.calls.length, 1);
  clock = 100;
  assert.equal(await source.get({ refresh: true }), 34);
});

test("star source treats 304 as the same count and shares one request", async () => {
  let clock = 0;
  const github = scriptedGitHub([githubResponse(200, 33, '"a"'), githubResponse(304)]);
  const source = createGitHubStarsSource({ fetchImpl: github.fetchImpl, now: () => clock, maxAgeMs: 1000, minRefreshMs: 0 });

  const [first, second] = await Promise.all([source.get(), source.get({ refresh: true })]);
  assert.equal(first, 33);
  assert.equal(second, 33);
  clock = 2000;
  assert.equal(await source.get(), 33);
  assert.deepEqual(github.calls, [undefined, '"a"']);
});

test("star source keeps the last count when GitHub fails and has no made-up fallback", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nextbrowser-stars-"));
  const cachePath = path.join(directory, "github-stars.json");
  try {
    let clock = 0;
    const offline = scriptedGitHub([new Error("offline"), githubResponse(403)]);
    const empty = createGitHubStarsSource({ cachePath, fetchImpl: offline.fetchImpl, now: () => clock, minRefreshMs: 0 });
    assert.equal(await empty.get(), null);

    await writeLocalGitHubStars(cachePath, 30);
    const github = scriptedGitHub([githubResponse(403), githubResponse(200, 33), new Error("offline")]);
    const source = createGitHubStarsSource({ cachePath, fetchImpl: github.fetchImpl, now: () => clock, maxAgeMs: 10, minRefreshMs: 0 });
    assert.equal(await source.get(), 30);
    clock = 20;
    assert.equal(await source.get(), 33);
    assert.equal(await readLocalGitHubStars(cachePath), 33);
    clock = 40;
    assert.equal(await source.get(), 33);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
