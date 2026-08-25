import { describe, expect, it, vi } from "vitest";
import { runPass } from "./engine";
import { emptyXReplyState, hasReplied, withHandleState, type XReplyState } from "./state";
import type { XBrowser } from "./browser";

interface PostFixture { id: string; text?: string; author?: string; promoted?: boolean; createdAt?: string }

interface PageFixture {
  signedIn?: boolean;
  publisher?: string;
  /** Posts the watched profile's own timeline renders. */
  posts?: PostFixture[];
  /** Posts the notifications feed renders in full — mentions and replies. */
  feedPosts?: PostFixture[];
  /** Post notices: the feed saying an account has posted. */
  triggers?: { handle: string; notified_at: string }[];
  bell?: { found?: boolean; enabled?: boolean; following?: boolean; unfollowed?: boolean; header?: boolean };
  publishOutcome?: "published" | "unverified" | "refused";
  gif?: { found?: boolean; settles?: boolean };
}

function rawPost(post: PostFixture) {
  const author = post.author ?? "author";
  return {
    id: post.id,
    url: `https://x.com/${author}/status/${post.id}`,
    author,
    text: post.text ?? `post ${post.id}`,
    created_at: post.createdAt ?? "2026-08-25T09:00:00Z",
    social_context: "", reply_context: "",
    pinned: false, repost: false, reply: false, promoted: !!post.promoted,
  };
}

/** fakeBrowser answers by the marker each script carries, so a test describes
 *  the pages the pass will meet rather than the calls it will make. */
function fakeBrowser(fixture: PageFixture) {
  const signedIn = fixture.signedIn !== false;
  const publisher = fixture.publisher ?? "me";
  const bell = { found: true, enabled: true, following: true, unfollowed: false, header: true, ...(fixture.bell ?? {}) };
  const opened: string[] = [];
  const clicks: string[] = [];
  let inspected = 0;
  let bellReads = 0;
  const browser: XBrowser = {
    open: vi.fn(async (url: string) => { opened.push(url); }),
    waitForLoad: vi.fn(async () => undefined),
    waitForSelector: vi.fn(async () => undefined),
    clickAt: vi.fn(async (x: number) => {
      clicks.push(x === 7 ? "bell" : x === 50 ? "gif-button" : x === 60 ? "gif-result" : "submit");
    }),
    inputByTestIdPrefix: vi.fn(async () => undefined),
    press: vi.fn(async () => { clicks.push("escape"); }),
    evaluate: vi.fn(async (script: string) => {
      if (script.includes('identity: publisherIdentity("")')) {
        return { url: "https://x.com/home", login_wall: !signedIn, identity: { present: signedIn, handle: signedIn ? publisher : "" } } as never;
      }
      if (script.includes("snapshot.triggers")) {
        return {
          url: "https://x.com/notifications", login_wall: !signedIn, empty: false,
          posts: (fixture.feedPosts ?? []).map(rawPost),
          triggers: fixture.triggers ?? [],
        } as never;
      }
      if (script.includes("empty_timeline")) {
        return {
          url: "https://x.com/author", login_wall: !signedIn, empty_timeline: false,
          posts: (fixture.posts ?? []).map(rawPost),
        } as never;
      }
      if (script.includes("turn off post notifications")) {
        bellReads += 1;
        const enabled = bell.enabled || bellReads > 1;
        return { url: "", login_wall: false, header: bell.header, following: bell.following, unfollowed: bell.unfollowed, enabled, found: bell.found, label: "", x: 7, y: 7, visible: true } as never;
      }
      if (script.includes("existing_reply_url")) {
        inspected += 1;
        return {
          url: "https://x.com/author/status/20",
          on_post: true, reply_composer_route: false, login_wall: false,
          composer: { present: true, text: inspected > 1 ? "drafted reply" : "" },
          submit: { present: true, disabled: fixture.publishOutcome === "refused" },
          media: { present: !!fixture.gif && fixture.gif.found !== false && fixture.gif.settles !== false && inspected > 1, uploading: false },
          identity: { present: true, handle: publisher, matches: true },
          reply_control: true, existing_reply_url: "",
        } as never;
      }
      if (script.includes("reply_found")) {
        const confirmed = fixture.publishOutcome !== "unverified";
        return {
          url: "", composer_present: !confirmed, composer_text: confirmed ? "" : "drafted reply",
          submit_disabled: confirmed, reply_found: confirmed, reply_url: "https://x.com/me/status/99",
        } as never;
      }
      if (script.includes("gifSearchSearchInput") && script.includes("inserted")) {
        return { inserted: true, value: "q", reason: "" } as never;
      }
      if (script.includes("gifSearchGifImage") && script.includes("blocked")) {
        return fixture.gif?.found === false
          ? { found: false, x: 0, y: 0, alt: "", considered: 3, skipped: ["a [blocked: nsfw]"], reason: "every result was skipped" } as never
          : { found: true, x: 60, y: 60, alt: "nodding yes", considered: 3, skipped: [], reason: "" } as never;
      }
      if (script.includes("submit_enabled")) {
        return { present: fixture.gif?.settles !== false, uploading: false, submit_enabled: true } as never;
      }
      if (script.includes("gifSearchButton")) return { found: true, x: 50, y: 50, reason: "" } as never;
      return { found: true, x: 30, y: 40, reason: "" } as never;
    }),
  };
  return { browser, clicks, opened };
}

