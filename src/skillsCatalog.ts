export type Selector =
  | { kind: "domain"; value: string }
  | { kind: "captcha"; value: string }
  | { kind: "script"; value: string };

/// A skill that follows accounts over time declares a watchlist, and the app
/// renders the manager for it. The wording of the runs stays with the skill so
/// the app never has to know what the site calls a follow or a notification.
export interface SkillWatchlist {
  /// Panel heading, for example "Watched X profiles".
  title: string;
  blurb?: string;
  /// Placeholder for the add field, for example "handle without @".
  placeholder: string;
  /// Rendered before a handle, for example "@".
  prefix?: string;
  /// Profile URL template containing `{handle}`.
  profileUrl?: string;
  /// File in the agent workspace where the skill records what it observed.
  /// Only the chat-driven fallback uses it; an engine keeps its own state.
  stateFile?: string;
  /// Task template for subscribing to one account; contains `{handle}`.
  subscribeTask: string;
  /// Task template for one pass over the list; contains `{handles}`.
  checkTask: string;
  /// Built-in engine that performs the run in app code instead of handing the
  /// whole workflow to the agent. The agent is then called only where a model
  /// is genuinely needed — writing the reply.
  engine?: "x-reply";
}

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
  source?: "backend" | "repository";
  instructions?: string;
  author?: string;
  watchlist?: SkillWatchlist;
}

/// fillTemplate substitutes `{name}` placeholders. A placeholder without a
/// value is dropped rather than left in the prompt as literal braces.
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-z_]+)\}/gi, (_, name: string) => values[name] ?? "");
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
  return [...categories, { id: "my-scripts", title: "My scripts", blurb: "Private reusable scripts backed up to your account.", icon: "scroll.fill", entries: [] }];
}

export const SCRIPTS: SkillEntry[] = [];
