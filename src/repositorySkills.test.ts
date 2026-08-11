import { describe, expect, it } from "vitest";
import { mergeSkillCategories, repositorySkillCategories } from "./repositorySkills";

describe("repository skills", () => {
  it("loads validated skills into the application catalog", () => {
    const categories = repositorySkillCategories();
    const entries = categories.flatMap((category) => category.entries);
    const skill = entries
      .find((entry) => entry.id === "repository:999-car-search");
    expect(skill?.source).toBe("repository");
    expect(skill?.selector).toEqual({ kind: "domain", value: "999.md" });
    expect(skill?.instructions).toContain("# 999.md car search");
    const makler = entries.find((entry) => entry.id === "repository:makler-car-search");
    expect(makler?.selector).toEqual({ kind: "domain", value: "makler.md" });
    expect(makler?.instructions).toContain("# Makler car search");
  });

  it("merges repository and backend skills in the same category", () => {
    const merged = mergeSkillCategories([{
      id: "marketplaces",
      title: "Marketplaces",
      blurb: "Backend skills",
      icon: "globe",
      entries: [{
        id: "backend",
        title: "Backend skill",
        subtitle: "From API",
        selector: { kind: "domain", value: "example.com" },
        category: "marketplaces",
        categoryTitle: "Marketplaces",
        categoryIcon: "globe",
        categoryOrder: 30,
      }],
    }]);
    const marketplaceIds = merged.find((category) => category.id === "marketplaces")?.entries.map((entry) => entry.id);
    const repositoryIds = repositorySkillCategories()
      .find((category) => category.id === "marketplaces")?.entries.map((entry) => entry.id);
    expect(marketplaceIds).toEqual(["backend", ...repositoryIds ?? []]);
  });
});
