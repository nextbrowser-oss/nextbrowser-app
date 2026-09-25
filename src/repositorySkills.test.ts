import { describe, expect, it } from "vitest";
import { mergeSkillCategories, repositorySkillCategories } from "./repositorySkills";

describe("repository skills", () => {
  it("loads validated skills into the application catalog", () => {
    const categories = repositorySkillCategories();
    const skill = categories.flatMap((category) => category.entries)
      .find((entry) => entry.id === "repository:bitwarden-autofill-login");
    expect(skill?.source).toBe("repository");
    expect(skill?.selector).toEqual({ kind: "current_tab", value: "current tab" });
    expect(skill?.instructions).toContain("# Bitwarden Autofill Login");
    expect(skill?.permissions).toEqual(["read_page", "use_page_controls", "login"]);
    expect(skill?.verification).toBe("community");
  });

  it("carries a declared watchlist into the catalog entry", () => {
    const skill = repositorySkillCategories().flatMap((category) => category.entries)
      .find((entry) => entry.id === "repository:x-reply-agent");
    expect(skill?.selector).toEqual({ kind: "domain", value: "x.com" });
    expect(skill?.watchlist?.stateFile).toBe("x-reply-agent-state.json");
    expect(skill?.watchlist?.subscribeTask).toContain("{handle}");
    expect(skill?.watchlist?.checkTask).toContain("{handles}");
  });

  it("carries a two-device subreddit watchlist into the catalog entry", () => {
    const skill = repositorySkillCategories().flatMap((category) => category.entries)
      .find((entry) => entry.id === "repository:reddit");
    expect(skill?.selector).toEqual({ kind: "domain", value: "reddit.com" });
    expect(skill?.watchlist?.prefix).toBe("r/");
    expect(skill?.watchlist?.handleMaxLength).toBe(21);
    expect(skill?.watchlist?.engine).toBeUndefined();
    // The device is the transport's, not the entry's: the card and the pass
    // follow whichever one the user picked in the panel.
    expect(skill?.runtime).toBeUndefined();
    const transports = skill?.watchlist?.transports ?? [];
    expect(transports.map((transport) => transport.id)).toEqual(["browser", "cloud-phone"]);
    expect(transports.find((transport) => transport.id === "browser")?.runtime).toBeUndefined();
    expect(transports.find((transport) => transport.id === "cloud-phone")?.runtime).toBe("cloud-phone");
    for (const transport of transports) {
      expect(transport.subscribeTask).toContain("{handle}");
      expect(transport.checkTask).toContain("{handles}");
    }
    // Browser skills declare no runtime, so the app keeps preparing a profile for them.
    const bitwarden = repositorySkillCategories().flatMap((category) => category.entries)
      .find((entry) => entry.id === "repository:bitwarden-autofill-login");
    expect(bitwarden?.runtime).toBeUndefined();
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
