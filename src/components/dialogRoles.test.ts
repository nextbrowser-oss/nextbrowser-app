import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sources = {
  "App.tsx": readFileSync(new URL("../App.tsx", import.meta.url), "utf8"),
  "Sidebar.tsx": readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8"),
};

/** The opening tag of the element with this class, with its attributes. */
function openingTag(source: string, className: string): string {
  const start = source.indexOf(`className="modal-card ${className}"`);
  if (start < 0) throw new Error(`Missing ${className}`);
  const tagStart = source.lastIndexOf("<", start);
  return source.slice(tagStart, source.indexOf(">", start) + 1);
}

// Screen readers and UI tests find a window by its dialog role and name.
describe("app windows are named modal dialogs", () => {
  it.each([
    ["App.tsx", "settings-modal", "settings-title", "Settings"],
    ["Sidebar.tsx", "workspace-create-modal", "workspace-create-title", "Create workspace"],
    ["Sidebar.tsx", "manual-proxy-modal", "manual-proxy-title", "Personal proxies"],
  ] as const)("%s %s", (file, className, titleId, title) => {
    const source = sources[file];
    const tag = openingTag(source, className);
    expect(tag).toContain('role="dialog"');
    expect(tag).toContain('aria-modal="true"');
    expect(tag).toContain(`aria-labelledby="${titleId}"`);
    const titleTag = source.slice(source.indexOf(`id="${titleId}"`), source.indexOf(`id="${titleId}"`) + 300);
    expect(titleTag).toContain(title);
  });
});
