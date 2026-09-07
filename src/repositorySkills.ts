import type {
  SkillCategory,
  SkillEntry,
  SkillPermission,
  SkillRuntime,
  SkillVerification,
  SkillWatchlist,
} from "./skillsCatalog";

interface RepositorySkillManifest {
  id: string;
  name: string;
  description: string;
  author: string;
  domains: string[];
  operations: string[];
  category: { id: string; title: string; icon: string; order: number };
  runtime?: SkillRuntime;
  watchlist?: SkillWatchlist;
  target_mode?: "fixed_domain" | "current_tab";
  permissions?: SkillPermission[];
  min_nextctl_version?: string;
  verification?: SkillVerification;
}

const manifests = import.meta.glob<RepositorySkillManifest>("../skills/*/manifest.json", {
  eager: true,
  import: "default",
});
const instructions = import.meta.glob<string>("../skills/*/SKILL.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

function directory(path: string): string {
  return path.split("/").at(-2) ?? "";
}

export function repositorySkillCategories(): SkillCategory[] {
  const grouped = new Map<string, SkillCategory>();
  for (const [manifestPath, manifest] of Object.entries(manifests)) {
    const slug = directory(manifestPath);
    const skillInstructions = Object.entries(instructions)
      .find(([skillPath]) => directory(skillPath) === slug)?.[1];
    if (!skillInstructions) continue;
    const category = grouped.get(manifest.category.id) ?? {
      id: manifest.category.id,
      title: manifest.category.title,
      icon: manifest.category.icon,
      blurb: "Community-maintained skills shipped with NextBrowser.",
      entries: [],
    };
    const entry: SkillEntry = {
      id: `repository:${manifest.id}`,
      title: manifest.name,
      subtitle: manifest.description,
      description: manifest.description,
      category: manifest.category.id,
      categoryTitle: manifest.category.title,
      categoryIcon: manifest.category.icon,
      categoryOrder: manifest.category.order,
      selector: manifest.target_mode === "current_tab"
        ? { kind: "current_tab", value: "current tab" }
        : { kind: "domain", value: manifest.domains[0] },
      runtime: manifest.runtime === "cloud-phone" ? "cloud-phone" : undefined,
      permissions: manifest.permissions ?? [],
      minNextctlVersion: manifest.min_nextctl_version,
      verification: manifest.verification,
      source: "repository",
      instructions: skillInstructions,
      author: manifest.author,
      watchlist: manifest.watchlist,
    };
    category.entries.push(entry);
    grouped.set(manifest.category.id, category);
  }
  return [...grouped.values()].sort((a, b) =>
    (a.entries[0]?.categoryOrder ?? 0) - (b.entries[0]?.categoryOrder ?? 0));
}

export const REPOSITORY_SKILL_CATEGORIES = repositorySkillCategories();

export function mergeSkillCategories(remote: SkillCategory[], repository = REPOSITORY_SKILL_CATEGORIES): SkillCategory[] {
  const merged = new Map(remote.map((category) => [category.id, { ...category, entries: [...category.entries] }]));
  for (const category of repository) {
    const existing = merged.get(category.id);
    if (existing) existing.entries.push(...category.entries);
    else merged.set(category.id, { ...category, entries: [...category.entries] });
  }
  return [...merged.values()];
}
