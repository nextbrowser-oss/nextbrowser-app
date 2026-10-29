const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createBuiltinAgentKeyStore, normalizeApiKey } = require("./builtin-agent-credential.cjs");

// Encryption the test can see through: the bytes are XOR-ed, so the stored
// file must not hold the key in the clear.
function fakeSafeStorage({ available = true } = {}) {
  const flip = (value) => Buffer.from(Buffer.from(value).map((byte) => byte ^ 0x5a));
  return {
    isEncryptionAvailable: () => available,
    isAsyncEncryptionAvailable: async () => available,
    getSelectedStorageBackend: () => "keychain",
    encryptString: (value) => flip(Buffer.from(value, "utf8")),
    decryptString: (value) => flip(value).toString("utf8"),
  };
}

async function tempFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nb-builtin-keys-"));
  return { dir, filePath: path.join(dir, "credentials", "builtin-agent.json") };
}

const KEY = "nvapi-AbCdEf0123456789-secret";

test("keys are saved encrypted per provider and read back", async () => {
  const { dir, filePath } = await tempFile();
  try {
    const store = createBuiltinAgentKeyStore({ safeStorage: fakeSafeStorage(), filePath, platform: "linux" });
    assert.deepEqual(await store.saved(), {});
    assert.equal(await store.load("nvidia"), "");
    await store.save("nvidia", `  Bearer ${KEY}  `);
    await store.save("openrouter", "sk-or-v1-0123456789abcdef");
    assert.deepEqual(await store.saved(), { nvidia: true, openrouter: true });
    assert.equal(await store.load("nvidia"), KEY);
    assert.equal(await store.load("openrouter"), "sk-or-v1-0123456789abcdef");
    const raw = await fs.readFile(filePath, "utf8");
    assert.ok(!raw.includes(KEY) && !raw.includes("AbCdEf0123456789"), "the file never holds the key in the clear");
    // Windows has no POSIX modes (files read as 0o666); the key is encrypted either way.
    if (process.platform !== "win32") assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600);
    await store.clear("nvidia");
    assert.deepEqual(await store.saved(), { openrouter: true });
    await store.clear("openrouter");
    await assert.rejects(fs.access(filePath), "the last key removes the file");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("without secure storage no key is saved", async () => {
  const { dir, filePath } = await tempFile();
  try {
    const store = createBuiltinAgentKeyStore({ safeStorage: fakeSafeStorage({ available: false }), filePath, platform: "darwin" });
    await assert.rejects(store.save("nvidia", KEY), (error) => error.expected === true && /Secure key storage is unavailable/.test(error.message));
    await assert.rejects(fs.access(filePath));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a key with spaces or no key at all is refused as the user's mistake", () => {
  assert.equal(normalizeApiKey(` "${KEY}" `), KEY);
  assert.throws(() => normalizeApiKey(""), (error) => error.expected === true && /Paste the API key/.test(error.message));
  assert.throws(() => normalizeApiKey("two words"), (error) => error.expected === true && /invalid format/.test(error.message));
});

test("an unknown provider id is refused", async () => {
  const { dir, filePath } = await tempFile();
  try {
    const store = createBuiltinAgentKeyStore({ safeStorage: fakeSafeStorage(), filePath, platform: "linux" });
    await assert.rejects(store.save("../evil", KEY), /Unknown provider/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a damaged key file reads as no keys and is replaced by the next save", async () => {
  const { dir, filePath } = await tempFile();
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "{not json", "utf8");
    const store = createBuiltinAgentKeyStore({ safeStorage: fakeSafeStorage(), filePath, platform: "linux" });
    assert.deepEqual(await store.saved(), {});
    await store.save("gemini", "AIzaSyA1234567890abcdefghij");
    assert.equal(await store.load("gemini"), "AIzaSyA1234567890abcdefghij");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
