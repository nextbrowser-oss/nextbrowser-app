import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const groupOrder = ["Features", "Fixes", "Improvements"];
const commitGroups = {
  feat: "Features",
  fix: "Fixes",
  perf: "Improvements",
  refactor: "Improvements",
};
const ignoredCommitTypes = new Set(["build", "chore", "ci", "style", "test"]);
const commitPattern = /^([a-z]+)(?:\([\w.-]+\))?(!)?:\s+(.+)$/i;

function formatDescription(value, breaking) {
  const description = value.trim();
  const formatted = `${description.charAt(0).toUpperCase()}${description.slice(1)}`;
  return breaking ? `${formatted} (breaking change)` : formatted;
}

export function groupCommitSubjects(subjects) {
  const groups = Object.fromEntries(groupOrder.map((name) => [name, []]));
  const changes = [];
  const seen = new Set();

  for (const value of subjects) {
    const subject = value.trim();
    if (!subject) continue;
    const match = subject.match(commitPattern);
    if (!match) {
      addUnique(changes, formatDescription(subject, false), seen);
      continue;
    }

    const type = match[1].toLowerCase();
    if (ignoredCommitTypes.has(type)) continue;

    const description = formatDescription(match[3], Boolean(match[2]));
    const group = commitGroups[type];
    addUnique(group ? groups[group] : changes, description, seen);
  }

  return { groups, changes };
}

function addUnique(items, value, seen) {
  const key = value.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  items.push(value);
}

export function renderReleaseNotes(subjects, repository, previousTag, currentTag) {
  const { groups, changes } = groupCommitSubjects(subjects);
  const lines = ["## Changelog"];
  let changeCount = 0;

  for (const name of groupOrder) {
    if (groups[name].length === 0) continue;
    changeCount += groups[name].length;
    lines.push("", `### ${name}`, ...groups[name].map((subject) => `- ${subject}`));
  }

  if (changes.length > 0) {
    changeCount += changes.length;
    lines.push("", "### Changes", ...changes.map((subject) => `- ${subject}`));
  }

  if (changeCount === 0) throw new Error("No user-facing commits found for release notes");

  if (previousTag) {
    lines.push("", `**Full Changelog**: https://github.com/${repository}/compare/${previousTag}...${currentTag}`);
  }

  return `${lines.join("\n")}\n`;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function findPreviousTag(currentTag) {
  try {
    return git("describe", "--tags", "--match", "v[0-9]*", "--abbrev=0", `${currentTag}^`);
  } catch {
    return "";
  }
}

function main() {
  const currentTag = process.argv[2] ?? "";
  const outputPath = process.argv[3] ?? "";
  const repository = process.env.GITHUB_REPOSITORY ?? "nextbrowser-oss/nextbrowser-app";
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(currentTag)) {
    throw new Error(`Expected a v-prefixed semantic version tag, got: ${currentTag}`);
  }
  if (!outputPath) throw new Error("Expected an output path");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error(`Invalid GitHub repository: ${repository}`);

  const previousTag = findPreviousTag(currentTag);
  const range = previousTag ? `${previousTag}..${currentTag}` : currentTag;
  const subjects = git("log", "--format=%s", "--no-merges", range).split("\n");
  fs.writeFileSync(outputPath, renderReleaseNotes(subjects, repository, previousTag, currentTag));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
