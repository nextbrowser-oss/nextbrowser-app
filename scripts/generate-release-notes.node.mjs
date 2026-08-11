import assert from "node:assert/strict";
import test from "node:test";
import { groupCommitSubjects, renderReleaseNotes } from "./generate-release-notes.mjs";

test("groups and formats user-facing commits", () => {
  const result = groupCommitSubjects([
    "feat: add browser sign-in",
    "fix(auth): preserve sessions",
    "perf!: speed up startup",
    "docs: update readme",
    "chore: rotate release credentials",
  ]);

  assert.deepEqual(result.groups.Features, ["Add browser sign-in"]);
  assert.deepEqual(result.groups.Fixes, ["Preserve sessions"]);
  assert.deepEqual(result.groups.Improvements, ["Speed up startup (breaking change)"]);
  assert.deepEqual(result.changes, ["Update readme"]);
});

test("renders grouped and ungrouped changes with a comparison link", () => {
  const notes = renderReleaseNotes(
    ["feat: add browser sign-in", "fix: preserve sessions", "Improve keyboard navigation"],
    "nextbrowser-oss/nextbrowser-app",
    "v0.2.0",
    "v0.2.1",
  );

  assert.equal(
    notes,
    "## Changelog\n\n### Features\n- Add browser sign-in\n\n### Fixes\n- Preserve sessions\n\n### Changes\n- Improve keyboard navigation\n\n**Full Changelog**: https://github.com/nextbrowser-oss/nextbrowser-app/compare/v0.2.0...v0.2.1\n",
  );
});

test("keeps non-conventional commits when no grouped commits exist", () => {
  const notes = renderReleaseNotes(["Update dependencies"], "nextbrowser-oss/nextbrowser-app", "", "v0.1.0");
  assert.equal(notes, "## Changelog\n\n### Changes\n- Update dependencies\n");
});

test("keeps all v0.2.5 user-facing changes", () => {
  const notes = renderReleaseNotes(
    [
      "Support multiple repository skills in catalog tests",
      "Fail fast on invalid repository skills",
      "Document browser skill contributions",
      "chore: remove secret transfer workflow",
      "chore: transfer release bot Slack secrets",
      "feat: generate changelog from release commits",
      "Make skill validation cross-platform",
      "Add repository-contributed browser skills",
    ],
    "nextbrowser-oss/nextbrowser-app",
    "v0.2.4",
    "v0.2.5",
  );

  assert.match(notes, /- Generate changelog from release commits/);
  assert.match(notes, /- Support multiple repository skills in catalog tests/);
  assert.match(notes, /- Add repository-contributed browser skills/);
  assert.doesNotMatch(notes, /secret transfer/);
});

test("rejects releases containing only internal maintenance commits", () => {
  assert.throws(
    () => renderReleaseNotes(["chore: update release workflow", "test: cover updater"], "owner/repo", "", "v1.0.0"),
    /No user-facing commits found/,
  );
});
