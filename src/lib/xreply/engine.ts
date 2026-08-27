// One watch pass: detect new posts of the watched accounts, draft a reply for
// each, and send what may be sent. Ported from the Go service's internal/watch
// (the poll), internal/xnotify (the notifications feed and the Notify bell) and
// internal/xtimeline (profile timelines).
//
// The pass is a state machine over an explicit XReplyState: it takes the state
// in, returns the next state out, and never mutates what it was given. The
// caller persists the result, which is what makes a pass interrupted halfway
// safe to resume — everything already done is in the returned state.

import type { XBrowser } from "./browser";
import {
  FEED_READY_SELECTOR,
  IDENTITY_READY_SELECTOR,
  TIMELINE_READY_SELECTOR,
  bellScript,
  identityScript,
  notificationsScript,
  timelineScript,
  type BellState,
  type IdentitySnapshot,
  type NotificationsSnapshot,
  type RawPost,
  type TimelineSnapshot,
} from "./scripts";
import { compareIds, newerThan, newestId, normalizePosts, selectEligible, type XPost } from "./posts";
import { SkippedPost, draftReply, type AgentRunner } from "./draft";
import { publishReply, type GifOptions } from "./publish";
import { DEFAULT_GIF_BLOCKLIST } from "./reaction";
import {
  DEFAULT_REPLY_MAX_LENGTH,
  MAX_BELL_ATTEMPTS,
  MAX_DRAFT_ATTEMPTS,
  MAX_PASS_NOTES,
  addDraft,
  gifAllowed,
  handleState,
  hasDraftFor,
  hasReplied,
  recordReply,
  sendableDrafts,
  updateDraft,
  withHandleState,
  withinLimits,
  type XReplyDraft,
  type XReplyState,
} from "./state";

const NOTIFICATIONS_URL = "https://x.com/notifications";
/** A notice says the newest post is what matters, so the read that follows it
 *  is deliberately small. Ported from noticeReadLimit. */
const NOTICE_READ_LIMIT = 5;
/** How long an identity read waits for x.com to draw its account chrome. The
 *  wait ends on the signed-out markers too, so only a page that renders nothing
 *  at all pays for the whole window. */
const IDENTITY_WAIT_SECONDS = 12;

export interface PassDeps {
  browser: XBrowser;
  agentId: string;
  runAgent: AgentRunner;
  /** Handles to watch this pass, exactly as the app's list has them. */
  handles: string[];
  state: XReplyState;
  now: () => number;
  newId: () => string;
  onStep?: (step: string) => void;
  /** Checked between steps so Stop ends the pass instead of the app waiting it out. */
  shouldStop?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
}

export interface PassSummary {
  checked: number;
  drafted: number;
  sent: number;
  skipped: number;
  failed: number;
  baselined: number;
  stopped: boolean;
  loginRequired: boolean;
  /** Why the pass did nothing, when the answer is not a missing sign-in. Without
   *  it the panel reports "0 checked" and the reason stays in the notes. */
  blocked?: string;
  notes: string[];
}

export interface PassResult {
  state: XReplyState;
  summary: PassSummary;
}

class StopRequested extends Error {}

/** readPublisher reports who the profile is signed in as. Everything else in a
 *  pass depends on this: a signed-out profile reads an empty timeline that looks
 *  exactly like an account that has not posted.
 *
 *  Being signed in and being named are two answers, not one. x.com renders the
 *  account chrome after load and, on a delegated account or a narrow window,
 *  renders it without the "@handle" line — reading either too early or too
 *  narrowly used to report a working session as signed out, which left the
 *  panel asking for a sign-in that was already done. */
export async function readPublisher(browser: XBrowser): Promise<{ handle?: string; signedIn: boolean }> {
  await browser.waitForSelector(IDENTITY_READY_SELECTOR, IDENTITY_WAIT_SECONDS).catch(() => undefined);
  const state = await browser.evaluate<IdentitySnapshot>(identityScript());
  if (state.login_wall || !state.identity.session) return { signedIn: false };
  return { handle: state.identity.handle || undefined, signedIn: true };
}

/** ensureNotifications turns the Notify bell on for one account. It never
 *  follows the account: following is a public action the user takes, and
 *  without it X renders no bell at all. */
