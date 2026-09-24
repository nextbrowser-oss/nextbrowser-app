const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { configPath } = require("./proxy-traffic.cjs");
const { githubStarStatus, normalizeGitHubStarStatus, verifyGitHubStar } = require("./github-star-reward.cjs");

async function accountHome(t, payload = { api_key: "private-key", api_base_url: "https://api.example.test/" }) {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "nextbrowser-github-star-"));
  t.after(() => fs.rm(homeDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(homeDir, ".config", "clawbrowser"), { recursive: true });
  await fs.writeFile(configPath({ homeDir, platform: "darwin", env: {} }), JSON.stringify(payload), { mode: 0o600 });
  return { homeDir, platform: "darwin", env: {} };
}

function respond(status, body, calls) {
  return async (url, init) => {
    calls.push({ url, method: init.method, authorization: init.headers.authorization });
    return new Response(body == null ? "" : JSON.stringify(body), { status });
  };
}

test("reads the star status with the account key", async (t) => {
  const deps = await accountHome(t);
  const calls = [];
  const status = await githubStarStatus({
    ...deps,
    fetchImpl: respond(200, {
      required: true,
      claimed: false,
      repo_url: "https://github.com/nextbrowser-oss/nextbrowser-app",
      reward_bytes: 1073741824,
    }, calls),
  });

  assert.deepEqual(status, {
    required: true,
    claimed: false,
    repoUrl: "https://github.com/nextbrowser-oss/nextbrowser-app",
    rewardBytes: 1073741824,
  });
  assert.deepEqual(calls, [{
    url: "https://api.example.test/v1/proxy/github-star",
    method: "GET",
    authorization: "Bearer private-key",
  }]);
});

test("never prompts when the status cannot be read", async (t) => {
  const deps = await accountHome(t);
  assert.equal(await githubStarStatus({ ...deps, fetchImpl: respond(404, { code: "not_found" }, []) }), null);
  assert.equal(await githubStarStatus({ ...deps, fetchImpl: async () => { throw new Error("offline"); } }), null);

  const noAccount = await accountHome(t, {});
  assert.equal(await githubStarStatus({ ...noAccount, fetchImpl: respond(200, {}, []) }), null);
});

test("verification posts and surfaces the backend's reason", async (t) => {
  const deps = await accountHome(t);
  const calls = [];
  await assert.rejects(
    verifyGitHubStar({
      ...deps,
      fetchImpl: respond(409, { code: "not_starred", message: "GitHub does not list your account among the stargazers yet" }, calls),
    }),
    (error) => error.status === 409 && error.code === "not_starred"
      && error.message === "GitHub does not list your account among the stargazers yet",
  );
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "https://api.example.test/v1/proxy/github-star/verify");

  const granted = await verifyGitHubStar({ ...deps, fetchImpl: respond(200, { required: false, claimed: true, reward_bytes: 1073741824 }, []) });
  assert.equal(granted.claimed, true);
  assert.equal(granted.required, false);
});

test("only a GitHub URL is trusted as the repository link", () => {
  assert.equal(normalizeGitHubStarStatus({ repo_url: "https://evil.example/star" }).repoUrl, "https://github.com/nextbrowser-oss/nextbrowser-app");
  assert.equal(normalizeGitHubStarStatus({ required: "yes" }).required, false);
});
