import fs from "node:fs";
import path from "node:path";

const root = path.resolve("skills");
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
