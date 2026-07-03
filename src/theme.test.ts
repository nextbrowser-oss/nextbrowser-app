import { describe, expect, it } from "vitest";
import { resolveTheme } from "./theme";

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
