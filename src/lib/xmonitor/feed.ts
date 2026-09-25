// What the X monitoring dashboard shows between passes: the Following feed as
// the last pass read it, and which of its posts were announced as new.
//
// The engine (@nextbrowser-oss/x-monitoring) keeps only what it needs to tell
// new from old — ids and a watermark. The posts themselves are the app's to
// keep, for the panel, and nothing here decides what counts as new.

import type { FeedPost, MonitorEvent } from "@nextbrowser-oss/x-monitoring";

export const X_MONITOR_STATE_FILE = "x-monitor-state.json";
export const X_MONITOR_FEED_FILE = "x-monitor-feed.json";
export const X_MONITOR_LOG_FILE = "x-monitor-log.jsonl";

/** How many posts of the feed the dashboard keeps. */
const MAX_POSTS = 60;
/** How long a post keeps its "new" mark. */
const NEW_FOR_MS = 24 * 60 * 60 * 1000;
const MAX_ANNOUNCED = 300;

export interface XMonitorFeed {
  posts: FeedPost[];
  /** Posts a pass announced as new, and when: what the 24-hour count reads. */
  announced: { key: string; at: number }[];
  /** The posts the latest feed read announced. Only these carry the "new"
   *  mark; the next read that gets through the feed hands it on. */
  lastNew: string[];
  readAt?: number;
}

export function emptyXMonitorFeed(): XMonitorFeed {
  return { posts: [], announced: [], lastNew: [] };
}

/** normalizeXMonitorFeed accepts whatever was on disk. */
export function normalizeXMonitorFeed(raw: unknown): XMonitorFeed {
  if (!raw || typeof raw !== "object") return emptyXMonitorFeed();
  const record = raw as Partial<XMonitorFeed>;
  const posts = Array.isArray(record.posts)
    ? record.posts.filter((post) => post && typeof post.key === "string" && typeof post.url === "string" && typeof post.author === "string")
    : [];
  const announced = Array.isArray(record.announced)
    ? record.announced.filter((item) => item && typeof item.key === "string" && Number.isFinite(item.at))
    : [];
  const lastNew = Array.isArray(record.lastNew) ? record.lastNew.filter((key): key is string => typeof key === "string") : [];
  return {
    posts: posts.slice(0, MAX_POSTS),
    announced: announced.slice(-MAX_ANNOUNCED),
    lastNew,
    ...(Number.isFinite(record.readAt) ? { readAt: record.readAt } : {}),
  };
}

/** withPass folds one pass into the feed. A pass that did not read the feed —
 *  signed out, blocked, stopped — leaves what the last one read on screen. */
export function withPass(
  feed: XMonitorFeed,
  pass: { posts: FeedPost[]; events: MonitorEvent[]; feedRead: boolean },
  at: number,
): XMonitorFeed {
  const fresh = pass.events.flatMap((event) => (event.type === "new_post" ? [{ key: event.post.key, at }] : []));
  // A new post can sit below the fold of what this read kept; it still
  // belongs on the dashboard.
  const freshPosts = pass.events.flatMap((event) => (event.type === "new_post" ? [event.post] : []));
  const posts = pass.feedRead
    ? [...pass.posts, ...freshPosts.filter((post) => !pass.posts.some((known) => known.key === post.key))]
    : feed.posts;
  return {
    posts: sortNewestFirst(posts).slice(0, MAX_POSTS),
    announced: [...feed.announced.filter((item) => at - item.at < NEW_FOR_MS), ...fresh].slice(-MAX_ANNOUNCED),
    lastNew: pass.feedRead ? fresh.map((item) => item.key) : feed.lastNew,
    readAt: pass.feedRead ? at : feed.readAt,
  };
}

/** isNew says whether the latest feed read announced a post. */
export function isNew(feed: XMonitorFeed, key: string): boolean {
  return feed.lastNew.includes(key);
}

/** Reposts carry the original post's time, so a repost is placed by when the
 *  feed showed it: it keeps its position among the posts around it. */
function sortNewestFirst(posts: FeedPost[]): FeedPost[] {
  return posts
    .map((post, index) => ({ post, index }))
    .sort((left, right) => {
      if (left.post.repost || right.post.repost) return left.index - right.index;
      return (right.post.createdAt ?? 0) - (left.post.createdAt ?? 0) || left.index - right.index;
    })
    .map((item) => item.post);
}

/** Follower-count samples for a chart, oldest first, with the change over a
 *  window. The window's start is the last sample before it, since a count
 *  holds until it changes. */
export function followerTrend(
  history: { at: number; followers: number }[],
  current: number | undefined,
  at: number,
  windowMs = 7 * NEW_FOR_MS,
): { points: number[]; delta?: number } {
  if (current === undefined) return { points: [] };
  const points = history.map((sample) => sample.followers);
  if (!points.length || points[points.length - 1] !== current) points.push(current);
  const before = [...history].reverse().find((sample) => sample.at <= at - windowMs) ?? history[0];
  return { points, delta: before ? current - before.followers : undefined };
}
