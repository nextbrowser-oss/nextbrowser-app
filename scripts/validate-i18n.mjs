#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = path.join(ROOT, "docs", "i18n", "manifest.json");
const INDEX_PATH = path.join(ROOT, "docs", "i18n", "README.md");

const EXPECTED_LOCALES = Object.freeze([
  { locale: "en", name: "English", path: "README.md" },
  { locale: "es", name: "Español", path: "docs/i18n/es/README.md" },
  { locale: "pt-BR", name: "Português (Brasil)", path: "docs/i18n/pt-BR/README.md" },
  { locale: "zh-CN", name: "简体中文", path: "docs/i18n/zh-CN/README.md" },
  { locale: "ja", name: "日本語", path: "docs/i18n/ja/README.md" },
  { locale: "ko", name: "한국어", path: "docs/i18n/ko/README.md" },
  { locale: "de", name: "Deutsch", path: "docs/i18n/de/README.md" },
  { locale: "fr", name: "Français", path: "docs/i18n/fr/README.md" },
  { locale: "ru", name: "Русский", path: "docs/i18n/ru/README.md" },
  { locale: "uk", name: "Українська", path: "docs/i18n/uk/README.md" },
  { locale: "ar", name: "العربية", path: "docs/i18n/ar/README.md" },
  { locale: "hi", name: "हिन्दी", path: "docs/i18n/hi/README.md" },
  { locale: "tr", name: "Türkçe", path: "docs/i18n/tr/README.md" },
  { locale: "id", name: "Bahasa Indonesia", path: "docs/i18n/id/README.md" },
  { locale: "vi", name: "Tiếng Việt", path: "docs/i18n/vi/README.md" },
  { locale: "th", name: "ไทย", path: "docs/i18n/th/README.md" },
  { locale: "it", name: "Italiano", path: "docs/i18n/it/README.md" },
  { locale: "pl", name: "Polski", path: "docs/i18n/pl/README.md" },
  { locale: "nl", name: "Nederlands", path: "docs/i18n/nl/README.md" },
  { locale: "fa", name: "فارسی", path: "docs/i18n/fa/README.md" },
]);

const errors = [];

function report(message) {
  errors.push(message);
}

function normalizeLf(value) {
  return value.replace(/\r\n?/g, "\n");
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function readUtf8(filePath, label) {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    report(`${label}: unable to read ${path.relative(ROOT, filePath)} (${error.message})`);
    return null;
  }
}

function extractFencedBlocks(markdown) {
  return [...markdown.matchAll(/^```[^\r\n]*\r?\n[\s\S]*?^```[ \t]*(?:\r?\n|$)/gm)].map(
    (match) => match[0],
  );
}

