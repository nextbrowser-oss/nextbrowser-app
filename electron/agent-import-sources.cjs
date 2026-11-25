const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { parse: parseToml } = require("smol-toml");
const { createHash } = require("node:crypto");

const categories = ["chats", "settings", "mcp", "instructions"];
const stableId = (value) => createHash("sha256").update(value).digest("hex");
function sources() {
  const home = os.homedir();
  const support =
    process.platform === "darwin"
      ? path.join(home, "Library", "Application Support")
      : process.env.APPDATA || process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return {
    Codex: { base: process.env.CODEX_HOME || path.join(home, ".codex"), userSkills: path.join(home, ".agents", "skills") },
    Claude: {
      base: process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"),
      global: process.env.CLAUDE_CONFIG_DIR
        ? path.join(process.env.CLAUDE_CONFIG_DIR, ".claude.json")
        : path.join(home, ".claude.json"),
      desktop: path.join(support, "Claude", "claude_desktop_config.json"),
    },
  };
}

// Discover regular files only. Recheck the same canonical path before reading.
async function discover(provider, locations = sources()) {
  if (!Object.hasOwn(locations, provider)) throw Error("Unknown import source.");
  const { base, global, desktop, userSkills } = locations[provider];
  const files = [];
  const warnings = [];
  async function stat(file) {
    try {
      return await fs.lstat(file);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") warnings.push(path.basename(file));
    }
  }
  async function add(file, kinds, format) {
    const info = await stat(file);
    if (info?.isFile()) files.push({ file, kinds, format, provider, size: info.size });
  }
  async function walk(dir, depth, match, kinds, format) {
    if (!(await stat(dir))?.isDirectory()) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      warnings.push(path.basename(dir));
      return;
    }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isFile() && match.test(entry.name)) await add(file, kinds, format);
      else if (entry.isDirectory() && depth > 0 && entry.name !== "subagents")
        await walk(file, depth - 1, match, kinds, format);
    }
  }
  if (provider === "Codex") {
    for (const dir of ["sessions", "archived_sessions"])
      await walk(path.join(base, dir), 3, /^rollout-.+\.jsonl$/, ["chats"], "rollout");
    await add(path.join(base, "config.toml"), ["settings", "mcp"], "toml");
    await walk(path.join(base, "prompts"), 2, /\.md$/i, ["instructions"], "markdown");
    if (userSkills) await walk(userSkills, 1, /^SKILL\.md$/i, ["instructions"], "markdown");
    for (const file of ["AGENTS.md", "AGENTS.override.md"])
      await add(path.join(base, file), ["instructions"], "markdown");
  } else {
    await walk(path.join(base, "projects"), 1, /^[a-f0-9-]+\.jsonl$/i, ["chats"], "claudechat");
    await add(path.join(base, "settings.json"), ["settings"], "json");
    if (global) await add(global, ["mcp"], "json");
    if (desktop) await add(desktop, ["mcp"], "json");
    await add(path.join(base, "CLAUDE.md"), ["instructions"], "markdown");
    await walk(path.join(base, "commands"), 3, /\.md$/i, ["instructions"], "markdown");
    await walk(path.join(base, "rules"), 3, /\.md$/i, ["instructions"], "markdown");
    await walk(path.join(base, "agents"), 3, /\.md$/i, ["instructions"], "markdown");
  }
  await walk(path.join(base, "skills"), 1, /^SKILL\.md$/i, ["instructions"], "markdown");
  return { files, warnings };
}

async function messages(lines, codex) {
  const turns = [],
    fallback = [];
  let malformed = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line.trimStart());
    } catch {
      malformed++;
      continue;
    }
    if (
      codex &&
      row.type === "event_msg" &&
      ["user_message", "agent_message"].includes(row.payload?.type) &&
      typeof row.payload.message === "string"
    ) {
      fallback.push({
        role: row.payload.type === "user_message" ? "user" : "assistant",
        text: row.payload.message,
      });
    }
    const msg = codex ? row.payload : row.message;
    if (
      !msg ||
      (codex
        ? row.type !== "response_item" || msg.type !== "message"
        : row.isMeta || row.isSidechain || !["user", "assistant"].includes(row.type))
    )
      continue;
    if (!["user", "assistant"].includes(msg.role)) continue;
    const body =
      typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content
              .filter(
                (b) =>
                  ["text", "input_text", "output_text"].includes(b?.type) && typeof b.text === "string",
              )
              .map((b) => b.text)
              .join("\n")
          : "";
    if (body.trim()) turns.push({ role: msg.role, text: body });
  }
  if (malformed) throw Error("Invalid chat records. Try again after the agent finishes writing.");
  return turns.length ? turns : fallback;
}

