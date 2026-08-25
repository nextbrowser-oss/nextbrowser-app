import { describe, expect, it } from "vitest";
import { compareIds, newerThan, newestId, normalizePosts, selectEligible } from "./posts";
import type { RawPost } from "./scripts";

function raw(patch: Partial<RawPost> & { id: string }): RawPost {
  return {
    url: "", author: "author", text: "some text", created_at: "2026-08-25T09:00:00Z",
    social_context: "", reply_context: "", pinned: false, repost: false, reply: false, promoted: false,
    ...patch,
  };
}

describe("post ids", () => {
  it("orders ids beyond 64-bit range as numbers, not as strings", () => {
    expect(compareIds("1899000000000000000", "999000000000000000")).toBe(1);
    expect(compareIds("100", "99")).toBe(1);
    expect(compareIds("0099", "99")).toBe(0);
    expect(compareIds("1899000000000000001", "1899000000000000002")).toBe(-1);
  });

  it("finds the newest id and returns the new posts oldest first", () => {
    const posts = normalizePosts([raw({ id: "30" }), raw({ id: "10" }), raw({ id: "20" })], "author");
    expect(newestId(posts)).toBe("30");
    expect(newerThan(posts, "10").map((post) => post.id)).toEqual(["20", "30"]);
    expect(newerThan(posts, undefined).map((post) => post.id)).toEqual(["10", "20", "30"]);
  });
});

describe("normalizing what the page reported", () => {
  it("drops entries that cannot ground a reply", () => {
    const posts = normalizePosts([
      raw({ id: "1" }),
      raw({ id: "2", text: "   " }),
      raw({ id: "", text: "no id" }),
      raw({ id: "3", author: "someone_else" }),
    ], "author");
    expect(posts.map((post) => post.id)).toEqual(["1"]);
  });

  it("classifies reposts, replies and pinned entries from their context lines", () => {
    const posts = normalizePosts([
      raw({ id: "1", social_context: "Author reposted" }),
      raw({ id: "2", reply_context: "Replying to @someone" }),
      raw({ id: "3", social_context: "Pinned" }),
    ], "author");
    expect(posts.map((post) => [post.repost, post.reply, post.pinned])).toEqual([
      [true, false, false],
      [false, true, false],
      [false, false, true],
    ]);
  });
});

describe("choosing what to answer", () => {
  it("skips advertisements, reposts, replies and the pinned post by default", () => {
    const posts = normalizePosts([
      raw({ id: "1" }),
      raw({ id: "2", promoted: true }),
      raw({ id: "3", repost: true }),
      raw({ id: "4", reply: true }),
      raw({ id: "5", pinned: true }),
    ], "author");
    expect(selectEligible(posts, { handle: "author" }).map((post) => post.id)).toEqual(["1"]);
  });

  it("keeps what the caller explicitly asked for, but never an advertisement", () => {
    const posts = normalizePosts([raw({ id: "2", promoted: true }), raw({ id: "3", repost: true })], "author");
    const selected = selectEligible(posts, { handle: "author", includeReposts: true });
    expect(selected.map((post) => post.id)).toEqual(["3"]);
  });
});
