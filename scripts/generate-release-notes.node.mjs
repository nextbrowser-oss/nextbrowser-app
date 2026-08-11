import assert from "node:assert/strict";
import test from "node:test";
import { groupCommitSubjects, renderReleaseNotes } from "./generate-release-notes.mjs";

test("groups conventional commits like clawctl", () => {
  const result = groupCommitSubjects([
    "feat: add browser sign-in",
    "fix(auth): preserve sessions",
    "perf!: speed up startup",
    "docs: update readme",
  ]);

  assert.deepEqual(result.groups.Features, ["feat: add browser sign-in"]);
  assert.deepEqual(result.groups.Fixes, ["fix(auth): preserve sessions"]);
  assert.deepEqual(result.groups.Improvements, ["perf!: speed up startup"]);
  assert.deepEqual(result.changes, ["docs: update readme"]);
});

test("renders grouped changelog and comparison link", () => {
  const notes = renderReleaseNotes(
    ["feat: add browser sign-in", "fix: preserve sessions"],
    "nextbrowser-oss/nextbrowser-app",
    "v0.2.0",
    "v0.2.1",
  );

  assert.equal(
    notes,
    "## Changelog\n### Features\n* feat: add browser sign-in\n### Fixes\n* fix: preserve sessions\n\n**Full Changelog**: https://github.com/nextbrowser-oss/nextbrowser-app/compare/v0.2.0...v0.2.1\n",
  );
});

test("keeps non-conventional commits when no grouped commits exist", () => {
  const notes = renderReleaseNotes(["Update dependencies"], "nextbrowser-oss/nextbrowser-app", "", "v0.1.0");
  assert.equal(notes, "## Changelog\n### Changes\n* Update dependencies\n");
});
