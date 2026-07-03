export type Selector =
  | { kind: "domain"; value: string }
  | { kind: "captcha"; value: string }
  | { kind: "script"; value: string };

export interface SkillEntry {
  id: string;
  title: string;
  subtitle: string;
  selector: Selector;
  description?: string;
  category: string;
  categoryTitle: string;
  categoryIcon: string;
  categoryOrder: number;
  js?: string;
}

export interface SkillCategory {
  id: string;
  title: string;
  blurb: string;
  icon: string;
  entries: SkillEntry[];
}

export function selectorFlags(s: Selector): string[] {
  if (s.kind === "captcha") return ["--captcha", s.value];
  return ["--domain", s.value];
}

export function selectorTargetHost(s: Selector): string | undefined {
  return s.kind === "domain" ? s.value : undefined;
}

export function selectorIcon(s: Selector): string {
  if (s.kind === "captcha") return "checkmark.shield";
  if (s.kind === "script") return "scroll";
  return "globe";
}

export function withLocalScripts(categories: SkillCategory[]): SkillCategory[] {
  return [...categories, { id: "my-scripts", title: "My scripts", blurb: "Private reusable scripts synced to your account.", icon: "scroll.fill", entries: [] }];
}

export const SCRIPTS: SkillEntry[] = [];
