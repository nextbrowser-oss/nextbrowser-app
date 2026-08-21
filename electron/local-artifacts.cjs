const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

const MAX_ARTIFACT_BYTES = 1024 * 1024 * 1024;

function workspaceKey(workspaceId) {
  const value = String(workspaceId || "").trim();
  if (!value) throw new Error("A workspace is required for local artifacts.");
  return createHash("sha256").update(value).digest("hex");
}

function safeFileName(value) {
  return path.basename(String(value || "artifact"))
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "-")
    .slice(0, 180) || "artifact";
}

function publicArtifact(item) {
  return {
    id: item.id,
    name: item.name,
    size: item.size,
    createdAt: item.createdAt,
    extension: path.extname(item.name).replace(/^\./, "").toLowerCase(),
    contentType: item.contentType || "application/octet-stream",
    runId: item.runId,
  };
}

function createLocalArtifactStore({ rootDir, now = () => Date.now(), makeId = randomUUID } = {}) {
  if (!rootDir || !path.isAbsolute(rootDir)) throw new Error("Local artifact storage requires an absolute root directory.");
  const queues = new Map();

  function locations(workspaceId) {
    const root = path.join(rootDir, workspaceKey(workspaceId));
    return { root, files: path.join(root, "files"), index: path.join(root, "index.json") };
  }

  async function ensureWorkspace(workspaceId) {
    const result = locations(workspaceId);
    await fs.mkdir(result.files, { recursive: true, mode: 0o700 });
    return result;
  }

  async function readIndex(workspaceId) {
    const location = locations(workspaceId);
    try {
      const parsed = JSON.parse(await fs.readFile(location.index, "utf8"));
      if (!Array.isArray(parsed)) throw new Error("not an array");
      return parsed.filter((item) => item
        && typeof item.id === "string"
        && typeof item.name === "string"
        && typeof item.storedName === "string"
        && Number.isFinite(item.size)
        && Number.isFinite(item.createdAt));
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw new Error("The local artifact index is damaged. Move or rename it before trying again.");
    }
  }

  async function writeIndex(workspaceId, items) {
    const location = await ensureWorkspace(workspaceId);
    const temporary = path.join(location.root, `.index-${makeId()}.tmp`);
    await fs.writeFile(temporary, `${JSON.stringify(items, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, location.index);
  }

  function enqueue(workspaceId, operation) {
    const key = workspaceKey(workspaceId);
    const previous = queues.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    queues.set(key, current);
    return current.finally(() => {
      if (queues.get(key) === current) queues.delete(key);
    });
  }

  async function addBytes(workspaceId, name, bytes, options = {}) {
    const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    if (data.byteLength > MAX_ARTIFACT_BYTES) throw new Error(`${safeFileName(name)} is larger than 1 GiB.`);
    const location = await ensureWorkspace(workspaceId);
    const items = await readIndex(workspaceId);
    const id = makeId();
    const displayName = safeFileName(name);
    const storedName = `${id}--${displayName}`;
    const target = path.join(location.files, storedName);
    const temporary = `${target}.tmp`;
    await fs.writeFile(temporary, data, { mode: 0o600 });
    await fs.rename(temporary, target);
    const item = { id, name: displayName, storedName, size: data.byteLength, createdAt: now(), contentType: options.contentType, runId: options.runId };
    try {
      await writeIndex(workspaceId, [...items, item]);
    } catch (error) {
      await fs.rm(target, { force: true }).catch(() => undefined);
      throw error;
    }
    return publicArtifact(item);
  }

  return {
    async list(workspaceId) {
      return (await readIndex(workspaceId)).map(publicArtifact).sort((a, b) => b.createdAt - a.createdAt);
    },

    importFile(workspaceId, filePath) {
      return enqueue(workspaceId, async () => {
        const stat = await fs.stat(filePath);
        const displayName = safeFileName(filePath);
        if (!stat.isFile()) throw new Error(`${displayName} is not a regular file.`);
        if (stat.size > MAX_ARTIFACT_BYTES) throw new Error(`${displayName} is larger than 1 GiB.`);
        const location = await ensureWorkspace(workspaceId);
        const items = await readIndex(workspaceId);
        const id = makeId();
        const storedName = `${id}--${displayName}`;
        const target = path.join(location.files, storedName);
        const temporary = `${target}.tmp`;
        await fs.copyFile(filePath, temporary);
        await fs.chmod(temporary, 0o600);
        await fs.rename(temporary, target);
        const item = { id, name: displayName, storedName, size: stat.size, createdAt: now(), contentType: "application/octet-stream" };
        try {
          await writeIndex(workspaceId, [...items, item]);
        } catch (error) {
          await fs.rm(target, { force: true }).catch(() => undefined);
          throw error;
        }
        return publicArtifact(item);
      });
    },

    addBytes(workspaceId, name, bytes, options) {
      return enqueue(workspaceId, () => addBytes(workspaceId, name, bytes, options));
    },

    async resolvePath(workspaceId, id) {
      const item = (await readIndex(workspaceId)).find((candidate) => candidate.id === id);
      if (!item) throw new Error("This local artifact no longer exists.");
      const location = locations(workspaceId);
      const target = path.join(location.files, path.basename(item.storedName));
      const stat = await fs.stat(target).catch(() => null);
      if (!stat?.isFile()) throw new Error("The artifact file was removed from local storage.");
      return target;
    },

    delete(workspaceId, id) {
      return enqueue(workspaceId, async () => {
        const items = await readIndex(workspaceId);
        const item = items.find((candidate) => candidate.id === id);
        if (!item) return { deleted: false };
        await fs.rm(path.join(locations(workspaceId).files, path.basename(item.storedName)), { force: true });
        await writeIndex(workspaceId, items.filter((candidate) => candidate.id !== id));
        return { deleted: true };
      });
    },

    seedExamples(workspaceId) {
      return enqueue(workspaceId, async () => {
        const existing = await readIndex(workspaceId);
        let seeded = 0;
        if (!existing.some((item) => item.name === "product-research-demo.csv")) {
          await addBytes(workspaceId, "product-research-demo.csv", Buffer.from("product,price,status\nStarter plan,$19,available\nTeam plan,$49,available\nBusiness plan,$99,available\n"));
          seeded += 1;
        }
        const refreshed = await readIndex(workspaceId);
        if (!refreshed.some((item) => item.name === "automation-run-demo.json")) {
          await addBytes(workspaceId, "automation-run-demo.json", Buffer.from(JSON.stringify({ success: true, workflow: "Search a knowledge base", results: [{ title: "Browser automation guide", url: "https://example.com/guide" }], generated_at: new Date(now()).toISOString() }, null, 2)));
          seeded += 1;
        }
        return seeded;
      });
    },
  };
}

module.exports = { MAX_ARTIFACT_BYTES, createLocalArtifactStore, safeFileName, workspaceKey };
