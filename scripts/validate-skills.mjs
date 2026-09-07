import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "skills");
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const allowedOperations = new Set(["search", "scrape", "paginate", "post", "comment", "message", "form"]);
const failures = [];

for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = path.join(root, entry.name);
  if (!slugPattern.test(entry.name)) failures.push(`${entry.name}: directory must be a lowercase kebab-case slug`);
  for (const required of ["SKILL.md", "manifest.json", "tests/cases.json"]) {
    if (!fs.existsSync(path.join(dir, required))) failures.push(`${entry.name}: missing ${required}`);
  }
  if (!fs.existsSync(path.join(dir, "manifest.json"))) continue;
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")); }
  catch { failures.push(`${entry.name}: manifest.json is not valid JSON`); continue; }
  if (manifest.id !== entry.name) failures.push(`${entry.name}: manifest id must match its directory`);
  for (const field of ["name", "description", "author"]) {
    if (typeof manifest[field] !== "string" || !manifest[field].trim()) failures.push(`${entry.name}: ${field} is required`);
  }
  if (!Array.isArray(manifest.domains) || !manifest.domains.length || manifest.domains.some((domain) => typeof domain !== "string" || !domain.includes("."))) {
    failures.push(`${entry.name}: domains must contain at least one hostname`);
  }
  if (!Array.isArray(manifest.operations) || !manifest.operations.length || manifest.operations.some((operation) => !allowedOperations.has(operation))) {
    failures.push(`${entry.name}: operations contains an unsupported value`);
  }
  if (!manifest.category || !slugPattern.test(manifest.category.id ?? "") || typeof manifest.category.title !== "string" || typeof manifest.category.icon !== "string" || !Number.isInteger(manifest.category.order)) {
    failures.push(`${entry.name}: category must include id, title, icon, and integer order`);
  }
  // Where the skill runs. A cloud-phone skill drives the site's Android app on
  // a Multilogin phone, and the app prepares no browser profile for it, so an
  // unknown value would silently get the wrong device.
  if (manifest.runtime != null && !["browser", "cloud-phone"].includes(manifest.runtime)) {
    failures.push(`${entry.name}: runtime must be browser or cloud-phone`);
  }
  // A watchlist is optional, but a half-declared one renders a manager the app
  // cannot run, so every field it needs is required once the block exists.
  if (manifest.watchlist != null) {
    const watchlist = manifest.watchlist;
    if (typeof watchlist !== "object" || Array.isArray(watchlist)) {
      failures.push(`${entry.name}: watchlist must be an object`);
    } else {
      for (const field of ["title", "placeholder"]) {
        if (typeof watchlist[field] !== "string" || !watchlist[field].trim()) failures.push(`${entry.name}: watchlist.${field} is required`);
      }
      // The tasks live either on the watchlist or on each transport. Checking
      // both the same way keeps a device from shipping with no pass to run.
      const taskHolders = Array.isArray(watchlist.transports) && watchlist.transports.length
        ? watchlist.transports
        : [watchlist];
      if (watchlist.transports != null && (!Array.isArray(watchlist.transports) || watchlist.transports.length < 2)) {
        failures.push(`${entry.name}: watchlist.transports must list at least two devices`);
      }
      const transportIds = new Set();
      for (const holder of taskHolders) {
        const where = holder === watchlist ? "watchlist" : `watchlist.transports[${holder?.id ?? "?"}]`;
        if (typeof holder !== "object" || holder == null || Array.isArray(holder)) {
          failures.push(`${entry.name}: ${where} must be an object`);
          continue;
        }
        if (holder !== watchlist) {
          for (const field of ["id", "label"]) {
            if (typeof holder[field] !== "string" || !holder[field].trim()) failures.push(`${entry.name}: ${where}.${field} is required`);
          }
          if (typeof holder.id === "string") {
            if (!slugPattern.test(holder.id)) failures.push(`${entry.name}: ${where}.id must be a lowercase kebab-case slug`);
            if (transportIds.has(holder.id)) failures.push(`${entry.name}: ${where}.id is used twice`);
            transportIds.add(holder.id);
          }
          if (holder.runtime != null && !["browser", "cloud-phone"].includes(holder.runtime)) {
            failures.push(`${entry.name}: ${where}.runtime must be browser or cloud-phone`);
          }
        }
        for (const field of ["subscribeTask", "checkTask"]) {
          if (typeof holder[field] !== "string" || !holder[field].trim()) failures.push(`${entry.name}: ${where}.${field} is required`);
        }
        if (typeof holder.subscribeTask === "string" && !holder.subscribeTask.includes("{handle}")) {
          failures.push(`${entry.name}: ${where}.subscribeTask must contain {handle}`);
        }
        if (typeof holder.checkTask === "string" && !holder.checkTask.includes("{handles}")) {
          failures.push(`${entry.name}: ${where}.checkTask must contain {handles}`);
        }
      }
      if (watchlist.profileUrl != null && (typeof watchlist.profileUrl !== "string" || !watchlist.profileUrl.startsWith("https://") || !watchlist.profileUrl.includes("{handle}"))) {
        failures.push(`${entry.name}: watchlist.profileUrl must be an https template containing {handle}`);
      }
      if (watchlist.stateFile != null && (typeof watchlist.stateFile !== "string" || !/^[A-Za-z0-9._-]+$/.test(watchlist.stateFile))) {
        failures.push(`${entry.name}: watchlist.stateFile must be a plain file name`);
      }
      if (watchlist.handleMaxLength != null && (!Number.isInteger(watchlist.handleMaxLength) || watchlist.handleMaxLength < 1 || watchlist.handleMaxLength > 64)) {
        failures.push(`${entry.name}: watchlist.handleMaxLength must be an integer between 1 and 64`);
      }
      // An engine name the app does not implement would silently fall back to
      // the chat path, which is a different product than the manifest promises.
      if (watchlist.engine != null && !["x-reply"].includes(watchlist.engine)) {
        failures.push(`${entry.name}: watchlist.engine is not a built-in engine`);
      }
    }
  }
  const skillPath = path.join(dir, "SKILL.md");
  if (fs.existsSync(skillPath)) {
    // Git commonly checks text files out with CRLF on Windows. Normalize the
    // contents before validating Markdown structure so CI behaves identically
    // on macOS, Linux, and Windows. Strip a possible UTF-8 BOM as well.
    const skill = fs.readFileSync(skillPath, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
    if (!skill.startsWith("---\n")) failures.push(`${entry.name}: SKILL.md must start with YAML frontmatter`);
    if (!skill.includes(`name: ${entry.name}`)) failures.push(`${entry.name}: SKILL.md frontmatter name must match the manifest id`);
    if (skill.length < 400) failures.push(`${entry.name}: SKILL.md is too short to be useful`);
    if (/api[_ -]?key|password\s*[:=]|bearer\s+[a-z0-9]/i.test(skill)) failures.push(`${entry.name}: SKILL.md may contain credentials`);
  }
  const casesPath = path.join(dir, "tests", "cases.json");
  if (fs.existsSync(casesPath)) {
    try {
      const cases = JSON.parse(fs.readFileSync(casesPath, "utf8"));
      if (!Array.isArray(cases) || cases.length < 3 || cases.some((testCase) => typeof testCase?.task !== "string" || !Array.isArray(testCase?.expects))) {
        failures.push(`${entry.name}: tests/cases.json must contain at least three task/expects cases`);
      }
    } catch { failures.push(`${entry.name}: tests/cases.json is not valid JSON`); }
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log(`Validated ${fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length} repository skill(s).`);
