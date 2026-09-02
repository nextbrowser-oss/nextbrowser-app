import { describe, expect, it } from "vitest";
import { mergeSkillCategories, repositorySkillCategories } from "./repositorySkills";

describe("repository skills", () => {
  it("loads validated skills into the application catalog", () => {
    const categories = repositorySkillCategories();
    const skill = categories.flatMap((category) => category.entries)
      .find((entry) => entry.id === "repository:999-car-search");
    expect(skill?.source).toBe("repository");
    expect(skill?.selector).toEqual({ kind: "domain", value: "999.md" });
    expect(skill?.instructions).toContain("# 999.md car search");
  });

  it("carries a declared watchlist into the catalog entry", () => {
    const skill = repositorySkillCategories().flatMap((category) => category.entries)
      .find((entry) => entry.id === "repository:x-reply-agent");
    expect(skill?.selector).toEqual({ kind: "domain", value: "x.com" });
    expect(skill?.watchlist?.stateFile).toBe("x-reply-agent-state.json");
    expect(skill?.watchlist?.subscribeTask).toContain("{handle}");
    expect(skill?.watchlist?.checkTask).toContain("{handles}");
  });

  it("carries a cloud-phone runtime and its subreddit watchlist into the catalog entry", () => {
    const skill = repositorySkillCategories().flatMap((category) => category.entries)
      .find((entry) => entry.id === "repository:reddit-cloud-phone");
    expect(skill?.runtime).toBe("cloud-phone");
    expect(skill?.selector).toEqual({ kind: "domain", value: "reddit.com" });
    expect(skill?.watchlist?.prefix).toBe("r/");
    expect(skill?.watchlist?.handleMaxLength).toBe(21);
    expect(skill?.watchlist?.engine).toBeUndefined();
    expect(skill?.instructions).toContain("reddit-cloud-phone-state.json");
    // Browser skills declare no runtime, so the app keeps preparing a profile for them.
    const car = repositorySkillCategories().flatMap((category) => category.entries)
      .find((entry) => entry.id === "repository:999-car-search");
    expect(car?.runtime).toBeUndefined();
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
