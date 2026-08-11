import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const groupOrder = ["Features", "Fixes", "Improvements"];
const commitPattern = /^(feat|fix|perf|refactor)(?:\([\w.-]+\))?!?:\s+.+/;

export function groupCommitSubjects(subjects) {
  const groups = Object.fromEntries(groupOrder.map((name) => [name, []]));
  const changes = [];

  for (const value of subjects) {
    const subject = value.trim();
    if (!subject) continue;
    const match = subject.match(commitPattern);
    if (!match) {
      changes.push(subject);
      continue;
    }
    if (match[1] === "feat") groups.Features.push(subject);
    if (match[1] === "fix") groups.Fixes.push(subject);
    if (match[1] === "perf" || match[1] === "refactor") groups.Improvements.push(subject);
  }

  return { groups, changes };
}

export function renderReleaseNotes(subjects, repository, previousTag, currentTag) {
  const { groups, changes } = groupCommitSubjects(subjects);
  const lines = ["## Changelog"];
  let groupedCount = 0;

  for (const name of groupOrder) {
    if (groups[name].length === 0) continue;
    groupedCount += groups[name].length;
    lines.push(`### ${name}`, ...groups[name].map((subject) => `* ${subject}`));
  }

  if (groupedCount === 0) {
    if (changes.length === 0) throw new Error("No commits found for release notes");
    lines.push("### Changes", ...changes.map((subject) => `* ${subject}`));
  }

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
