const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { addChatWorkspaceProfile } = require("./chat-profile-scope.cjs");

test("a running chat gains only its newly approved workspace profile", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nb-chat-scope-"));
  try {
    const file = path.join(dir, "scope.json");
    const record = {
      conversationId: "chat-1",
      profileScopeFile: file,
      profileScope: new Map([["Existing", { runtime: "camoufox" }]]),
    };
    await fs.writeFile(file, JSON.stringify({ Existing: "camoufox" }));
    const updated = await addChatWorkspaceProfile(record, "Romania-ClawBrowser", "clawbrowser");
    assert.equal(updated.get("Romania-ClawBrowser").conversationId, "chat-1");
    assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), {
      Existing: "camoufox",
      "Romania-ClawBrowser": "clawbrowser",
    });
    assert.equal(updated.has("Other workspace"), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