function deps(state: XReplyState, fixture: PageFixture, overrides: Record<string, unknown> = {}) {
  const { browser, clicks, opened } = fakeBrowser(fixture);
  let counter = 0;
  return {
    clicks,
    opened,
    browser,
    args: {
      browser,
      agentId: "claude",
      runAgent: vi.fn().mockResolvedValue({ code: 0, stdout: '{"reply":"drafted reply","reaction":"none"}', stderr: "" }),
      handles: ["author"],
      state,
      now: () => 1_800_000_000_000,
      newId: () => `draft-${(counter += 1)}`,
      sleep: async () => undefined,
      ...overrides,
    },
  };
}

/** Detection is always the notifications feed, so a test that wants a profile
 *  read supplies the notice that sends the pass there. */
const NOTICE = [{ handle: "author", notified_at: "2026-08-25T10:00:00Z" }];

function watching(patch: Partial<XReplyState> = {}): XReplyState {
  return withHandleState({ ...emptyXReplyState(), ...patch }, "author", { bellDone: true, watchingSince: 1 });
}

function seeded(lastPostId: string, patch: Partial<XReplyState> = {}): XReplyState {
  return withHandleState(watching(patch), "author", { lastPostId });
}

describe("one watch pass", () => {
  it("baselines posts that existed before the account was added", async () => {
    // Watching started at 12:00; everything visible is from 09:00 — history.
    const late = withHandleState(watching(), "author", { watchingSince: Date.parse("2026-08-25T12:00:00Z") });
    const { args } = deps(late, { triggers: NOTICE, posts: [{ id: "10" }, { id: "20" }] });
    const { state, summary } = await runPass(args);
    expect(summary.baselined).toBe(1);
    expect(summary.drafted).toBe(0);
    expect(state.handles.author.lastPostId).toBe("20");
  });

  it("answers the first post that arrives after the account was added", async () => {
    // Watching started at 08:00; the 09:00 post is what the user is waiting on.
    const early = withHandleState(watching(), "author", { watchingSince: Date.parse("2026-08-25T08:00:00Z") });
    const { args } = deps(early, { triggers: NOTICE, posts: [{ id: "20" }] });
    const { state, summary } = await runPass(args);
    expect(summary.drafted).toBe(1);
    expect(state.drafts[0].postId).toBe("20");
    expect(state.handles.author.lastPostId).toBe("20");
  });

  it("keeps a notice queued when the profile page rendered no posts yet", async () => {
    const base = seeded("10");
    const empty = deps(base, { triggers: NOTICE, posts: [] });
    const first = await runPass(empty.args);
    // The read saw nothing, so the notice is not consumed and nothing is lost.
    expect(first.state.handles.author.noticeAt).toBeUndefined();
    expect(first.summary.drafted).toBe(0);

    const retry = deps(first.state, { triggers: NOTICE, posts: [{ id: "20" }] });
    const second = await runPass(retry.args);
    expect(second.summary.drafted).toBe(1);
    expect(second.state.handles.author.noticeAt).toBe(Date.parse("2026-08-25T10:00:00Z"));
  });

  it("drafts only posts newer than the watermark and leaves them for approval", async () => {
    const { args } = deps(seeded("10"), { triggers: NOTICE, posts: [{ id: "10" }, { id: "20" }] });
    const { state, summary } = await runPass(args);
    expect(summary.drafted).toBe(1);
    expect(state.drafts[0]).toMatchObject({ postId: "20", status: "pending", replyText: "drafted reply" });
    expect(state.handles.author.lastPostId).toBe("20");
  });

  it("sends immediately in auto-send mode and remembers the answered post", async () => {
    const { args } = deps(seeded("10", { autoSend: true }), { triggers: NOTICE, posts: [{ id: "20" }] });
    const { state, summary } = await runPass(args);
    expect(summary.sent).toBe(1);
    expect(state.drafts[0]).toMatchObject({ status: "sent", replyUrl: "https://x.com/me/status/99" });
    expect(hasReplied(state, "20")).toBe(true);
    expect(state.handles.author.repliesSent).toBe(1);
  });

  it("never resends a post that is already answered", async () => {
    const answered = { ...seeded("10", { autoSend: true }), replies: [{ postId: "20", repliedAt: 1 }] };
    const { args } = deps(answered, { triggers: NOTICE, posts: [{ id: "20" }] });
    const { state, summary } = await runPass(args);
    expect(summary.drafted).toBe(0);
    expect(state.drafts).toEqual([]);
  });

  it("holds an unconfirmed submit out of the queue instead of retrying it", async () => {
    const { args } = deps(seeded("10", { autoSend: true, autoRetry: true }), { triggers: NOTICE, posts: [{ id: "20" }], publishOutcome: "unverified" });
    const { state } = await runPass(args);
    expect(state.drafts[0].status).toBe("unverified");
    expect(hasReplied(state, "20")).toBe(true);
  });

  it("re-queues a refused attempt only while auto-retry has budget", async () => {
    const { args } = deps(seeded("10", { autoSend: true, autoRetry: true, maxAttempts: 2 }), { triggers: NOTICE, posts: [{ id: "20" }], publishOutcome: "refused" });
    const first = await runPass(args);
    expect(first.state.drafts[0]).toMatchObject({ status: "approved", attempts: 1 });

    const { args: retryArgs } = deps(first.state, { triggers: NOTICE, posts: [{ id: "20" }], publishOutcome: "refused" });
    const second = await runPass(retryArgs);
    expect(second.state.drafts[0]).toMatchObject({ status: "failed", attempts: 2 });
  });

  it("stops sending at the hourly limit", async () => {
    const at = 1_800_000_000_000;
    const spent = { ...seeded("10", { autoSend: true, hourlyMax: 1 }), replies: [{ postId: "old", repliedAt: at - 60_000 }] };
    const { args } = deps(spent, { triggers: NOTICE, posts: [{ id: "20" }] });
    const { state, summary } = await runPass(args);
    expect(summary.sent).toBe(0);
    expect(summary.notes.join(" ")).toContain("Hourly limit");
    expect(state.drafts[0].status).toBe("approved");
  });

  it("stops at a signed-out profile without reading any account", async () => {
    const { args } = deps(watching(), { signedIn: false });
    const { state, summary } = await runPass(args);
    expect(summary.loginRequired).toBe(true);
    expect(summary.checked).toBe(0);
    expect(state.publisher?.signedIn).toBe(false);
  });

  it("refuses to run as an account other than the pinned publisher", async () => {
    const { args } = deps(watching({ publisherHandle: "someone_else" }), { triggers: NOTICE, posts: [{ id: "20" }] });
    const { summary } = await runPass(args);
    expect(summary.checked).toBe(0);
    expect(summary.notes.join(" ")).toContain("pinned to @someone_else");
  });

  it("ends the pass when the loop is stopped mid-run", async () => {
    const { args } = deps(seeded("10"), { triggers: NOTICE, posts: [{ id: "20" }] }, { shouldStop: () => true });
    const { summary } = await runPass(args);
    expect(summary.stopped).toBe(true);
    expect(summary.drafted).toBe(0);
  });
});

