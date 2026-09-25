import { describe, expect, it } from "vitest";
import type { FeedPost } from "@nextbrowser-oss/x-monitoring";
import { emptyXMonitorFeed, followerTrend, isNew, normalizeXMonitorFeed, withPass } from "./feed";

const post = (key: string, createdAt: number, patch: Partial<FeedPost> = {}): FeedPost => ({
  key, id: key, url: `https://x.com/a/status/${key}`, author: "a", text: key, createdAt,
  repost: false, reply: false, photos: 0, video: false, card: false, ...patch,
});

describe("withPass", () => {
  it("shows the feed as read and marks what was announced", () => {
    const fresh = post("3", 300);
    const feed = withPass(emptyXMonitorFeed(), {
      posts: [post("2", 200), post("1", 100)],
      events: [{ type: "new_post", at: 1000, post: fresh }],
      feedRead: true,
    }, 1000);
    expect(feed.posts.map((item) => item.key)).toEqual(["3", "2", "1"]);
    expect(isNew(feed, "3", 1000)).toBe(true);
    expect(isNew(feed, "2", 1000)).toBe(false);
    expect(feed.readAt).toBe(1000);
  });

  it("keeps the last read when a pass did not read the feed", () => {
    const before = withPass(emptyXMonitorFeed(), { posts: [post("1", 100)], events: [], feedRead: true }, 1000);
    const after = withPass(before, { posts: [], events: [], feedRead: false }, 2000);
    expect(after.posts.map((item) => item.key)).toEqual(["1"]);
    expect(after.readAt).toBe(1000);
  });

  it("forgets the new mark after a day", () => {
    const feed = withPass(emptyXMonitorFeed(), { posts: [], events: [{ type: "new_post", at: 0, post: post("1", 0) }], feedRead: true }, 0);
    expect(isNew(feed, "1", 25 * 60 * 60 * 1000)).toBe(false);
  });

  it("leaves a repost where the feed showed it", () => {
    const feed = withPass(emptyXMonitorFeed(), {
      posts: [post("9", 900), post("1@b", 5, { repost: true, repostedBy: "b" }), post("8", 800)],
      events: [],
      feedRead: true,
    }, 1000);
    expect(feed.posts.map((item) => item.key)).toEqual(["9", "1@b", "8"]);
  });
});

describe("normalizeXMonitorFeed", () => {
  it("accepts nothing and junk", () => {
    expect(normalizeXMonitorFeed(null)).toEqual(emptyXMonitorFeed());
    expect(normalizeXMonitorFeed({ posts: [{ nope: 1 }], announced: [{ key: 1 }] })).toEqual(emptyXMonitorFeed());
  });
});

describe("followerTrend", () => {
  const day = 24 * 60 * 60 * 1000;
  it("charts the history and measures the change over the window", () => {
    const history = [{ at: 0, followers: 100 }, { at: 3 * day, followers: 110 }, { at: 9 * day, followers: 125 }];
    expect(followerTrend(history, 125, 10 * day)).toEqual({ points: [100, 110, 125], delta: 15 });
  });

  it("measures from the first sample when history is shorter than the window", () => {
    expect(followerTrend([{ at: 0, followers: 100 }], 104, day)).toEqual({ points: [100, 104], delta: 4 });
  });

  it("has nothing to chart without a count", () => {
    expect(followerTrend([], undefined, 0)).toEqual({ points: [] });
  });
});

describe("monitoring intervals", () => {
  it("reads the way a person says them", async () => {
    const { formatInterval, clampMonitorInterval } = await import("../../types");
    expect(formatInterval(5)).toBe("5 min");
    expect(formatInterval(90)).toBe("1 h 30 min");
    expect(formatInterval(1440)).toBe("24 h");
    expect(formatInterval(2880)).toBe("48 h");
    expect(formatInterval(4320)).toBe("3 d");
    expect(formatInterval(2000)).toBe("33 h 20 min");
    expect(clampMonitorInterval(1)).toBe(5);
    expect(clampMonitorInterval(99_999)).toBe(10_080);
    expect(clampMonitorInterval(Number.NaN)).toBe(10);
  });
});
