const test = require("node:test");
const assert = require("node:assert/strict");
const { mcpProfileScope } = require("./mcp-profile-scope.cjs");
test("includes only selected Multilogin browser with a canonical session alias", () => {
  const local = new Map([["local", { runtime: "camoufox" }]]);
  assert.deepEqual(mcpProfileScope(local, { kind: "browser", id: "remote-1", name: "Display name" }), {
    local: "camoufox",
    "remote-1": { runtime: "multilogin", identity: "remote-1" },
    "mlx-browser-remote-1": { runtime: "multilogin", identity: "remote-1" },
  });
  assert.deepEqual(mcpProfileScope(local, undefined), { local: "camoufox" });
  assert.deepEqual(mcpProfileScope(local, { kind: "mobile", id: "phone" }), { local: "camoufox" });
});
test("updating selection revokes the previous remote identity", () => {
  const scope = mcpProfileScope(new Map(), { kind: "browser", id: "new" });
  assert.equal(scope.old, undefined);
  assert.equal(scope["mlx-browser-old"], undefined);
  assert.equal(scope.new.identity, "new");
});