export async function ensureNotifications(
  browser: XBrowser,
  handle: string,
  options: { alreadyOnProfile?: boolean } = {},
): Promise<{ following?: boolean; notifications?: boolean; note?: string; settled: boolean }> {
  if (!options.alreadyOnProfile) {
    await browser.open(`https://x.com/${handle}`);
    await browser.waitForLoad(15).catch(() => undefined);
  }
  const bell = await browser.evaluate<BellState>(bellScript());
  if (bell.login_wall) return { settled: false, note: "Signed out while reading the profile." };
  if (bell.unfollowed && !bell.found) {
    // The bell only exists for an account this profile follows, and following
    // someone is a decision for whoever owns the account.
    return {
      settled: true,
      following: false,
      notifications: false,
      note: `Follow @${handle} first — X shows no notification bell for an account this profile does not follow.`,
    };
  }
  if (!bell.found) {
    // A profile that has not rendered yet is worth another attempt later; one
    // that rendered without a bell is not.
    return bell.header
      ? { settled: true, following: bell.following || undefined, note: "Could not find the notification bell on this profile." }
      : { settled: false, note: "The profile page had not rendered yet." };
  }
  if (bell.enabled) return { settled: true, following: true, notifications: true };
  if (!bell.visible) return { settled: false, note: "The notification bell was not clickable yet." };

  await browser.clickAt(bell.x, bell.y);
  const after = await browser.evaluate<BellState>(bellScript());
  if (after.found && after.enabled) return { settled: true, following: true, notifications: true };
  return { settled: false, notifications: false, note: "Post notifications could not be confirmed." };
}

async function readTimeline(browser: XBrowser, handle: string, limit: number): Promise<TimelineSnapshot> {
  await browser.open(`https://x.com/${handle}`);
  await browser.waitForLoad(15).catch(() => undefined);
  // Posts render after the page load event. Reading before a tweet or the
  // explicit empty state exists sees a blank timeline and mistakes it for an
  // account that never posted — which is how a notified post got lost.
  await browser.waitForSelector(TIMELINE_READY_SELECTOR, 10).catch(() => undefined);
  return browser.evaluate<TimelineSnapshot>(timelineScript(limit));
}

async function readNotifications(
  browser: XBrowser,
  limit: number,
  options: { alreadyThere?: boolean } = {},
): Promise<NotificationsSnapshot> {
  if (!options.alreadyThere) {
    await browser.open(NOTIFICATIONS_URL);
    await browser.waitForLoad(15).catch(() => undefined);
  }
  await browser.waitForSelector(FEED_READY_SELECTOR, 10).catch(() => undefined);
  return browser.evaluate<NotificationsSnapshot>(notificationsScript(limit));
}

/** openNotifications lands the browser on the feed, which is both where the
 *  pass works and where the user expects to find the tab afterwards. */
export async function openNotifications(browser: XBrowser): Promise<void> {
  await browser.open(NOTIFICATIONS_URL);
  await browser.waitForLoad(15).catch(() => undefined);
}

/** newestNotice returns the delivery time of the newest post notice for one
 *  handle, which is the trigger to go read that profile. */
export function newestNotice(snapshot: NotificationsSnapshot, handle: string): number | undefined {
  let newest: number | undefined;
  for (const trigger of snapshot.triggers ?? []) {
    if (trigger.handle.trim().replace(/^@/, "").toLowerCase() !== handle.toLowerCase()) continue;
    const at = Date.parse(trigger.notified_at ?? "");
    if (!Number.isFinite(at)) continue;
    if (newest === undefined || at > newest) newest = at;
  }
  return newest;
}

/** ownPosts reduces the posts a feed rendered in full to those of one handle.
 *  Every other entry belongs to someone else: a mention from a stranger, or an
 *  account this list does not watch. */
function ownPosts(posts: RawPost[], handle: string): RawPost[] {
  return posts.filter((post) => (post.author ?? "").trim().replace(/^@/, "").toLowerCase() === handle.toLowerCase());
}

function mergePosts(first: XPost[], second: XPost[]): XPost[] {
  const seen = new Set<string>();
  const merged: XPost[] = [];
  for (const post of [...first, ...second]) {
    if (seen.has(post.id)) continue;
    seen.add(post.id);
    merged.push(post);
  }
  return merged;
}

