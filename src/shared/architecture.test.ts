import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import type * as TypeScript from "typescript";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const shared = resolve(root, "shared");
const ts = createRequire(import.meta.url)("typescript") as typeof TypeScript;
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(resolve(directory, entry.name)) : /\.(tsx?|css)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [resolve(directory, entry.name)] : []);
}
const sources = files(root);
const label = (path: string) => relative(root, path).replace(/\\/g, "/");

describe("shared UI architecture", () => {
  it("keeps shared independent and requires consumers to use its public UI API", () => {
    const violations: string[] = [];
    for (const path of sources.filter(path => /\.tsx?$/.test(path))) {
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
      for (const statement of source.statements) {
        if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const specifier = statement.moduleSpecifier.text;
        if (!specifier.startsWith(".")) continue;
        const target = resolve(dirname(path), specifier);
        const fromShared = path.startsWith(shared + "/") || path.startsWith(shared + "\\");
        const toShared = target === shared || target.startsWith(shared + "/") || target.startsWith(shared + "\\");
        if (fromShared && !toShared) violations.push(`${label(path)} imports upwards: ${specifier}`);
        if (!fromShared && toShared && !/^shared\/ui(?:\/tooltip)?(?:\/index)?$/.test(label(target))) violations.push(`${label(path)} imports a private shared file: ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps hover hints on the shared component instead of native title or CSS duplicates", () => {
    const violations: string[] = [];
    for (const path of sources) {
      const text = readFileSync(path, "utf8");
      if (path.endsWith(".css")) {
        if (/attr\(data-(?:nav-)?tooltip\)|\.navigation-tooltip|\.proxy-traffic-chart-tooltip/.test(text)) violations.push(label(path));
        continue;
      }
      const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      const visit = (node: TypeScript.Node) => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tag = node.tagName.getText(source);
          if (/^[a-z]/.test(tag) && tag !== "iframe" && tag !== "frame") {
            for (const attribute of node.attributes.properties) {
              if (ts.isJsxAttribute(attribute) && ["title", "data-tooltip", "data-nav-tooltip"].includes(attribute.name.getText(source))) violations.push(`${label(path)}: ${attribute.name.getText(source)}`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(violations).toEqual([]);
  });
});
