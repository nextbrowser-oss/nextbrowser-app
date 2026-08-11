import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "validate-skills.mjs");

function writeSkill(root, id, { skill, manifest, cases }) {
  const directory = path.join(root, id);
  fs.mkdirSync(path.join(directory, "tests"), { recursive: true });
  fs.writeFileSync(path.join(directory, "SKILL.md"), skill);
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(directory, "tests", "cases.json"), JSON.stringify(cases));
}

function validFixture(id = "example-search") {
  return {
    skill: `---\nname: ${id}\ndescription: Search example.com with pagination and deduplication.\n---\n\n# Example search\n\nUse the browser to search example.com. Verify a requested proxy before interaction, inspect stable controls, paginate to the end, deduplicate canonical URLs, recover from stale elements, and return concise results with source links. This fixture is deliberately long enough to represent a useful repository skill instruction.\n`,
    manifest: {
      id,
      name: "Example Search",
      description: "Search example.com.",
      author: "test-author",
      domains: ["example.com"],
      operations: ["search", "scrape", "paginate"],
      category: { id: "marketplaces", title: "Marketplaces", icon: "globe", order: 30 },
    },
    cases: [1, 2, 3].map((number) => ({ task: `Example task ${number}`, expects: ["returns results"] })),
  };
}

test("accepts a valid repository skill with CRLF frontmatter", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nextbrowser-valid-skills-"));
  const fixture = validFixture();
  fixture.skill = fixture.skill.replace(/\n/g, "\r\n");
  writeSkill(root, "example-search", fixture);
  const output = execFileSync(process.execPath, [script, root], { encoding: "utf8" });
  assert.match(output, /Validated 1 repository skill/);
});

test("rejects invalid metadata, instructions, and acceptance cases with actionable errors", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nextbrowser-invalid-skills-"));
  writeSkill(root, "invalid-fixture", {
    skill: "# Missing frontmatter\n",
    manifest: {
      id: "wrong-id",
      name: "Invalid Fixture",
      description: "Invalid on purpose.",
      author: "test-author",
      domains: [],
      operations: ["teleport"],
      category: { id: "Invalid Category", title: "Invalid", icon: "globe", order: 30 },
    },
    cases: [{ task: "Only one case", expects: ["failure"] }],
  });
  const result = spawnSync(process.execPath, [script, root], { encoding: "utf8" });
  assert.equal(result.status, 1);
  const errors = result.stderr;
  assert.match(errors, /manifest id must match its directory/);
  assert.match(errors, /domains must contain at least one hostname/);
  assert.match(errors, /operations contains an unsupported value/);
  assert.match(errors, /SKILL\.md must start with YAML frontmatter/);
  assert.match(errors, /tests\/cases\.json must contain at least three/);
});