describe("watching through the notifications feed", () => {
  it("reads a profile only when the feed says that account posted", async () => {
    const base = seeded("10");
    const quiet = deps(base, { triggers: [] });
    const first = await runPass(quiet.args);
    expect(quiet.opened.filter((url) => url.endsWith("/author"))).toHaveLength(0);
    expect(first.summary.drafted).toBe(0);

    const noticed = deps(base, { triggers: NOTICE, posts: [{ id: "20" }] });
    const second = await runPass(noticed.args);
    expect(noticed.opened).toContain("https://x.com/author");
    expect(second.summary.drafted).toBe(1);
    expect(second.state.handles.author.noticeAt).toBe(Date.parse("2026-08-25T10:00:00Z"));
  });

  it("answers a mention rendered in the feed without opening a profile", async () => {
    const { args, opened } = deps(seeded("10"), { feedPosts: [{ id: "25", text: "hey @me look at this" }] });
    const { summary, state } = await runPass(args);
    expect(summary.drafted).toBe(1);
    expect(state.drafts[0].postId).toBe("25");
    expect(opened.filter((url) => url.endsWith("/author"))).toHaveLength(0);
  });

  it("ignores feed history from before the account was added", async () => {
    const late = withHandleState(seeded("10"), "author", { watchingSince: Date.parse("2026-08-25T12:00:00Z") });
    const { args } = deps(late, { feedPosts: [{ id: "25", createdAt: "2026-08-25T09:00:00Z" }] });
    const { summary } = await runPass(args);
    expect(summary.drafted).toBe(0);
  });

  it("turns the bell on once and does not probe a settled account again", async () => {
    const { args, clicks } = deps(emptyXReplyState(), { bell: { enabled: false }, triggers: [] });
    const { state } = await runPass(args);
    expect(clicks).toContain("bell");
    expect(state.handles.author).toMatchObject({ notifications: true, bellDone: true });

    const second = deps(state, { bell: { enabled: false }, triggers: [] });
    await runPass(second.args);
    expect(second.clicks).not.toContain("bell");
  });

  it("reports an account this profile does not follow instead of following it", async () => {
    const { args, clicks } = deps(emptyXReplyState(), { bell: { found: false, following: false, unfollowed: true }, triggers: [] });
    const { state, summary } = await runPass(args);
    expect(clicks).not.toContain("bell");
    expect(state.handles.author.following).toBe(false);
    expect(summary.notes.join(" ")).toContain("Follow @author first");
  });

});

