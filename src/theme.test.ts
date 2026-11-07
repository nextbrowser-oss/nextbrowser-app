import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTheme, terminalColorKeys, terminalThemeFromPalette } from "./theme";

const palette = readFileSync(new URL("./palette.css", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");
function rendererStyles(directory: URL): string {
  return readdirSync(directory, { withFileTypes: true }).map(entry => entry.isDirectory()
    ? rendererStyles(new URL(`${entry.name}/`, directory))
    : entry.name.endsWith(".css") ? readFileSync(new URL(entry.name, directory), "utf8") : "").join("\n");
}
const styles = rendererStyles(new URL("./", import.meta.url)).replace(/\/\*[\s\S]*?\*\//g, "");

function declaredTokens(css: string): Set<string> {
  return new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
}

function rootBlock(selector: string): string {
  const start = palette.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing ${selector} block`);
  return palette.slice(start, palette.indexOf("}", start));
}

function themeTokens(theme: "dark" | "light"): Record<string, string> {
  const declarations = rootBlock(":root") + (theme === "light" ? rootBlock(':root[data-theme="light"]') : "");
  return Object.fromEntries([...declarations.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]));
}

function resolveToken(tokens: Record<string, string>, key: string, visited: string[] = []): string {
  if (visited.includes(key)) throw new Error(`Circular palette reference: ${key}`);
  const value = tokens[key];
  if (!value) throw new Error(`Missing palette token: ${key}`);
  const alias = /^var\((--[\w-]+)\)$/.exec(value);
  return alias ? resolveToken(tokens, alias[1], [...visited, key]) : value;
}

function luminance(hex: string): number {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error(`Expected opaque color, got ${hex}`);
  const [r, g, b] = [1, 3, 5].map(offset => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function compositeRgba(value: string, backdrop: number): string {
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  if (!rgba) throw new Error(`Expected translucent palette color: ${value}`);
  const alpha = Number(rgba[4]);
  return "#" + rgba.slice(1, 4).map(channel => Math.round(Number(channel) * alpha + backdrop * (1 - alpha)).toString(16).padStart(2, "0")).join("");
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

  it.each(["dark", "light"] as const)("keeps text and action labels readable in %s", theme => {
    const tokens = themeTokens(theme);
    const color = (key: string) => resolveToken(tokens, key);
    for (const background of ["--bg", "--panel", "--card", "--bg-elevated"]) {
      for (const foreground of ["--text", "--text-secondary", "--accent-text"]) {
        expect(contrast(color(foreground), color(background)), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const [foreground, background] of [
      ["--on-primary-action", "--primary-action"],
      ["--on-primary-action", "--primary-action-hover"],
      ["--on-danger", "--danger-action"],
      ["--tooltip-text", "--tooltip-solid-bg"],
      ["--glass-inverse-text", "--glass-inverse-solid"],
      ["--glass-inverse-muted", "--glass-inverse-solid"],
    ]) expect(contrast(color(foreground), color(background))).toBeGreaterThanOrEqual(4.5);
  });

  it("gives dark surfaces distinct luminance instead of near-black duplicates", () => {
    const tokens = themeTokens("dark");
    const colors = ["--bg", "--panel", "--card", "--bg-elevated"].map(key => resolveToken(tokens, key));
    const levels = colors.map(luminance);
    for (let index = 1; index < levels.length; index++) expect(levels[index]).toBeGreaterThan(levels[index - 1]);
    expect(contrast(colors[0], colors[2])).toBeGreaterThanOrEqual(1.4);
  });

  it.each(["dark", "light"] as const)("keeps composer text readable through its %s glass tint", theme => {
    const tokens = themeTokens(theme);
    // Opposite extremes are the least favorable backgrounds for each inverted surface.
    const background = compositeRgba(resolveToken(tokens, "--composer-glass-bg"), theme === "light" ? 255 : 0);
    expect(contrast(resolveToken(tokens, "--glass-inverse-text"), background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["dark", "light"] as const)("resolves every Xterm color from the %s palette", theme => {
    const tokens = themeTokens(theme);
    const terminal = terminalThemeFromPalette(property => resolveToken(tokens, property));
    expect(Object.keys(terminal)).toHaveLength(terminalColorKeys.length);
    for (const value of Object.values(terminal)) expect(value).toMatch(/^#[\da-f]{6}(?:[\da-f]{2})?$/i);
    expect(contrast(terminal.foreground, terminal.background)).toBeGreaterThanOrEqual(4.5);
    expect(terminal.background).toBe(resolveToken(tokens, "--bg"));
  });

  it("keeps raw UI colors in the shared palette", () => {
    const source = new URL("./", import.meta.url);
    const violations: string[] = [];
    const scan = (directory: string) => {
      for (const entry of readdirSync(new URL(directory, source), { withFileTypes: true })) {
        const path = join(directory, entry.name).replace(/\\/g, "/");
        if (entry.isDirectory()) scan(path + "/");
        else if (/\.(css|tsx?)$/.test(path) && !/\.test\./.test(path)
          && path !== "palette.css" && path !== "lib/scriptCommands.ts") {
          // scriptCommands contains a standalone example executed on an external website.
          const content = readFileSync(new URL(path, source), "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
          if (/#[\da-f]{3,8}\b|rgba?\(\s*[\d.]/i.test(content)) violations.push(path);
        }
      }
    };
    scan("");
    expect(violations).toEqual([]);
  });
});
