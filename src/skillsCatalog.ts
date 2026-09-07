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
  /// Longest handle the list accepts; X handles stop at 15, subreddits at 21.
  handleMaxLength?: number;
  /// Profile URL template containing `{handle}`.
  profileUrl?: string;
  /// File in the agent workspace where the skill records what it observed.
  /// Only the chat-driven fallback uses it; an engine keeps its own state.
  stateFile?: string;
  /// Task template for subscribing to one account; contains `{handle}`.
  /// A watchlist that declares transports carries these per transport instead.
  subscribeTask?: string;
  /// Task template for one pass over the list; contains `{handles}`.
  checkTask?: string;
  /// The devices this watchlist can run on. A site reachable both in a browser
  /// and in its Android app declares one per device, and the panel offers the
  /// choice instead of shipping the same list twice as two skills.
  transports?: SkillWatchlistTransport[];
  /// Built-in engine that performs the run in app code instead of handing the
  /// whole workflow to the agent. The agent is then called only where a model
  /// is genuinely needed — writing the reply.
  engine?: "x-reply";
}

/// One device a watchlist can run on. The tasks live here because reaching an
/// account through a browser and through its Android app are different jobs,
/// not the same job with a flag.
export interface SkillWatchlistTransport {
  /// Stable id persisted with the user's choice, for example "browser".
  id: string;
  /// Toggle label, for example "Browser".
  label: string;
  /// Where a pass on this transport runs. Absent means an ordinary browser
  /// profile; "cloud-phone" prepares no browser and uses the Multilogin phone.
  runtime?: SkillRuntime;
  /// Replaces the watchlist blurb while this transport is selected.
  blurb?: string;
  subscribeTask: string;
  checkTask: string;
}

/// watchlistTransports always returns at least one transport, so a caller never
/// has to branch on whether a watchlist declared them. A watchlist without them
/// is one implicit transport built from its own tasks.
export function watchlistTransports(
  watchlist: SkillWatchlist,
  fallbackRuntime?: SkillRuntime,
): SkillWatchlistTransport[] {
  if (watchlist.transports?.length) return watchlist.transports;
  // The implicit transport keeps the skill's own runtime. Without that a
  // cloud-phone skill that never declared transports would be run in a browser.
  return [{
    id: "default",
    label: "Default",
    runtime: fallbackRuntime,
    subscribeTask: watchlist.subscribeTask ?? "",
    checkTask: watchlist.checkTask ?? "",
  }];
}

/// resolveWatchlistTransport picks the selected transport, falling back to the
/// first one. A stored id that no longer exists — the skill was updated, or the
/// choice was made against an older build — resolves to the first rather than
/// leaving the panel with no tasks to run.
export function resolveWatchlistTransport(
  watchlist: SkillWatchlist,
  selected?: string,
  fallbackRuntime?: SkillRuntime,
): SkillWatchlistTransport {
  const transports = watchlistTransports(watchlist, fallbackRuntime);
  return transports.find((transport) => transport.id === selected) ?? transports[0];
}

/// Where a skill runs. A cloud-phone skill drives the site's Android app on a
/// Multilogin phone, so the app prepares no browser profile for it.
export type SkillRuntime = "browser" | "cloud-phone";

export interface SkillEntry {
  id: string;
  title: string;
  subtitle: string;
  selector: Selector;
  runtime?: SkillRuntime;
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
