const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  MULTILOGIN_AUTOMATION_TOKEN_URL,
  automationTokenFromResponse,
  createMultiloginCredentialStore,
  exchangeAutomationToken,
  normalizeBearerToken,
  secureStorageAvailable,
} = require("./multilogin-credential.cjs");

function fakeSafeStorage(backend = "keychain") {
  return {
    isEncryptionAvailable: () => true,
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => backend,
    encryptString: (value) => Buffer.from([...value].reverse().join(""), "utf8"),
    decryptString: (value) => [...value.toString("utf8")].reverse().join(""),
  };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test("normalizes a copied Multilogin bearer token", () => {
  assert.equal(normalizeBearerToken("  Bearer abc.def.ghi  "), "abc.def.ghi");
  assert.equal(normalizeBearerToken('"abc.def.ghi"'), "abc.def.ghi");
  assert.throws(() => normalizeBearerToken(""), /Paste the bearer token/);
  assert.throws(() => normalizeBearerToken("abc def"), /invalid format/);
});

test("extracts known Multilogin automation token response shapes", () => {
  assert.equal(automationTokenFromResponse({ data: { token: "automation-token" } }), "automation-token");
  assert.equal(automationTokenFromResponse({ automation_token: "alternate-token" }), "alternate-token");
  assert.throws(() => automationTokenFromResponse({ data: {} }), /did not return/);
});

test("exchanges the bearer for a no-expiration automation token", async () => {
  let requestURL = "";
  let authorization = "";
  const token = await exchangeAutomationToken({
    bearerToken: "Bearer short-lived-token",
    fetchImpl: async (url, options) => {
      requestURL = url;
      authorization = options.headers.authorization;
      return response(200, { data: { token: "long-lived-token" } });
    },
  });

  assert.equal(requestURL, MULTILOGIN_AUTOMATION_TOKEN_URL);
  assert.equal(authorization, "Bearer short-lived-token");
  assert.equal(token, "long-lived-token");
});

test("does not expose bearer tokens or upstream bodies in exchange errors", async () => {
  const bearerToken = "private-bearer-token";
  await assert.rejects(
    exchangeAutomationToken({
      bearerToken,
      fetchImpl: async () => response(401, { error: bearerToken }),
    }),
    (error) => !error.message.includes(bearerToken) && /expired/.test(error.message),
  );
});

test("stores only an encrypted Multilogin token and can clear it", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nextbrowser-multilogin-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, "credentials", "multilogin.json");
  const store = createMultiloginCredentialStore({
    safeStorage: fakeSafeStorage(),
    filePath,
    platform: "darwin",
  });

  await store.save("secret-automation-token");

  const raw = await fs.readFile(filePath, "utf8");
  assert.equal(raw.includes("secret-automation-token"), false);
  assert.equal(await store.load(), "secret-automation-token");
  if (process.platform !== "win32") {
    assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600);
  }

  await store.clear();
  assert.equal(await store.load(), "");
});

test("uses Electron async encryption when it is available", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nextbrowser-multilogin-async-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const safeStorage = fakeSafeStorage();
  safeStorage.encryptString = () => { throw new Error("sync encryption should not run"); };
  safeStorage.decryptString = () => { throw new Error("sync decryption should not run"); };
  safeStorage.encryptStringAsync = async (value) => Buffer.from([...value].reverse().join(""), "utf8");
  safeStorage.decryptStringAsync = async (value) => ({ shouldReEncrypt: false, result: [...value.toString("utf8")].reverse().join("") });
  const store = createMultiloginCredentialStore({
    safeStorage,
    filePath: path.join(root, "multilogin.json"),
    platform: "darwin",
  });

  await store.save("async-secret");

  assert.equal(await store.load(), "async-secret");
});

test("uses async availability when the legacy synchronous provider is unavailable", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nextbrowser-multilogin-async-availability-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const safeStorage = fakeSafeStorage();
  safeStorage.isEncryptionAvailable = () => false;
  safeStorage.encryptStringAsync = async (value) => Buffer.from([...value].reverse().join(""), "utf8");
  safeStorage.decryptStringAsync = async (value) => ({ shouldReEncrypt: false, result: [...value.toString("utf8")].reverse().join("") });
  const store = createMultiloginCredentialStore({
    safeStorage,
    filePath: path.join(root, "multilogin.json"),
    platform: "darwin",
  });

  assert.equal(await store.available(), true);
  await store.save("async-secret");
  assert.equal(await store.load(), "async-secret");
});

test("reports temporary async keychain unavailability without losing the credential", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nextbrowser-multilogin-temporary-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, "multilogin.json");
  const safeStorage = fakeSafeStorage();
  safeStorage.encryptStringAsync = async (value) => Buffer.from(value, "utf8");
  safeStorage.decryptStringAsync = async () => ({ isTemporarilyUnavailable: true, result: "" });
  const store = createMultiloginCredentialStore({ safeStorage, filePath, platform: "darwin" });

  await store.save("preserved-secret");
  await assert.rejects(store.load(), /temporarily unavailable/);
  assert.equal((await fs.stat(filePath)).isFile(), true);
});

test("rejects Linux plaintext fallback storage", async () => {
  const safeStorage = fakeSafeStorage("basic_text");
  delete safeStorage.isAsyncEncryptionAvailable;
  assert.equal(await secureStorageAvailable(safeStorage, "linux"), false);
  const store = createMultiloginCredentialStore({
    safeStorage,
    filePath: "/tmp/unused-multilogin-credential.json",
    platform: "linux",
  });
  await assert.rejects(store.save("secret"), /Secure credential storage is unavailable/);
});