function selectorBlock(markdown) {
  const blocks = [...markdown.matchAll(/<p\s+align=["']center["']>[\s\S]*?<\/p>/gi)].map(
    (match) => match[0],
  );
  return blocks.find((block) => EXPECTED_LOCALES.every(({ name }) => block.includes(name))) ?? null;
}

function selectorHref(context, currentLocale, locale) {
  if (context === "index") {
    return locale === "en" ? "../../README.md" : `${locale}/README.md`;
  }
  if (context === "canonical") {
    return locale === "en" ? null : `docs/i18n/${locale}/README.md`;
  }
  if (locale === currentLocale) {
    return null;
  }
  return locale === "en" ? "../../../README.md" : `../${locale}/README.md`;
}

function validateSelector(markdown, fileLabel, context, currentLocale = null) {
  const block = selectorBlock(markdown);
  if (!block) {
    report(`${fileLabel}: no complete 20-language selector found`);
    return;
  }

  const visibleText = block.replace(/<[^>]+>/g, " ");
  for (const entry of EXPECTED_LOCALES) {
    const href = selectorHref(context, currentLocale, entry.locale);
    if (href === null) {
      if (!visibleText.includes(entry.name)) {
        report(`${fileLabel}: selector is missing current language name ${entry.name}`);
      }
      continue;
    }

    const expectedAnchor = `<a href="${href}">${entry.name}</a>`;
    if (!block.includes(expectedAnchor)) {
      report(`${fileLabel}: selector must contain ${expectedAnchor}`);
    }
  }
}

function withoutFencedBlocks(markdown) {
  return markdown.replace(/^```[^\r\n]*\r?\n[\s\S]*?^```[ \t]*(?:\r?\n|$)/gm, "");
}

function localTargets(markdown) {
  const source = withoutFencedBlocks(markdown);
  const targets = [];

  for (const match of source.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^)]*["'])?\)/g)) {
    targets.push(match[1].replace(/^<|>$/g, ""));
  }
  for (const match of source.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
    targets.push(match[1]);
  }

  return targets;
}

function validateLocalTargets(markdown, filePath, fileLabel) {
  for (const target of new Set(localTargets(markdown))) {
    if (/^(?:https?:|mailto:|data:)/i.test(target) || target.startsWith("#")) {
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
      continue;
    }
    if (target.startsWith("/")) {
      report(`${fileLabel}: repository link must be relative, found ${target}`);
      continue;
    }

    const pathPart = target.split("#", 1)[0].split("?", 1)[0];
    if (!pathPart) {
      continue;
    }

    let decoded;
    try {
      decoded = decodeURIComponent(pathPart);
    } catch {
      report(`${fileLabel}: link is not valid URI text: ${target}`);
      continue;
    }

    const resolved = path.resolve(path.dirname(filePath), decoded);
    const relative = path.relative(ROOT, resolved);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      report(`${fileLabel}: link escapes the repository: ${target}`);
      continue;
    }
    if (!existsSync(resolved)) {
      report(`${fileLabel}: local target does not exist: ${target}`);
      continue;
    }
    try {
      statSync(resolved);
    } catch (error) {
      report(`${fileLabel}: cannot inspect local target ${target} (${error.message})`);
    }
  }
}

function validateManifest(manifest, sourceHash) {
  const expectedTopLevelKeys = ["locales", "source", "sourceSha256", "version"];
  const actualTopLevelKeys = Object.keys(manifest).sort();
  if (JSON.stringify(actualTopLevelKeys) !== JSON.stringify(expectedTopLevelKeys)) {
    report(`manifest: expected exactly these top-level keys: ${expectedTopLevelKeys.join(", ")}`);
  }
  if (manifest.version !== 1) {
    report(`manifest: version must be 1, found ${JSON.stringify(manifest.version)}`);
  }
  if (manifest.source !== "README.md") {
    report(`manifest: source must be README.md, found ${JSON.stringify(manifest.source)}`);
  }
  if (manifest.sourceSha256 !== sourceHash) {
    report(`manifest: sourceSha256 is stale (expected ${sourceHash})`);
  }
  if (!Array.isArray(manifest.locales)) {
    report("manifest: locales must be an array");
    return;
  }
  if (manifest.locales.length !== EXPECTED_LOCALES.length) {
    report(`manifest: expected 20 locale records, found ${manifest.locales.length}`);
  }

  const byLocale = new Map();
  const seenPaths = new Set();
  for (const record of manifest.locales) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      report("manifest: every locale record must be an object");
      continue;
    }
    const recordKeys = Object.keys(record).sort();
    const expectedRecordKeys = ["locale", "name", "path", "sourceSha256"];
    if (JSON.stringify(recordKeys) !== JSON.stringify(expectedRecordKeys)) {
      report(`manifest: locale ${JSON.stringify(record.locale)} has unexpected fields`);
    }
    if (byLocale.has(record.locale)) {
      report(`manifest: duplicate locale ${record.locale}`);
    }
    if (seenPaths.has(record.path)) {
      report(`manifest: duplicate path ${record.path}`);
    }
    byLocale.set(record.locale, record);
    seenPaths.add(record.path);
  }

  for (const expected of EXPECTED_LOCALES) {
    const record = byLocale.get(expected.locale);
    if (!record) {
      report(`manifest: missing locale ${expected.locale}`);
      continue;
    }
    if (record.name !== expected.name) {
      report(`manifest: ${expected.locale} name must be ${expected.name}`);
    }
    if (record.path !== expected.path) {
      report(`manifest: ${expected.locale} path must be ${expected.path}`);
    }
    if (record.sourceSha256 !== sourceHash) {
      report(`manifest: ${expected.locale} sourceSha256 is stale`);
    }
  }

  for (const locale of byLocale.keys()) {
    if (!EXPECTED_LOCALES.some((expected) => expected.locale === locale)) {
      report(`manifest: unexpected locale ${locale}`);
    }
  }
}