/** subscribeHandle prepares one account the moment the user adds it: it turns
 *  the Notify bell on and records where the account stands now, so the first
 *  pass answers what comes next rather than what is already on the page. */
export async function subscribeHandle(deps: {
  browser: XBrowser;
  handle: string;
  state: XReplyState;
  now: () => number;
  onStep?: (step: string) => void;
}): Promise<{ state: XReplyState; signedIn: boolean; note?: string }> {
  const step = deps.onStep ?? (() => undefined);
  step(`Opening @${deps.handle}`);
  const publisher = await readPublisher(deps.browser);
  let state: XReplyState = { ...deps.state, publisher: { ...publisher, checkedAt: deps.now() } };
  if (!publisher.signedIn) {
    return { state, signedIn: false, note: "The browser profile is not signed in to x.com." };
  }

  await deps.browser.open(`https://x.com/${deps.handle}`);
  await deps.browser.waitForLoad(15).catch(() => undefined);

  const previous = handleState(state, deps.handle);
  step(`Turning on post notifications for @${deps.handle}`);
  const bell = await ensureNotifications(deps.browser, deps.handle, { alreadyOnProfile: true });

  step(`Recording where @${deps.handle} stands now`);
  await deps.browser.waitForSelector(TIMELINE_READY_SELECTOR, 10).catch(() => undefined);
  const snapshot = await deps.browser.evaluate<TimelineSnapshot>(timelineScript(state.watchLimit));
  if (snapshot.login_wall) {
    return {
      state: { ...state, publisher: { ...state.publisher, signedIn: false, checkedAt: deps.now() } },
      signedIn: false,
      note: "x.com signed the profile out.",
    };
  }
  const eligible = selectEligible(normalizePosts(snapshot.posts, deps.handle), {
    handle: deps.handle,
    includeReposts: state.includeReposts,
    includeReplies: state.includeReplies,
    includePinned: state.includePinned,
  });
  state = withHandleState(state, deps.handle, {
    following: bell.following,
    notifications: bell.notifications,
    note: bell.note,
    bellAttempts: (previous?.bellAttempts ?? 0) + 1,
    bellDone: bell.settled || undefined,
    lastPostId: previous?.lastPostId ?? newestId(eligible) ?? undefined,
    watchingSince: previous?.watchingSince ?? deps.now(),
    lastCheckedAt: deps.now(),
  });
  // Leave the browser where the watching happens.
  step("Opening the notifications feed");
  await openNotifications(deps.browser).catch(() => undefined);
  return { state, signedIn: true, note: bell.note };
}

