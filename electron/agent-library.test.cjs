const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { agentCommand } = require("./agent-library.cjs");
const { extract } = require("./agent-import-sources.cjs");

test("local agent imports deduplicate, omit tools and configuration credentials, and restore with a separate key", async (t) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "nb-agent-test-"));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  const codex = path.join(fixture, "codex"),
    claude = path.join(fixture, "claude");
  await fs.mkdir(path.join(codex, "sessions", "2026", "11", "25"), { recursive: true });
  await fs.mkdir(path.join(claude, "projects", "project-a"), { recursive: true });
  await fs.writeFile(
    path.join(codex, "sessions", "2026", "11", "25", "rollout-test.jsonl"),
    [
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Fixture transcript" }],
        },
      },
      { type: "response_item", payload: { type: "function_call_output", output: "private tool output" } },
      { type: "event_msg", payload: { type: "user_message", message: "Fixture transcript" } },
    ]
      .map((x) => JSON.stringify(x))
      .join("\n"),
  );
  await fs.writeFile(
    path.join(codex, "config.toml"),
    'model = "test-model"\n[mcp_servers.example]\ncommand="npx"\nargs=["-y","example-mcp","--api-key","secret-value"]\n[mcp_servers.example.env]\nTOKEN="secret-value"',
  );
  await fs.writeFile(
    path.join(claude, "projects", "project-a", "a123.jsonl"),
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Claude fixture" },
          { type: "tool_use", input: { secret: "sensitive" } },
        ],
      },
    }),
  );
  await fs.writeFile(path.join(claude, "CLAUDE.md"), "Fixture instructions");
  const locations = { Codex: { base: codex }, Claude: { base: claude } };
  const proposals = [];
  const scope = {
    owner: "account/test",
    workspaceId: "test",
    window: { webContents: { send: (_name, m) => proposals.push(m) } },
  };
  const command = (action, args = {}, extra = {}) =>
    agentCommand({
      root: path.join(fixture, "library"),
      keyDirectory: path.join(fixture, "keys"),
      scope,
      locations,
      current: () => true,
      args,
      action,
      ...extra,
    });
  assert.deepEqual(
    (await command("scan")).map((s) => s.counts.chats),
    [1, 1],
  );
  for (const provider of Object.keys(locations))
    await command("import", { provider, selected: ["chats", "mcp", "settings", "instructions"] });
  await command("import", { provider: "Codex", selected: ["chats"] });
  const lib = await command("list");
  assert.equal(lib.entries.length, 5);
  const read = (kind) =>
    command("read", { id: lib.entries.find((e) => e.kind === kind && e.provider === "Codex").id });
  assert.deepEqual((await read("chats")).body, [{ role: "user", text: "Fixture transcript" }]);
  assert.deepEqual((await read("settings")).body, { model: "test-model" });
  assert.deepEqual((await read("mcp")).body, {
    command: "npx",
    args: ["-y", "example-mcp", "<review>", "<review>"],
  });
  assert.equal(proposals.length, 0);
  await command("review", { id: lib.entries.find((e) => e.kind === "mcp").id });
  assert.equal(proposals.length, 1);
  const bytes = await fs.readFile(lib.archivePath);
  for (const value of ["Fixture transcript", "test-model", "Fixture instructions", "secret-value"])
    assert.equal(bytes.includes(Buffer.from(value)), false);
  const dest = { root: path.join(fixture, "restored"), keyDirectory: path.join(fixture, "new-keys") };
  const dialog = {
    showOpenDialog: async (_, opts) => ({
      filePaths: [opts.filters[0].extensions[0] === "nbal" ? lib.archivePath : lib.keyPath],
    }),
  };
  await command("restore", {}, { ...dest, dialog });
  assert.deepEqual(
    (await command("list", {}, dest)).entries.sort((a, b) => a.id.localeCompare(b.id)),
    [...lib.entries].sort((a, b) => a.id.localeCompare(b.id)),
  );
  await assert.rejects(
    command("read", { id: lib.entries[0].id }, { current: () => false }),
    /account changed/,
  );
  const file = path.join(fixture, "conversations.json");
  await fs.writeFile(
    file,
    JSON.stringify([
      { uuid: "one", name: "Desktop chat", chat_messages: [{ sender: "human", text: "Hello" }] },
    ]),
  );
  assert.equal(
    (
      await extract(
        { file, provider: "Claude", format: "claude-export", kinds: ["chats"] },
        ["chats"],
        fixture,
      )
    )[0].title,
    "Desktop chat",
  );
});
