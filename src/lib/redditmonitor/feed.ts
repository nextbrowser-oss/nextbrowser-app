// What the Reddit monitoring dashboard shows between passes: the matches the
// passes found, most urgent first, and which of them the latest pass
// announced as new.
//
// The engine (@nextbrowser-oss/reddit-monitoring) keeps only what it needs to
// tell new from old — fullnames and each source's starting line. The matches
// themselves are the app's to keep, for the panel, and nothing here decides
// what counts as new or how urgent it is.
//
// Unlike the X feed, a pass does not replace what is shown. A busy community's
// newest 25 posts can cover two hours, and an urgent mention from the morning
// must not drop off the panel because the listing moved on. Matches stay for a
// day, or until the user marks them done.

import { byUrgency, type Match, type MonitorEvent, type Urgency } from "@nextbrowser-oss/reddit-monitoring";
import { cliProfile } from "../cliProfile";

export const REDDIT_MONITOR_STATE_FILE = "reddit-monitor-state.json";
export const REDDIT_MONITOR_FEED_FILE = "reddit-monitor-feed.json";
export const REDDIT_MONITOR_LOG_FILE = "reddit-monitor-log.jsonl";

/** How many matches the dashboard keeps. */
const MAX_MATCHES = 80;
/** How long a match stays on the dashboard, and how long an announced one
 *  counts toward the 24-hour figures. */
const KEEP_FOR_MS = 24 * 60 * 60 * 1000;
const MAX_ANNOUNCED = 500;
const MAX_DONE = 500;
const URGENCIES: Urgency[] = ["high", "medium", "low"];

export interface RedditMonitorFeed {
  /** Most urgent first. */
  matches: Match[];
  /** Matches a pass announced as new, when, and how urgent: what the 24-hour
   *  figures read. */
  announced: { key: string; at: number; urgency: Urgency }[];
  /** The matches the latest pass announced. Only these carry the "new" mark. */
  lastNew: string[];
  /** Matches the user marked done: handled, answered, or not worth it. */
  done: string[];
  readAt?: number;
}

export function emptyRedditMonitorFeed(): RedditMonitorFeed {
  return { matches: [], announced: [], lastNew: [], done: [] };
}

function isMatch(value: unknown): value is Match {
  const match = value as Match | null;
  return !!match && typeof match === "object"
    && !!match.item && typeof match.item.key === "string" && typeof match.item.url === "string"
    && !!match.source && typeof match.source.kind === "string"
    && !!match.triage && URGENCIES.includes(match.triage.urgency) && Array.isArray(match.triage.reasons);
}

/** normalizeRedditMonitorFeed accepts whatever was on disk. */
export function normalizeRedditMonitorFeed(raw: unknown): RedditMonitorFeed {
  if (!raw || typeof raw !== "object") return emptyRedditMonitorFeed();
  const record = raw as Partial<RedditMonitorFeed>;
  const matches = Array.isArray(record.matches) ? record.matches.filter(isMatch) : [];
  const announced = Array.isArray(record.announced)
    ? record.announced.filter((item) => item && typeof item.key === "string" && Number.isFinite(item.at) && URGENCIES.includes(item.urgency))
    : [];
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((key): key is string => typeof key === "string") : []);
  return {
    matches: matches.slice(0, MAX_MATCHES),
    announced: announced.slice(-MAX_ANNOUNCED),
    lastNew: strings(record.lastNew),
    done: strings(record.done).slice(-MAX_DONE),
    ...(Number.isFinite(record.readAt) ? { readAt: record.readAt } : {}),
  };
}

/** withPass folds one pass into the feed. A pass that read nothing — refused,
 *  stopped before its first listing — leaves the feed as it was. */
