const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createManualProxyStore } = require("./manual-proxy-store.cjs");

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from([...value].reverse().join(""), "utf8"),
    decryptString: (value) => [...value.toString("utf8")].reverse().join(""),
  };
}

test("stores personal proxy credentials encrypted and exposes only metadata", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nextbrowser-proxies-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "manual-proxies.json");
  const store = createManualProxyStore({ safeStorage: fakeSafeStorage(), filePath, platform: "darwin" });

  const saved = await store.save({
    name: "Office",
    scheme: "http",
    host: "proxy.example",
    port: 8080,
    username: "agent",
    password: " super-secret ",
  });

  assert.equal(saved.name, "Office");
  assert.equal(saved.hasPassword, true);
  assert.equal("password" in saved, false);
  assert.deepEqual(await store.list(), [saved]);
  assert.equal((await store.resolve(saved.id)).password, " super-secret ");
  assert.equal((await fs.readFile(filePath, "utf8")).includes("super-secret"), false);
});

test("removes a saved proxy and rejects duplicate names", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nextbrowser-proxies-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = createManualProxyStore({
    safeStorage: fakeSafeStorage(),
    filePath: path.join(dir, "manual-proxies.json"),
    platform: "darwin",
  });

  const saved = await store.save({ name: "Home", scheme: "socks5", host: "127.0.0.1", port: 1080 });
  await assert.rejects(
    store.save({ name: "home", scheme: "http", host: "proxy.example", port: 80 }),
    /already exists/,
  );
  assert.equal(await store.remove(saved.id), true);
  assert.deepEqual(await store.list(), []);
});
