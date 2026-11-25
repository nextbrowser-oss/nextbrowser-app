const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes, createCipheriv, createDecipheriv } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { userKey, readKey } = require("./personal-archive.cjs");
const { sources, discover, extract, categories } = require("./agent-import-sources.cjs");

function seal(key, label, data) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(label));
  const body = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}
function unseal(key, label, data) {
  const bytes = Buffer.from(data);
  const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  cipher.setAAD(Buffer.from(label));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString());
}
const validId = (value) => typeof value === "string" && /^[a-f\d]{64}$/.test(value);
const busy = new Set();
async function agentCommand({
  root,
  keyDirectory,
  scope,
  current,
  dialog,
  args,
  action,
  locations = sources(),
}) {
  const check = () => {
    if (!current()) throw Error("The active account changed.");
  };
  check();
  if (action === "scan") {
    const result = [];
    for (const provider of Object.keys(locations)) {
      const { files, warnings } = await discover(provider, locations);
      result.push({
        provider,
        counts: Object.fromEntries(
          categories.map((kind) => [kind, files.filter((f) => f.kinds.includes(kind)).length]),
        ),
        warnings: warnings.length,
      });
    }
    check();
    return result;
  }
  const file = path.join(root, "agent-library.nbal");
  if (!["list", "read", "review", "import", "restore", "file"].includes(action))
    throw Error("Unknown agent import action.");
  const writing = ["import", "restore", "file"].includes(action);
  if (writing && busy.has(root)) throw Error("An import is already running.");
  if (
    !writing &&
    !(await fs.stat(file).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    }))
  ) {
    if (action === "list") return { entries: [] };
    throw Error("Open the agent library first.");
  }
  if (writing) busy.add(root);
  let db, recovery, foreign, oldKey;
  try {
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    db = new DatabaseSync(file);
    db.exec(
      "PRAGMA trusted_schema=OFF; CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, meta BLOB NOT NULL, body BLOB NOT NULL); CREATE TABLE IF NOT EXISTS recovery(name TEXT NOT NULL)",
    );
    const stored = db.prepare("SELECT name FROM recovery LIMIT 1").get();
    if (stored) {
      if (!/^[a-f\d-]{36}\.nbkey$/.test(stored.name)) throw Error("Invalid recovery key name.");
      recovery = { name: stored.name, key: await readKey(path.join(keyDirectory, stored.name)) };
    } else if (writing) {
      recovery = await userKey(keyDirectory);
      db.prepare("INSERT INTO recovery(name) VALUES (?)").run(recovery.name);
    } else {
      if (action === "list") return { entries: [] };
      throw Error("The agent library is being initialized.");
    }
    check();
    const paths = { archivePath: file, keyPath: path.join(keyDirectory, recovery.name) };
    if (action === "list") {
      const entries = db
        .prepare("SELECT id,meta FROM records ORDER BY rowid DESC")
        .all()
        .map(({ id, meta }) => ({ id, ...unseal(recovery.key, id + ":meta", meta) }));
      return { entries, ...paths };
    }
    if (action === "read" || action === "review") {
      if (!validId(args.id)) throw Error("Choose a library item.");
      const row = db.prepare("SELECT meta,body FROM records WHERE id=?").get(args.id);
      if (!row) throw Error("Library item not found.");
      const meta = unseal(recovery.key, args.id + ":meta", row.meta);
      const body = unseal(recovery.key, args.id + ":body", row.body);
      if (action === "read") return { ...meta, body };
      if (meta.kind !== "mcp") throw Error("Choose an MCP server.");
      scope.window.webContents.send("stock-mcp:proposal", {
        owner: scope.owner,
        workspaceId: scope.workspaceId,
        name: meta.title,
        config: body,
      });
      return;
    }
    const put = db.prepare(
      "INSERT INTO records(id,meta,body) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET meta=excluded.meta,body=excluded.body",
    );
    function save(id, meta, body) {
      if (
        !validId(id) ||
        !categories.includes(meta?.kind) ||
        !["Claude", "Codex"].includes(meta.provider) ||
        typeof meta.title !== "string"
      )
        throw Error("Invalid library record.");
      put.run(id, seal(recovery.key, id + ":meta", meta), seal(recovery.key, id + ":body", body));
    }
    let count = 0;
    const skipped = [];
    if (action === "restore") {
      const select = async (title, extension) => {
        const pick = await dialog.showOpenDialog(scope.window, {
          title,
          properties: ["openFile"],
          filters: [{ name: title, extensions: [extension] }],
        });
        check();
        return pick.canceled ? undefined : pick.filePaths[0];
      };
      const archive = await select("Choose an encrypted agent library", "nbal");
      if (!archive) return null;
      const keyFile = await select("Choose its recovery key", "nbkey");
      if (!keyFile) return null;
      oldKey = await readKey(keyFile);
      foreign = new DatabaseSync(archive, { readOnly: true });
      foreign.exec("PRAGMA trusted_schema=OFF");
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const row of foreign.prepare("SELECT id,meta,body FROM records").iterate()) {
          save(
            row.id,
            unseal(oldKey, row.id + ":meta", row.meta),
            unseal(oldKey, row.id + ":body", row.body),
          );
          count++;
        }
        check();
        db.exec("COMMIT");
      } catch {
        db.exec("ROLLBACK");
        throw Error("Cannot restore this library. Check the archive and recovery key.");
      }
    } else {
      const { provider } = args;
      let { selected } = args;
      let picked;
      if (action === "file") {
        const pick = await dialog.showOpenDialog(scope.window, {
          title: "Choose a Claude or Codex export or configuration",
          properties: ["openFile"],
          filters: [
            { name: "Chat exports, settings or instructions", extensions: ["json", "jsonl", "toml", "md"] },
          ],
        });
        check();
        if (pick.canceled || !pick.filePaths[0]) return null;
        const file = pick.filePaths[0],
          name = path.basename(file);
        let format;
        if (provider === "Claude" && name === "conversations.json") {
          format = "claude-export";
          selected = ["chats"];
        } else if (name.endsWith(".jsonl")) {
          format = provider === "Codex" ? "rollout" : "claudechat";
          selected = ["chats"];
        } else if (provider === "Codex" && name === "config.toml") {
          format = "toml";
          selected = ["settings", "mcp"];
        } else if (
          provider === "Claude" &&
          [
            ".mcp.json",
            "claude_desktop_config.json",
            ".claude.json",
            "settings.json",
            "settings.local.json",
          ].includes(name)
        ) {
          format = "json";
          selected = ["settings", "mcp"];
        } else if (name.toLowerCase().endsWith(".md")) {
          format = "markdown";
          selected = ["instructions"];
        } else
          throw Error(
            "Choose conversations.json from the Claude export, a chat JSONL, an agent configuration, or a Markdown instruction.",
          );
        picked = { file, provider, kinds: selected, format };
      }
      if (
        !Object.hasOwn(locations, provider) ||
        !Array.isArray(selected) ||
        !selected.length ||
        selected.some((k) => !categories.includes(k))
      )
        throw Error("Choose an agent and data to import.");
      const { files, warnings } = picked
        ? { files: [picked], warnings: [] }
        : await discover(provider, locations);
      skipped.push(...warnings);
      for (const source of files.filter((f) => f.kinds.some((k) => selected.includes(k)))) {
        check();
        let entries;
        try {
          entries = await extract(source, selected, locations[provider].base);
        } catch {
          skipped.push(path.basename(source.file));
          continue;
        }
        check();
        db.exec("BEGIN IMMEDIATE");
        try {
          for (const { id, provider, kind, title, body } of entries) {
            save(id, { provider, kind, title }, body);
            count++;
          }
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      }
    }
    check();
    return { count, skipped, ...paths };
  } finally {
    foreign?.close();
    db?.close();
    recovery?.key.fill(0);
    oldKey?.fill(0);
    if (writing) busy.delete(root);
  }
}
module.exports = { agentCommand };
