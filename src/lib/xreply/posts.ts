// Post model and selection rules, ported from the Go service's
// internal/xtimeline/post.go. Everything here is pure: given what a page
// reported, decide which posts are worth a reply and where the watermark is.

import type { RawPost } from "./scripts";

export interface XPost {
  id: string;
  url: string;
  author: string;
  text: string;
  createdAt?: number;
  pinned: boolean;
  repost: boolean;
  reply: boolean;
  promoted: boolean;
}

export interface PostFilter {
  handle: string;
  includeReposts?: boolean;
  includeReplies?: boolean;
  includePinned?: boolean;
}

const REPLY_PREFIX = "replying to";
const REPOST_MARKERS = ["repost", "retweet"];
const PINNED_MARKER = "pinned";

/** compareIds orders two numeric X post ids without parsing them as numbers,
 *  which keeps ids beyond 64-bit range comparable. */
export function compareIds(left: string, right: string): number {
  const a = left.trim().replace(/^0+/, "");
  const b = right.trim().replace(/^0+/, "");
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** newestId returns the highest post id, or an empty string for no posts. */
export function newestId(posts: XPost[]): string {
  let newest = "";
  for (const post of posts) if (compareIds(post.id, newest) > 0) newest = post.id;
  return newest;
}

export function sortByIdAscending(posts: XPost[]): XPost[] {
  return [...posts].sort((left, right) => compareIds(left.id, right.id));
}

/** normalizePosts converts what a page reported into posts of the watched
 *  handle. An entry without an id or without text of its own cannot ground a
 *  reply, so it is dropped rather than answered blindly. */
export function normalizePosts(raw: RawPost[], handle: string): XPost[] {
  const wanted = handle.trim().toLowerCase();
  const posts: XPost[] = [];
  for (const item of raw) {
    const id = String(item?.id ?? "").trim();
    const author = String(item?.author ?? "").trim();
    const text = String(item?.text ?? "").trim();
    if (!id || !author || !text) continue;
    if (wanted && author.toLowerCase() !== wanted) continue;
    const social = String(item.social_context ?? "").toLowerCase();
    const created = Date.parse(String(item.created_at ?? ""));
    posts.push({
      id,
      url: item.url || `https://x.com/${author}/status/${id}`,
      author,
      text,
      createdAt: Number.isFinite(created) ? created : undefined,
      pinned: !!item.pinned || social.includes(PINNED_MARKER),
      repost: !!item.repost || REPOST_MARKERS.some((marker) => social.includes(marker)),
      reply: !!item.reply || String(item.reply_context ?? "").toLowerCase().startsWith(REPLY_PREFIX),
      promoted: !!item.promoted,
    });
  }
  return posts;
}

/** selectEligible drops what the account should never answer. A promoted post
 *  is an advertisement, and the pinned post is old by definition. */
export function selectEligible(posts: XPost[], filter: PostFilter): XPost[] {
  return posts.filter((post) => {
    if (post.promoted) return false;
    if (post.repost && !filter.includeReposts) return false;
    if (post.reply && !filter.includeReplies) return false;
    if (post.pinned && !filter.includePinned) return false;
    return true;
  });
}

/** newerThan returns the posts past the watermark, oldest first, so replies go
 *  out in the order the author wrote them. */
export function newerThan(posts: XPost[], watermark: string | undefined): XPost[] {
  const mark = (watermark ?? "").trim();
  const fresh = mark ? posts.filter((post) => compareIds(post.id, mark) > 0) : posts;
  return sortByIdAscending(fresh);
}

/** postIdFromUrl reads the numeric id out of a status URL. */
export function postIdFromUrl(url: string): string {
  return /\/status\/(\d+)/.exec(url)?.[1] ?? "";
}
