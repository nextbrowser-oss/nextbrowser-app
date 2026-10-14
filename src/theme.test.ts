import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveTheme } from "./theme";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

function declaredTokens(css: string): Set<string> {
  return new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
}

function rootBlock(selector: string): string {
  const start = styles.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing ${selector} block`);
  return styles.slice(start, styles.indexOf("}", start));
}

describe("theme selection", () => {
  it("prefers an explicit saved theme", () => {
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("light", false)).toBe("light");
  });

  it("falls back to the operating-system preference", () => {
    expect(resolveTheme(null, true)).toBe("light");
    expect(resolveTheme("invalid", false)).toBe("dark");
  });
});

describe("theme stylesheet", () => {
  // An undefined var() without a fallback makes the declaration invalid, so
  // the color silently falls back to inherit/currentColor in both themes.
  it("defines every custom property it uses without a fallback", () => {
    const defined = declaredTokens(styles);
    const undefinedTokens = [...styles.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)]
      .map((match) => match[1])
      .filter((name) => !defined.has(name));
    expect([...new Set(undefinedTokens)]).toEqual([]);
  });

  it("gives every light-theme token a dark-theme value", () => {
    const dark = declaredTokens(rootBlock(":root"));
    const lightOnly = [...declaredTokens(rootBlock(':root[data-theme="light"]'))]
      .filter((name) => !dark.has(name));
    expect(lightOnly).toEqual([]);
  });
});