describe("reaction GIFs", () => {
  const gifDraft = '{"reply":"drafted reply","reaction":"agree"}';

  it("attaches the curated GIF the mood resolved to", async () => {
    const { args, clicks } = deps(seeded("10", { autoSend: true }), { triggers: NOTICE, posts: [{ id: "20" }], gif: { found: true } }, {
      runAgent: vi.fn().mockResolvedValue({ code: 0, stdout: gifDraft, stderr: "" }),
    });
    const { state, summary } = await runPass(args);
    expect(summary.sent).toBe(1);
    expect(clicks).toContain("gif-button");
    expect(clicks).toContain("gif-result");
    expect(state.drafts[0]).toMatchObject({ reaction: "agree", gif: "nodding yes" });
    expect(state.replies[0].gif).toBe(true);
  });

  it("sends text only when every result was blocked", async () => {
    const { args } = deps(seeded("10", { autoSend: true }), { triggers: NOTICE, posts: [{ id: "20" }], gif: { found: false } }, {
      runAgent: vi.fn().mockResolvedValue({ code: 0, stdout: gifDraft, stderr: "" }),
    });
    const { state, summary } = await runPass(args);
    expect(summary.sent).toBe(1);
    expect(state.drafts[0].gif).toBeUndefined();
    expect(state.replies[0].gif).toBe(false);
  });

  it("refuses to send at all when a GIF is required and the picker fails", async () => {
    const { args } = deps(seeded("10", { autoSend: true, gifMode: "required" }), { triggers: NOTICE, posts: [{ id: "20" }], gif: { found: false } }, {
      runAgent: vi.fn().mockResolvedValue({ code: 0, stdout: gifDraft, stderr: "" }),
    });
    const { state, summary } = await runPass(args);
    expect(summary.sent).toBe(0);
    expect(state.drafts[0].status).toBe("failed");
  });

  it("ignores the reaction entirely when GIFs are switched off", async () => {
    const { args, clicks } = deps(seeded("10", { autoSend: true, gifMode: "off" }), { triggers: NOTICE, posts: [{ id: "20" }] }, {
      runAgent: vi.fn().mockResolvedValue({ code: 0, stdout: gifDraft, stderr: "" }),
    });
    const { summary } = await runPass(args);
    expect(summary.sent).toBe(1);
    expect(clicks).not.toContain("gif-button");
  });

  it("keeps GIFs inside their own hourly budget", async () => {
    const at = 1_800_000_000_000;
    const spent = { ...seeded("10", { autoSend: true, gifHourlyMax: 1 }), replies: [{ postId: "old", repliedAt: at - 60_000, gif: true }] };
    const { args, clicks } = deps(spent, { triggers: NOTICE, posts: [{ id: "20" }] }, {
      runAgent: vi.fn().mockResolvedValue({ code: 0, stdout: gifDraft, stderr: "" }),
    });
    const { summary } = await runPass(args);
    expect(summary.sent).toBe(1);
    expect(clicks).not.toContain("gif-button");
  });
});