export function withPass(
  feed: RedditMonitorFeed,
  pass: { matches: Match[]; events: MonitorEvent[]; read: boolean },
  at: number,
): RedditMonitorFeed {
  if (!pass.read) return feed;
  const fresh = pass.events.flatMap((event) => (event.type === "new_item" ? [event] : []));
  // What this pass read wins over what an earlier one kept: its triage is the
  // newer one, since a post's comment count and score move.
  const byKey = new Map<string, Match>();
  for (const match of feed.matches) byKey.set(match.item.key, match);
  for (const match of [...pass.matches, ...fresh]) byKey.set(match.item.key, { item: match.item, source: match.source, keywords: match.keywords, triage: match.triage });
  const matches = [...byKey.values()]
    .filter((match) => at - (match.item.createdAt ?? at) < KEEP_FOR_MS)
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
    // A done mark outlives nothing it could still apply to.
    done: feed.done.filter((key) => kept.has(key)),
    readAt: at,
  };
}

/** withDone marks a match done, or not done again. */
export function withDone(feed: RedditMonitorFeed, key: string, done = true): RedditMonitorFeed {
  const rest = feed.done.filter((item) => item !== key);
  return { ...feed, done: done ? [...rest, key].slice(-MAX_DONE) : rest };
}

/** isNew says whether the latest pass announced a match. */
export function isNew(feed: RedditMonitorFeed, key: string): boolean {
  return feed.lastNew.includes(key);
}

/** openMatches are the matches still to look at, most urgent first. */
export function openMatches(feed: RedditMonitorFeed): Match[] {
  const done = new Set(feed.done);
  return feed.matches.filter((match) => !done.has(match.item.key));
}

/** announcedSince counts what passes announced over the last day, in all or
 *  at one level. */
export function announcedToday(feed: RedditMonitorFeed, at: number, urgency?: Urgency): number {
  return feed.announced.filter((item) => at - item.at < KEEP_FOR_MS && (!urgency || item.urgency === urgency)).length;
}

/** Count samples for a chart, oldest first, with the change over a window. The
 *  window's start is the last sample before it, since a count holds until it
 *  changes. */
export function countTrend(
  history: { at: number; value: number }[],
  current: number | undefined,
  at: number,
  windowMs = 7 * KEEP_FOR_MS,
): { points: number[]; delta?: number } {
  if (current === undefined) return { points: [] };
  const points = history.map((sample) => sample.value);
  if (!points.length || points[points.length - 1] !== current) points.push(current);
  const before = [...history].reverse().find((sample) => sample.at <= at - windowMs) ?? history[0];
  return { points, delta: before ? current - before.value : undefined };
}

/** replyTask is what the Reddit reply agent is asked to do with one match: a
 *  draft the user sees first, and a post only after the user approves it. The
 *  commands are the skill's own (skills/reddit/SKILL.md). */
export function replyTask(match: Match, profileName?: string): string {
  const { item } = match;
  const profile = profileName ? `the browser profile "${profileName}"` : "the skill's browser profile";
  const cli = cliProfile(profileName);
  const what = item.kind === "post" ? "post" : item.kind === "comment" ? "comment" : "message";
  const where = item.subreddit ? ` in r/${item.subreddit}` : "";
  const why = match.triage.reasons.length ? ` It was ranked ${match.triage.urgency} because: ${match.triage.reasons.join("; ")}.` : "";
  const post = item.kind === "post"
    ? `post it on that page with \`nbc reddit comment --profile ${cli} "<text>"\``
    : item.kind === "comment"
      ? `post it with \`nbc reddit reply --profile ${cli} --target ${item.key} "<text>"\` from that page`
      : "send it from reddit.com's message page";
  return [
    `Draft a reply to this Reddit ${what}${where} that monitoring found, by u/${item.author}: ${item.url} (fullname ${item.key}).${why}`,
    `Work in ClawBrowser on ${profile}. Open it with \`nbc reddit open --profile ${cli} ${item.url}\` and read it and its thread with \`nbc reddit read --profile ${cli}\`.`,
    "Write one reply that answers this specific item in the account's own voice - never a canned line, and no claim about the product that the thread does not support. Show me the draft and post nothing until I approve it.",
    `Once I approve it, ${post}, and report \`verified\` exactly as the flow returns it.`,
  ].join("\n\n");
}