/** runPass performs one full cycle over the watched accounts. */
export async function runPass(deps: PassDeps): Promise<PassResult> {
  const step = deps.onStep ?? (() => undefined);
  const sleep = deps.sleep;
  const summary: PassSummary = {
    checked: 0, drafted: 0, sent: 0, skipped: 0, failed: 0, baselined: 0,
    stopped: false, loginRequired: false, notes: [],
  };
  const passStartedAt = deps.now();
  let state = deps.state;
  if (!state.startedAt) state = { ...state, startedAt: deps.now() };
  // Every exit goes through here, including the ones that stop early: a pass
  // that ends without stamping its summary leaves the panel showing the result
  // of the pass before it.
  const finish = (): PassResult => {
    const took = Math.max(1, Math.round((deps.now() - passStartedAt) / 1000));
    return {
      state: {
        ...state,
        lastPassAt: deps.now(),
        lastPassSummary: `${describe(summary)} · ${took}s`,
        lastPassNotes: summary.notes.length ? summary.notes.slice(-MAX_PASS_NOTES) : undefined,
      },
      summary,
    };
  };
  const stopIfAsked = () => {
    if (deps.shouldStop?.()) throw new StopRequested();
  };
  const note = (text: string) => addNote(summary, text);

  try {
    // The feed is both the identity check and the work surface, so the pass
    // goes straight there instead of visiting x.com first.
    step("Opening the notifications feed");
    await openNotifications(deps.browser);
    const publisher = await readPublisher(deps.browser);
    state = { ...state, publisher: { ...publisher, checkedAt: deps.now() } };
    if (!publisher.signedIn) {
      summary.loginRequired = true;
      note("The browser profile is not signed in to x.com.");
      return finish();
    }
    if (!publisher.handle) {
      // Signed in, but the page never named the account. Asking for a sign-in
      // here is the one thing that cannot help, so the pass says what it saw
      // and stops instead.
      summary.blocked = "Signed in, but x.com did not name the account";
      note("Signed in to x.com, but the page did not say which account. Open x.com in this profile and reload it.");
      return finish();
    }
    if (state.publisherHandle && state.publisherHandle.toLowerCase() !== publisher.handle.toLowerCase()) {
      summary.blocked = `Signed in as @${publisher.handle}, replies pinned to @${state.publisherHandle}`;
      note(`Signed in as @${publisher.handle}, but replies are pinned to @${state.publisherHandle}.`);
      return finish();
    }

    stopIfAsked();
    step("Reading the notifications feed");
    const feed = await readNotifications(deps.browser, state.watchLimit, { alreadyThere: true });
    if (feed.login_wall) {
      summary.loginRequired = true;
      note("x.com signed the profile out during the pass.");
      state = { ...state, publisher: { ...state.publisher, signedIn: false, checkedAt: deps.now() } };
      return finish();
    }

    for (const handle of deps.handles) {
      stopIfAsked();
      const previous = handleState(state, handle);
      // Mentions and replies render in full in the feed and are read straight
      // from it; a post notice only says an account posted, so it sends the pass
      // to that profile. While the feed is quiet, no profile is opened at all.
      let posts = normalizePosts(ownPosts(feed.posts, handle), handle);
      const noticeAt = newestNotice(feed, handle);
      // A notice is consumed only by a profile read that actually saw posts.
      // Consuming it on an empty read is how a notified post got lost for good:
      // the page had not rendered yet, and nothing ever came back for it.
      let consumedNoticeAt = previous?.noticeAt;
      if (noticeAt !== undefined && noticeAt > (previous?.noticeAt ?? 0)) {
        step(`Reading @${handle} — X notified about a new post`);
        const snapshot = await readTimeline(deps.browser, handle, NOTICE_READ_LIMIT);
        if (snapshot.login_wall) {
          summary.loginRequired = true;
          note("x.com signed the profile out during the pass.");
          state = { ...state, publisher: { ...state.publisher, signedIn: false, checkedAt: deps.now() } };
          return finish();
        }
        const fromProfile = normalizePosts(snapshot.posts, handle);
        if (fromProfile.length > 0) consumedNoticeAt = noticeAt;
        else note(`@${handle}: the profile page showed no posts yet; the notice stays queued.`);
        posts = mergePosts(posts, fromProfile);
      } else if (!posts.length) {
        state = withHandleState(state, handle, { lastCheckedAt: deps.now() });
        summary.checked += 1;
        continue;
      }
      summary.checked += 1;

      const eligible = selectEligible(posts, {
        handle,
        includeReposts: state.includeReposts,
        includeReplies: state.includeReplies,
        includePinned: state.includePinned,
      });

      if (!posts.length) {
        // Nothing rendered at all. Leave the account untouched so the next pass
        // tries again, instead of recording an empty baseline.
        state = withHandleState(state, handle, { lastCheckedAt: deps.now(), noticeAt: consumedNoticeAt });
        continue;
      }

      const since = previous?.watchingSince ?? deps.now();
      if (!previous?.lastPostId) {
        // First sight of an account: everything older than the moment it was
        // added is history and is never answered — a burst of replies to old
        // posts is what a bot does. What was posted after the add is exactly
        // what the user is waiting on, so it is drafted right away.
        state = withHandleState(state, handle, {
          lastPostId: newestId(posts) || undefined,
          lastCheckedAt: deps.now(),
          watchingSince: since,
          noticeAt: consumedNoticeAt,
        });
        const fresh = eligible.filter((post) => post.createdAt && post.createdAt >= since);
        if (fresh.length) {
          state = await draftPosts(deps, state, handle, fresh, summary, stopIfAsked);
        } else {
          summary.baselined += 1;
          step(`@${handle}: baseline recorded`);
        }
        continue;
      }

      let fresh = newerThan(eligible, previous.lastPostId);
      // The feed carries days of history, so an account watched from today never
      // answers what was already there before it was added.
      fresh = fresh.filter((post) => !post.createdAt || post.createdAt >= since);

      state = withHandleState(state, handle, { lastCheckedAt: deps.now() });
      state = await draftPosts(deps, state, handle, fresh, summary, stopIfAsked);
      // The notice is what sends the pass to this profile, so it is consumed
      // only once the posts it surfaced are settled. A post the agent failed to
      // draft leaves it queued, which is what makes the held watermark reachable
      // again — X notifies about a post once, and it already did.
      if (!handleState(state, handle)?.draftFailPostId) {
        state = withHandleState(state, handle, { noticeAt: consumedNoticeAt });
      }
    }

    // Send whatever is approved, oldest first, under the account's limits.
    for (const draft of sendableDrafts(state)) {
      stopIfAsked();
      const verdict = withinLimits(state, deps.now());
      if (!verdict.allowed) {
        note(verdict.reason ?? "Reply limit reached.");
        break;
      }
      const result = await sendDraft({ browser: deps.browser, now: deps.now, sleep }, state, draft, note);
      state = result.state;
      if (result.sent) summary.sent += 1;
      else if (result.failed) summary.failed += 1;
    }

    // The Notify bell is settled once per account, after the user-visible work:
    // a probe reloads that profile, and Start should reach the feed first.
    for (const handle of deps.handles) {
      stopIfAsked();
      const current = handleState(state, handle);
      if (current?.bellDone || (current?.bellAttempts ?? 0) >= MAX_BELL_ATTEMPTS) continue;
      step(`Turning on post notifications for @${handle}`);
      const bell = await ensureNotifications(deps.browser, handle);
      state = withHandleState(state, handle, {
        following: bell.following,
        notifications: bell.notifications,
        note: bell.note,
        bellAttempts: (current?.bellAttempts ?? 0) + 1,
        bellDone: bell.settled || undefined,
      });
      if (bell.note) note(`@${handle}: ${bell.note}`);
    }
  } catch (error) {
    if (error instanceof StopRequested) {
      summary.stopped = true;
    } else {
      summary.failed += 1;
      note(error instanceof Error ? error.message : String(error));
    }
  }

  return finish();
}

