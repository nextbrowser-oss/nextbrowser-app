import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const chatView = readFileSync(new URL("./ChatView.tsx", import.meta.url), "utf8");

function zIndexFor(selector: string): number {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  const value = rule.match(/z-index:\s*(\d+)/)?.[1];
  if (!value) throw new Error(`Missing z-index for ${selector}`);
  return Number(value);
}

describe("project workspace layout", () => {
  it("keeps shared menu actions above the transparent dismiss layer", () => {
    expect(zIndexFor(".schedule-action-menu")).toBeGreaterThan(zIndexFor(".menu-dismiss-layer"));
  });

  it("uses only the primary sidebar for projects", () => {
    expect(chatView).not.toContain('className="conv-sidebar');
    expect(chatView).not.toContain("conv-context-menu");
    expect(chatView).toContain("nextbrowser:create-project");
  });
});