function mcpManifest(server) {
  if (!server || typeof server !== "object") return;
  if (typeof server.url === "string") {
    try {
      const url = new URL(server.url);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        return;
      return { url: url.toString() };
    } catch {
      return;
    }
  }
  if (typeof server.command !== "string" || !server.command.trim()) return;
  // Environment values, authorization headers and custom command arguments may be credentials.
  // Keep conventional launchers and package/path arguments. Anything else needs manual review.
  const args = Array.isArray(server.args)
    ? server.args.map((arg) => {
        if (typeof arg !== "string") return "<review>";
        return /^(?:-y|--yes|run|exec|x|@[\w.-]+\/[\w.-]+(?:@[\w.~^-]+)?|[\w.-]*(?:mcp|server)[\w.-]*(?:@[\w.~^-]+)?|(?:[.\\/A-Za-z]:?)?[\w .\\/-]*\.(?:js|mjs|cjs|py))$/i.test(
          arg,
        )
          ? arg
          : "<review>";
      })
    : [];
  return { command: server.command, args };
}

async function extract(source, kinds, base) {
  const actual = await fs.realpath(source.file);
  const root = await fs.realpath(base).catch(() => base);
  // Windows profile folders can live under a junction; permit the canonical base, not links inside it.
  const rel = path.relative(base, source.file);
  const expected =
    rel.startsWith(".." + path.sep) || path.isAbsolute(rel)
      ? path.resolve(source.file)
      : path.resolve(root, rel);
  if (path.relative(expected, actual) !== "") throw Error("Linked files are skipped.");
  const handle = await fs.open(actual, "r");
  let text;
  let transcript;
  try {
    const size = (await handle.stat()).size;
    if (source.format === "rollout" || source.format === "claudechat") {
      transcript = await messages(handle.readLines({ autoClose: false }), source.format === "rollout");
    } else {
      if (size > 64 * 1024 * 1024) throw Error("File exceeds the 64 MiB import limit.");
      text = (await handle.readFile("utf8")).replace(/^\uFEFF/, "");
    }
    if ((await handle.stat()).size !== size) throw Error("Source changed during import.");
  } finally {
    await handle.close();
  }
  const result = [];
  const name = path.basename(source.file);
  function entry(kind, key, title, body) {
    result.push({
      id: stableId(JSON.stringify([source.provider, source.format === "claude-export" ? "export" : path.normalize(rel), kind, key])),
      provider: source.provider,
      kind,
      title,
      body,
    });
  }
  if (source.format === "claude-export") {
    const chats = JSON.parse(text);
    if (!Array.isArray(chats)) throw Error("Expected a Claude conversation export.");
    for (const chat of chats) {
      if (typeof chat?.uuid !== "string" || !Array.isArray(chat.chat_messages)) continue;
      const turns = chat.chat_messages
        .filter((m) => ["human", "assistant"].includes(m.sender))
        .map((m) => ({
          role: m.sender === "human" ? "user" : "assistant",
          text:
            typeof m.text === "string" && m.text
              ? m.text
              : Array.isArray(m.content)
                ? m.content
                    .filter((c) => c?.type === "text" && typeof c.text === "string")
                    .map((c) => c.text)
                    .join("\n")
                : "",
        }))
        .filter((m) => m.text.trim());
      if (turns.length) entry("chats", chat.uuid, String(chat.name || turns[0].text).slice(0, 100), turns);
    }
  } else if (transcript) {
    const turns = transcript;
    if (turns.length)
      entry(
        "chats",
        "",
        (turns.find((t) => t.role === "user")?.text || name).replace(/\s+/g, " ").slice(0, 100),
        turns,
      );
  } else if (source.format === "markdown") {
    if (text.trim())
      entry(
        "instructions",
        "",
        name === "SKILL.md" ? path.basename(path.dirname(source.file)) : name,
        text,
      );
  } else {
    const config = source.format === "toml" ? parseToml(text) : JSON.parse(text);
    if (kinds.includes("settings") && source.kinds.includes("settings")) {
      const settings = {};
      for (const field of [
        "model",
        "model_provider",
        "model_reasoning_effort",
        "model_verbosity",
        "personality",
        "approval_policy",
        "sandbox_mode",
        "theme",
        "language",
        "effortLevel",
        "outputStyle",
      ]) {
        if (typeof config[field] === "string") settings[field] = config[field];
      }
      if (Object.keys(settings).length) entry("settings", "", name, settings);
    }
    if (kinds.includes("mcp") && source.kinds.includes("mcp")) {
      function parseServers(servers, prefix = "") {
        for (const [key, server] of Object.entries(servers || {})) {
          const manifest = mcpManifest(server);
          if (manifest)
            entry("mcp", prefix + key, prefix ? key + " · " + path.basename(prefix) : key, manifest);
        }
      }
      parseServers(config.mcp_servers || config.mcpServers);
      for (const [project, settings] of Object.entries(config.projects || {}))
        parseServers(settings?.mcpServers, project + "/");
    }
  }
  return result;
}
module.exports = { categories, sources, discover, extract, stableId, mcpManifest };
