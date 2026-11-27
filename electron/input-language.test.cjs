const test = require("node:test");
const assert = require("node:assert/strict");
const { inputLanguages } = require("./input-language.cjs");
const { translate, setInterfaceLanguage } = require("./interface-messages.cjs");

test("Windows queries the input language of the desktop window ahead of OS display preferences", async () => {
  const result = await inputLanguages({ platform: "win32", helper: "helper.exe", windowHandle: "18790013",
    preferredLanguages: () => ["en-US"], run: async (helper, args) => {
      assert.equal(helper, "helper.exe");
      assert.deepEqual(args, ["--input-language", "18790013"]);
      return { stdout: "uk-UA\r\n" };
    } });
  assert.deepEqual(result, ["uk-UA", "en-US"]);
});

test("macOS reads the active input source, then falls back on invalid or unavailable helpers", async () => {
  const opts = { platform: "darwin", helper: "input-language", preferredLanguages: () => ["ja-JP"] };
  assert.deepEqual(await inputLanguages({ ...opts, run: async (_, args) => {
    assert.deepEqual(args, []); return { stdout: "zh-Hans\n" };
  } }), ["zh-Hans", "ja-JP"]);
  for (const run of [async () => ({ stdout: "unknown layout" }), async () => { throw Error("missing"); }]) {
    assert.deepEqual(await inputLanguages({ ...opts, run }), ["ja-JP"]);
  }
});

test("native dialogs share the UI catalogue and accept only known languages", () => {
  try {
    setInterfaceLanguage("ru");
    assert.equal(translate("Settings"), "Настройки");
    assert.equal(translate("Failed checks: %1.", "$&"), "Проверки с ошибками: $&.");
    assert.throws(() => setInterfaceLanguage("../package"));
  } finally { setInterfaceLanguage("en"); }
});