/** addNote records one reason on a summary, once. */
function addNote(summary: PassSummary, text: string): void {
  if (!summary.notes.includes(text)) summary.notes.push(text);
}

/** draftPosts writes one reply per new post and advances the watermark as it
 *  goes, so an interrupted pass resumes where it stopped. */
async function draftPosts(
  deps: PassDeps,
  state: XReplyState,
  handle: string,
  posts: XPost[],
  summary: PassSummary,
  stopIfAsked: () => void,
): Promise<XReplyState> {
  const step = deps.onStep ?? (() => undefined);
  let next = state;
  let watermark = handleState(state, handle)?.lastPostId ?? "";
  for (const post of posts) {
    stopIfAsked();
    if (compareIds(post.id, watermark) > 0) watermark = post.id;
    if (hasReplied(next, post.id) || hasDraftFor(next, post.id)) {
      next = withHandleState(next, handle, { lastPostId: watermark });
      continue;
    }
    step(`Drafting a reply to @${handle}`);
    let failure = "";
    try {
      const draft = await draftReply(deps.agentId, {
        author: post.author,
        text: post.text,
        url: post.url,
        createdAt: post.createdAt,
        maxLength: DEFAULT_REPLY_MAX_LENGTH,
      }, deps.runAgent);
      const record: XReplyDraft = {
        id: deps.newId(),
        handle,
        postId: post.id,
        postUrl: post.url,
        postText: post.text,
        replyText: draft.text,
        reaction: draft.reaction,
        gifQuery: draft.gifQuery || undefined,
        createdAt: deps.now(),
        // Every draft is sendable the moment it exists: there is no review step.
        status: "approved",
      };
      next = addDraft(next, record);
      summary.drafted += 1;
    } catch (error) {
      if (error instanceof SkippedPost) {
        summary.skipped += 1;
      } else if (error instanceof Error && error.name === "StopRequested") {
        throw error;
      } else {
        summary.failed += 1;
        failure = error instanceof Error ? error.message : String(error);
        addNote(summary, `@${handle}: ${failure}`);
      }
    }
    if (failure) {
      // A post the agent could not draft is not a post that was answered. The
      // watermark stays behind it and the rest of the batch waits — posts come
      // oldest first, so holding here keeps the author's order — and the next
      // pass reads it again. Without this, one broken agent call loses a post
      // permanently and the pass reports nothing but "checked".
      const previous = handleState(next, handle);
      const attempts = (previous?.draftFailPostId === post.id ? previous.draftFailAttempts ?? 0 : 0) + 1;
      if (attempts < MAX_DRAFT_ATTEMPTS) {
        return withHandleState(next, handle, { draftFailPostId: post.id, draftFailAttempts: attempts });
      }
      // Out of attempts: give this one post up rather than stall the account.
      addNote(summary, `@${handle}: gave up on ${post.url} after ${attempts} attempts.`);
    }
    // Seen and settled — drafted, skipped, or given up on. The watermark moves
    // so the feed does not re-read it every pass.
    next = withHandleState(next, handle, {
      lastPostId: watermark,
      draftFailPostId: undefined,
      draftFailAttempts: undefined,
    });
  }
  return next;
}

