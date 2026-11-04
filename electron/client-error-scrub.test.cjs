const assert = require("node:assert/strict");
const test = require("node:test");
const { apiRoute, createScrubber, normalizeMessage, normalizeStackFrames, truncateBytes } = require("./client-error-scrub.cjs");

test("replaces the user's home directory with ~ in every spelling", () => {
  const win = createScrubber({ homeDir: "C:\\Users\\Alice", platform: "win32" });
  assert.equal(win("ENOENT: open 'C:\\Users\\Alice\\AppData\\Local\\x.json'"), "ENOENT: open '~\\AppData\\Local\\x.json'");
  assert.equal(win("at f (file:///C:/Users/Alice/app/dist/index.js:1:2)"), "at f (file:///~/app/dist/index.js:1:2)");
  assert.equal(win("c:\\users\\alice\\Desktop"), "~\\Desktop");
  const mac = createScrubber({ homeDir: "/Users/alice", platform: "darwin" });
  assert.equal(mac("spawn /Users/alice/.nextbrowser/managed-nextctl/nextctl EACCES"), "spawn ~/.nextbrowser/managed-nextctl/nextctl EACCES");
  assert.equal(mac("/Users/alicewonder/file"), "~/file", "another account's home is scrubbed too");
  const linux = createScrubber({ homeDir: "/home/bob", platform: "linux" });
  assert.equal(linux("cwd=/home/bob/project"), "cwd=~/project");
});

test("strips URL queries, fragments and credentials", () => {
  const scrub = createScrubber({ homeDir: "/home/bob" });
  assert.equal(
    scrub("GET https://api.nextbrowser.com/v1/pairing-requests/abc?poll_token=secret#x failed"),
    "GET https://api.nextbrowser.com/v1/pairing-requests/abc failed",
  );
  assert.equal(scrub("proxy http://user:pa55@10.0.0.1:8080/ refused"), "proxy http://10.0.0.1:8080/ refused");
  assert.equal(scrub("upstream socks5://u:p4ss@proxy.local:1080 failed"), "upstream socks5://proxy.local:1080 failed");
});

test("removes emails, bearer tokens, account keys, OpenAI-style keys and JWTs", () => {
  const scrub = createScrubber({ homeDir: "/home/bob" });
  const text = scrub([
    "user alice.smith+test@example.co.uk failed",
    "Authorization: Bearer abc.def-123",
    "key nb_live_9f8e7d6c5b4a",
    "OPENAI sk-proj-AbCdEf0123456789",
    "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
    "password=hunter2 api_key: \"k-123\" token=abc&next=1",
  ].join("\n"));
  for (const secret of ["alice.smith", "abc.def-123", "9f8e7d6c5b4a", "AbCdEf0123456789", "eyJhbGci", "hunter2", "k-123", "token=abc"]) {
    assert.ok(!text.includes(secret), `${secret} must be scrubbed from: ${text}`);
  }
  assert.ok(text.includes("<email>"));
  assert.ok(text.includes("nb_live_***"));
  assert.ok(text.includes("sk-***"));
  assert.ok(text.includes("<jwt>"));
});

test("removes the model provider keys of the built-in agent", () => {
  const scrub = createScrubber({ homeDir: "/home/bob" });
  const text = scrub("NVIDIA nvapi-AbCdEf0123456789xyz, Groq gsk_AbCdEf0123456789, Google AIzaSyA1234567890abcdefghijk, OpenRouter sk-or-v1-AbCdEf0123456789");
  for (const secret of ["AbCdEf0123456789", "SyA1234567890"]) assert.ok(!text.includes(secret), `${secret} must be scrubbed from: ${text}`);
  assert.ok(text.includes("nvapi-***") && text.includes("gsk-***") && text.includes("AIza***"));
});

test("leaves ordinary diagnostics readable", () => {
  const scrub = createScrubber({ homeDir: "/home/bob" });
  const message = "TypeError: Cannot read properties of undefined (reading 'map') at ChatView";
  assert.equal(scrub(message), message);
});

test("truncates by UTF-8 bytes without splitting characters", () => {
  assert.equal(truncateBytes("short", 10), "short");
  const cut = truncateBytes("ж".repeat(100), 21);
  assert.ok(Buffer.byteLength(cut) <= 21);
  assert.ok(cut.endsWith("…"));
  assert.ok(!cut.includes("\uFFFD"));
  const emoji = truncateBytes("😀".repeat(10), 12);
  assert.ok(Buffer.byteLength(emoji) <= 12);
  assert.equal(emoji, "😀😀…");
});

test("stack frames ignore line numbers, install paths and bundle hashes", () => {
  const a = normalizeStackFrames("Error: x\n    at ChatView (file:///C:/Users/A/app.asar/dist/assets/index-AbC123xy.js:10:20)\n    at async run (node:internal/process:1:1)");
  const b = normalizeStackFrames("Error: x\n    at ChatView (file:///Applications/Nextbrowser.app/dist/assets/index-Zz99Yy88.js:99:1)\n    at async run (node:internal/process:5:5)");
  assert.deepEqual(a, ["ChatView index.js", "run process"]);
  assert.deepEqual(a, b);
  assert.deepEqual(normalizeStackFrames("no frames here"), []);
});

test("messages normalize ids and numbers for grouping", () => {
  assert.equal(
    normalizeMessage("Project 3f2b1c9e-1d2c-4b5a-9e8f-0123456789ab failed after 1500 ms for “My profile”"),
    "Project <uuid> failed after 0 ms for “…”",
  );
});

test("API routes drop the query and fold identifiers", () => {
  assert.deepEqual(apiRoute("https://core.nextbrowser.com/v1/projects/3f2b1c9e-1d2c-4b5a-9e8f-0123456789ab?x=1"), { host: "core.nextbrowser.com", path: "/v1/projects/:id" });
  assert.deepEqual(apiRoute("https://api.nextbrowser.com/v1/pairing-requests/AbC123?poll_token=t"), { host: "api.nextbrowser.com", path: "/v1/pairing-requests/:id" });
  assert.deepEqual(apiRoute("https://core.nextbrowser.com/v1/personal-proxies/p_1/credentials"), { host: "core.nextbrowser.com", path: "/v1/personal-proxies/:id/credentials" });
  assert.deepEqual(apiRoute("https://core.nextbrowser.com/signal-router/v1/feedback"), { host: "core.nextbrowser.com", path: "/signal-router/v1/feedback" });
  assert.deepEqual(apiRoute("not a url"), { host: "", path: "unknown" });
});
