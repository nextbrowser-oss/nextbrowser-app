// What a social monitoring dashboard shows between passes — for every engine
// that ranks matches the same way (Instagram, TikTok, Facebook): the matches
// the passes found, most urgent first, and which of them the latest pass
// announced as new.
//
// The engines keep only what they need to tell new from old. The matches
// themselves are the app's to keep, for the panel, and nothing here decides
// what counts as new or how urgent it is. A pass does not replace what is
// shown: a match stays for a day from when it was found, or until the user
// marks it done, so an urgent comment from the morning does not drop off
// because a feed moved on.
//
// This is the Reddit dashboard's logic (lib/redditmonitor/feed.ts) over the
// fields every engine's matches share.

export type Urgency = "high" | "medium" | "low";

/** The part of an engine's item every panel uses. Each engine adds its own
 *  context fields (the post a comment is under, the group a post is in). */
export interface SocialItem {
  key: string;
  kind: string;
  author: string;
  text: string;
  url: string;
  createdAt?: number;
  addressed?: string;
  [field: string]: unknown;
}

export interface SocialMatch {
  item: SocialItem;
  source: { kind: string; name: string };
  keywords: string[];
  triage: { urgency: Urgency; score: number; reasons: string[] };
  /** When a pass first found it: the feed keeps a match for a day from here.
   *  Set by the feed, not by the engines. */
  seenAt?: number;
}

/** The part of an engine's event the feed reads. */
export interface SocialEvent {
  type: string;
  [field: string]: unknown;
}

export interface SocialFeed {
  /** Most urgent first. */
  matches: SocialMatch[];
  /** Matches a pass announced, when, and how urgent: the 24-hour figures. */
  announced: { key: string; at: number; urgency: Urgency }[];
  /** The matches the latest pass announced: only these carry "New". */
  lastNew: string[];
  /** Matches the user marked done. */
  done: string[];
  readAt?: number;
}

const MAX_MATCHES = 80;
const KEEP_FOR_MS = 24 * 60 * 60 * 1000;
const MAX_ANNOUNCED = 500;
const MAX_DONE = 500;
const URGENCIES: Urgency[] = ["high", "medium", "low"];
const ORDER: Record<Urgency, number> = { high: 0, medium: 1, low: 2 };

export function emptySocialFeed(): SocialFeed {
  return { matches: [], announced: [], lastNew: [], done: [] };
}

function isMatch(value: unknown): value is SocialMatch {
  const match = value as SocialMatch | null;
  return !!match && typeof match === "object"
    && !!match.item && typeof match.item.key === "string" && typeof match.item.url === "string"
    && !!match.source && typeof match.source.kind === "string"
    && !!match.triage && URGENCIES.includes(match.triage.urgency) && Array.isArray(match.triage.reasons);
}

/** byUrgency sorts most urgent first, then by score, then newest. */
export function byUrgency(left: SocialMatch, right: SocialMatch): number {
  return ORDER[left.triage.urgency] - ORDER[right.triage.urgency]
    || right.triage.score - left.triage.score
    || (right.item.createdAt ?? 0) - (left.item.createdAt ?? 0);
}

/** normalizeSocialFeed accepts whatever was on disk. */
export function normalizeSocialFeed(raw: unknown): SocialFeed {
  if (!raw || typeof raw !== "object") return emptySocialFeed();
  const record = raw as Partial<SocialFeed>;
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((key): key is string => typeof key === "string") : []);
  return {
    matches: (Array.isArray(record.matches) ? record.matches.filter(isMatch) : []).slice(0, MAX_MATCHES)
      .map(({ seenAt, ...match }) => (Number.isFinite(seenAt) ? { ...match, seenAt } : match)),
    announced: (Array.isArray(record.announced)
      ? record.announced.filter((item) => item && typeof item.key === "string" && Number.isFinite(item.at) && URGENCIES.includes(item.urgency))
      : []).slice(-MAX_ANNOUNCED),
    lastNew: strings(record.lastNew),
    done: strings(record.done).slice(-MAX_DONE),
    ...(Number.isFinite(record.readAt) ? { readAt: record.readAt } : {}),
  };
}

/** withPass folds one pass into the feed. A pass that read nothing — signed
 *  out, stopped by a security check before its first source — leaves it. */
export function withPass(feed: SocialFeed, pass: { matches: SocialMatch[]; events: SocialEvent[]; read: boolean }, at: number): SocialFeed {
  if (!pass.read) return feed;
  const fresh = pass.events.filter((event): event is SocialEvent & SocialMatch => event.type === "new_item" && isMatch(event));
  const byKey = new Map<string, SocialMatch>();
  for (const match of feed.matches) byKey.set(match.item.key, match);
  for (const match of [...pass.matches, ...fresh]) {
    // A match keeps the time it was first found. One kept from before the
    // feed recorded that counts from when it was written, as it did then.
    const known = byKey.get(match.item.key);
    const seenAt = known ? known.seenAt ?? known.item.createdAt ?? at : at;
    byKey.set(match.item.key, { item: match.item, source: match.source, keywords: match.keywords, triage: match.triage, seenAt });
  }
  // A day from when it was found, not from when it was written: the engines
  // find what was written up to their own age limit (two days for Instagram),
  // and a comment from yesterday morning found now still needs a look.
  const matches = [...byKey.values()]
    .filter((match) => at - (match.seenAt ?? match.item.createdAt ?? at) < KEEP_FOR_MS)
    .sort(byUrgency)
    .slice(0, MAX_MATCHES);
  const kept = new Set(matches.map((match) => match.item.key));
  return {
    matches,
    announced: [
      ...feed.announced.filter((item) => at - item.at < KEEP_FOR_MS),
      ...fresh.map((event) => ({ key: event.item.key, at, urgency: event.triage.urgency })),
    ].slice(-MAX_ANNOUNCED),
    lastNew: fresh.map((event) => event.item.key),
    done: feed.done.filter((key) => kept.has(key)),
    readAt: at,
  };
}

export function withDone(feed: SocialFeed, key: string, done = true): SocialFeed {
  const rest = feed.done.filter((item) => item !== key);
  return { ...feed, done: done ? [...rest, key].slice(-MAX_DONE) : rest };
}

export function isNew(feed: SocialFeed, key: string): boolean {
  return feed.lastNew.includes(key);
}

export function openMatches(feed: SocialFeed): SocialMatch[] {
  const done = new Set(feed.done);
  return feed.matches.filter((match) => !done.has(match.item.key));
}

export function announcedToday(feed: SocialFeed, at: number, urgency?: Urgency): number {
  return feed.announced.filter((item) => at - item.at < KEEP_FOR_MS && (!urgency || item.urgency === urgency)).length;
}