/** sendDraft publishes one approved draft and records what happened. */
export async function sendDraft(
  deps: { browser: XBrowser; now: () => number; sleep?: (ms: number) => Promise<void> },
  state: XReplyState,
  draft: XReplyDraft,
  onNote: (note: string) => void = () => undefined,
): Promise<{ state: XReplyState; sent: boolean; failed: boolean }> {
  const publisherHandle = state.publisherHandle || state.publisher?.handle || "";
  const gif: GifOptions | undefined = draft.gifQuery
    ? {
      query: draft.gifQuery,
      mode: state.gifMode,
      blocklist: [...DEFAULT_GIF_BLOCKLIST, ...state.gifBlocklist],
      // The budget is spent by a GIF that actually reached the composer, not by
      // an attempt, so it is only checked here and recorded after a send.
      allowed: () => gifAllowed(state, deps.now()),
    }
    : undefined;
  const outcome = await publishReply(
    deps.browser,
    { postUrl: draft.postUrl, replyText: draft.replyText, publisherHandle, gif },
    { sleep: deps.sleep, onNote },
  );
  const at = deps.now();
  const attempts = (draft.attempts ?? 0) + 1;
  switch (outcome.status) {
    case "published":
    case "already-published": {
      const replyUrl = "replyUrl" in outcome ? outcome.replyUrl : undefined;
      const attachedGif = "gif" in outcome ? outcome.gif : undefined;
      let next = updateDraft(state, draft.id, {
        status: "sent", sentAt: at, replyUrl, gif: attachedGif, error: undefined, attempts,
      });
      next = recordReply(next, { postId: draft.postId, repliedAt: at, replyUrl, gif: !!attachedGif });
      const previous = handleState(next, draft.handle);
      next = withHandleState(next, draft.handle, {
        repliesSent: (previous?.repliesSent ?? 0) + 1,
        lastReplyUrl: replyUrl ?? previous?.lastReplyUrl,
      });
      return { state: next, sent: true, failed: false };
    }
    case "unverified": {
      // Submitted but unconfirmed. It stays out of the queue forever: resending
      // could double-post, and only a human can tell which happened.
      let next = updateDraft(state, draft.id, { status: "unverified", sentAt: at, error: outcome.reason, attempts });
      next = recordReply(next, { postId: draft.postId, repliedAt: at });
      return { state: next, sent: false, failed: true };
    }
    default: {
      // Nothing was submitted, so a transient page problem may be retried —
      // bounded, and only when the user asked for unattended sending.
      const retryable = state.autoRetry && attempts < state.maxAttempts;
      return {
        state: updateDraft(state, draft.id, {
          status: retryable ? "approved" : "failed",
          error: outcome.reason,
          attempts,
        }),
        sent: false,
        failed: !retryable,
      };
    }
  }
}

function describe(summary: PassSummary): string {
  if (summary.loginRequired) return "Not signed in to x.com";
  if (summary.blocked) return summary.blocked;
  const parts = [`${summary.checked} checked`];
  if (summary.baselined) parts.push(`${summary.baselined} baselined`);
  if (summary.drafted) parts.push(`${summary.drafted} drafted`);
  if (summary.sent) parts.push(`${summary.sent} sent`);
  if (summary.skipped) parts.push(`${summary.skipped} skipped`);
  if (summary.failed) parts.push(`${summary.failed} failed`);
  if (summary.stopped) parts.push("stopped");
  return parts.join(" · ");
}
