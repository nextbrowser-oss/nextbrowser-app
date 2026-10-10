import { describe, expect, it } from "vitest";
import type { Match, NewItemEvent, Urgency } from "@nextbrowser-oss/reddit-monitoring";
import {
  announcedToday,
  countTrend,
  emptyRedditMonitorFeed,
  isNew,
  normalizeRedditMonitorFeed,
  openMatches,
  replyTask,
  withDone,
  withPass,
} from "./feed";

const HOUR = 60 * 60 * 1000;

const match = (key: string, createdAt: number, urgency: Urgency = "low", patch: Partial<Match["item"]> = {}): Match => ({
  item: { key, id: key, kind: "post", subreddit: "webdev", author: "alice", title: key, text: "", url: `https://www.reddit.com/r/webdev/comments/${key}/`, createdAt, nsfw: false, ...patch },
  source: { kind: "community", name: "r/webdev" },
  keywords: ["nextbrowser"],
  triage: { urgency, score: urgency === "high" ? 4 : urgency === "medium" ? 2 : 0, reasons: [] },
});

const announce = (value: Match, at: number): NewItemEvent => ({ type: "new_item", at, ...value });

describe("withPass", () => {
  it("lists what was found, most urgent first, and marks what was announced", () => {
    const urgent = match("t3_b", 2 * HOUR, "high");
    const feed = withPass(emptyRedditMonitorFeed(), {
      matches: [match("t3_a", HOUR), urgent],
      events: [announce(urgent, 3 * HOUR)],
      read: true,
    }, 3 * HOUR);
    expect(feed.matches.map((item) => item.item.key)).toEqual(["t3_b", "t3_a"]);
    expect(isNew(feed, "t3_b")).toBe(true);
    expect(isNew(feed, "t3_a")).toBe(false);
    expect(announcedToday(feed, 3 * HOUR)).toBe(1);
    expect(announcedToday(feed, 3 * HOUR, "high")).toBe(1);
    expect(feed.readAt).toBe(3 * HOUR);
  });

  it("keeps an earlier match the latest listing no longer shows, for a day", () => {
    const first = withPass(emptyRedditMonitorFeed(), { matches: [match("t3_a", HOUR, "high")], events: [], read: true }, HOUR);
    const second = withPass(first, { matches: [match("t3_b", 5 * HOUR)], events: [], read: true }, 5 * HOUR);
    expect(second.matches.map((item) => item.item.key)).toEqual(["t3_a", "t3_b"]);
    const nextDay = withPass(second, { matches: [], events: [], read: true }, 26 * HOUR);
    expect(nextDay.matches.map((item) => item.item.key)).toEqual(["t3_b"]);
  });

  it("takes the newer triage of a match read again", () => {
    const first = withPass(emptyRedditMonitorFeed(), { matches: [match("t3_a", HOUR, "low")], events: [], read: true }, HOUR);
    const second = withPass(first, { matches: [match("t3_a", HOUR, "medium")], events: [], read: true }, 2 * HOUR);
    expect(second.matches).toHaveLength(1);
    expect(second.matches[0]!.triage.urgency).toBe("medium");
  });

  it("leaves the feed alone after a pass that read nothing", () => {
    const first = withPass(emptyRedditMonitorFeed(), { matches: [match("t3_a", HOUR)], events: [announce(match("t3_a", HOUR), HOUR)], read: true }, HOUR);
    expect(withPass(first, { matches: [], events: [], read: false }, 2 * HOUR)).toBe(first);
  });
});

describe("done", () => {
  it("hides a match the user marked done, and forgets the mark once the match is gone", () => {
    const feed = withDone(withPass(emptyRedditMonitorFeed(), { matches: [match("t3_a", HOUR), match("t3_b", HOUR)], events: [], read: true }, HOUR), "t3_a");
    expect(openMatches(feed).map((item) => item.item.key)).toEqual(["t3_b"]);
    expect(openMatches(withDone(feed, "t3_a", false))).toHaveLength(2);
    const later = withPass(feed, { matches: [], events: [], read: true }, 30 * HOUR);
    expect(later.done).toEqual([]);
  });
});

describe("normalizeRedditMonitorFeed", () => {
  it("accepts whatever was on disk", () => {
    expect(normalizeRedditMonitorFeed(null)).toEqual(emptyRedditMonitorFeed());
    const feed = normalizeRedditMonitorFeed({ matches: [match("t3_a", 1), { item: {} }], announced: [{ key: "t3_a", at: 1, urgency: "urgent" }], done: ["t3_a", 3] });
    expect(feed.matches).toHaveLength(1);
    expect(feed.announced).toEqual([]);
    expect(feed.done).toEqual(["t3_a"]);
  });
});

describe("countTrend", () => {
  it("draws the history and the change over a week", () => {
    const day = 24 * HOUR;
    const trend = countTrend([{ at: 0, value: 100 }, { at: 8 * day, value: 120 }], 130, 10 * day);
    expect(trend).toEqual({ points: [100, 120, 130], delta: 30 });
    expect(countTrend([], undefined, 0)).toEqual({ points: [] });
  });
});

describe("replyTask", () => {
  it("asks for a draft first and a post only after approval, with the skill's own commands", () => {
    const post = replyTask(match("t3_a", HOUR, "high"), "reddit-us");
    expect(post).toContain("https://www.reddit.com/r/webdev/comments/t3_a/");
    expect(post).toContain('browser profile "reddit-us"');
    expect(post).toContain("post nothing until I approve it");
    expect(post).toContain("nbc reddit comment --profile reddit-us");
    expect(post).toContain("nbc reddit open --profile reddit-us https://www.reddit.com/r/webdev/comments/t3_a/");
    expect(post).not.toContain("<profile>");
    const comment = replyTask(match("t1_c", HOUR, "low", { kind: "comment" }));
    expect(comment).toContain("nbc reddit reply --profile <profile> --target t1_c");
    expect(replyTask(match("t1_d", HOUR, "low", { kind: "comment" }), "my profile")).toContain("nbc reddit reply --profile 'my profile' --target t1_d");
  });
});