function main() {
  const canonicalEntry = EXPECTED_LOCALES[0];
  const canonicalPath = path.join(ROOT, ...canonicalEntry.path.split("/"));
  const canonical = readUtf8(canonicalPath, "canonical README");
  if (canonical === null) {
    throw new Error("Cannot continue without the canonical README");
  }
  const canonicalHash = sha256(normalizeLf(canonical));

  let manifest = null;
  const manifestText = readUtf8(MANIFEST_PATH, "manifest");
  if (manifestText !== null) {
    try {
      manifest = JSON.parse(manifestText);
    } catch (error) {
      report(`manifest: invalid JSON (${error.message})`);
    }
  }
  if (manifest !== null) {
    validateManifest(manifest, canonicalHash);
  }

  const editions = new Map();
  for (const entry of EXPECTED_LOCALES) {
    const filePath = path.join(ROOT, ...entry.path.split("/"));
    const markdown = readUtf8(filePath, entry.locale);
    if (markdown === null) {
      continue;
    }
    editions.set(entry.locale, { entry, filePath, markdown });

    if (entry.locale !== "en") {
      const marker = normalizeLf(markdown).match(
        /^<!-- i18n-source-sha256: ([0-9a-f]{64}) -->\n/,
      );
      if (!marker) {
        report(`${entry.locale}: missing source SHA-256 marker on the first line`);
      } else if (marker[1] !== canonicalHash) {
        report(`${entry.locale}: stale translation marker (expected ${canonicalHash})`);
      }
    }
  }

  const canonicalFences = extractFencedBlocks(canonical);
  for (const [locale, edition] of editions) {
    if (locale === "en") {
      continue;
    }
    const translatedFences = extractFencedBlocks(edition.markdown);
    if (translatedFences.length !== canonicalFences.length) {
      report(
        `${locale}: expected ${canonicalFences.length} fenced code block(s), found ${translatedFences.length}`,
      );
      continue;
    }
    translatedFences.forEach((block, index) => {
      if (block !== canonicalFences[index]) {
        report(`${locale}: fenced code block ${index + 1} differs from canonical README.md`);
      }
    });
  }

  validateSelector(canonical, "README.md", "canonical", "en");
  validateLocalTargets(canonical, canonicalPath, "README.md");

  for (const [locale, edition] of editions) {
    if (locale === "en") {
      continue;
    }
    validateSelector(edition.markdown, edition.entry.path, "translation", locale);
    validateLocalTargets(edition.markdown, edition.filePath, edition.entry.path);
  }

  const index = readUtf8(INDEX_PATH, "language index");
  if (index !== null) {
    validateSelector(index, "docs/i18n/README.md", "index");
    validateLocalTargets(index, INDEX_PATH, "docs/i18n/README.md");
  }

  if (errors.length > 0) {
    console.error(`i18n validation failed with ${errors.length} error(s):`);
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("i18n validation passed for 20 README editions and the language index.");
}

try {
  main();
} catch (error) {
  console.error(`i18n validation could not complete: ${error.message}`);
  process.exitCode = 1;
}
