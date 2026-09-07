import { describe, expect, it } from "vitest";
import { selectorFlags, selectorTargetHost, withLocalScripts, type SkillCategory, type SkillEntry } from "./skillsCatalog";

describe("backend-driven skill catalog", () => {
  it("groups only entries returned by the backend", () => {
    const entries: SkillEntry[] = [
      { id: "cian", title: "CIAN", subtitle: "cian.ru", selector: { kind: "domain", value: "cian.ru" }, category: "parsing", categoryTitle: "Parsing", categoryIcon: "file-search", categoryOrder: 10 },
      { id: "hcaptcha", title: "hCaptcha", subtitle: "hcaptcha", selector: { kind: "captcha", value: "hcaptcha" }, category: "captcha", categoryTitle: "Captcha", categoryIcon: "shield", categoryOrder: 20 },
    ];
    const backend: SkillCategory[] = [
      { id: "parsing", title: "Parsing", icon: "file-search", blurb: "Backend", entries: [entries[0]] },
      { id: "captcha", title: "Captcha", icon: "shield", blurb: "Backend", entries: [entries[1]] },
    ];
    const categories = withLocalScripts(backend);
    expect(categories.find((category) => category.id === "parsing")?.entries).toEqual([entries[0]]);
    expect(categories.find((category) => category.id === "captcha")?.entries).toEqual([entries[1]]);
    expect(categories.find((category) => category.id === "my-scripts")?.title).toBe("My scripts");
    expect(categories.flatMap((category) => category.entries)).not.toContainEqual(
      expect.objectContaining({ subtitle: "amazon.com" }),
    );
  });

  it("does not turn a current-tab skill into a fixed domain launch", () => {
    const selector = { kind: "current_tab", value: "current tab" } as const;
    expect(selectorTargetHost(selector)).toBeUndefined();
    expect(selectorFlags(selector)).toEqual([]);
  });
});
