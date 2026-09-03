// Engine state and settings: what was already answered, where each watched
// account stands, and what is waiting for the user's approval. The settings are
// the Go service's flags (cmd/x-reply-agent/main.go), and the bookkeeping is
// what that service keeps in Redis (internal/watch/store.go, internal/review) —
// here it is one JSON document the app owns, because the app, not the model, is
// what must never lose track of a reply that already went out.

import type { GifMode } from "./publish";

/** Where new posts are detected, as with the Go service's --watch-source. */
export type WatchSource = "profile" | "notifications";

export interface XReplyHandleState {
  handle: string;
  following?: boolean;
  notifications?: boolean;
  /** Newest post id already handled for this account. */
  lastPostId?: string;
  lastCheckedAt?: number;
  repliesSent?: number;
  lastReplyUrl?: string;
  note?: string;
  /** Delivery time of the newest post notice already acted on. */
  noticeAt?: number;
  /** How many times the Notify bell was probed, and whether it is settled. */
  bellAttempts?: number;
  bellDone?: boolean;
  /** When this account started being watched, the floor for a feed that carries
   *  days of history. */
  watchingSince?: number;
  /** The post the drafting agent last failed on, and how many passes have tried
   *  it. The watermark waits behind that post so a transient failure does not
   *  drop it for good, and gives up after MAX_DRAFT_ATTEMPTS so one unanswerable
   *  post cannot stall the account forever. */
  draftFailPostId?: string;
  draftFailAttempts?: number;
}

/** "pending" and "rejected" are no longer written: replies go out on their own
 *  and there is no review step to hold or refuse one. Both stay in the union
 *  because a file written before that change can still carry them. */
export type XReplyDraftStatus = "pending" | "approved" | "sent" | "failed" | "unverified" | "rejected";

export interface XReplyDraft {
  id: string;
  handle: string;
  postId: string;
  postUrl: string;
  postText: string;
  replyText: string;
  createdAt: number;
  status: XReplyDraftStatus;
  /** The mood the model asked for and the curated phrase it resolved to. */
  reaction?: string;
  gifQuery?: string;
  gif?: string;
  replyUrl?: string;
  error?: string;
  sentAt?: number;
  attempts?: number;
}

export interface XReplyRecord {
  postId: string;
  repliedAt: number;
  replyUrl?: string;
  /** Whether this reply carried a GIF, counted against its own budget. */
  gif?: boolean;
}

export interface XReplyPublisher {
  handle?: string;
  signedIn?: boolean;
  checkedAt?: number;
}

export interface XReplyState {
  version: 1;
  publisher?: XReplyPublisher;
  handles: Record<string, XReplyHandleState>;
  drafts: XReplyDraft[];
  replies: XReplyRecord[];

  // Settings, one per flag of the Go service.
  includeReposts: boolean;
  includeReplies: boolean;
  includePinned: boolean;
  /** How many entries one read of the feed inspects. */
  watchLimit: number;
  /** Where new posts are detected: each watched profile's own timeline, or the
   *  signed-in account's notifications feed. */
  watchSource: WatchSource;
  hourlyMax: number;
  dailyMax: number;
  gifMode: GifMode;
  /** Words that disqualify a GIF result, on top of the built-in list. */
  gifBlocklist: string[];
  /** The account replies must go out from. Empty means whatever is signed in. */
  publisherHandle?: string;
  /** Which NextBrowser profile the engine drives, with its own cookies and
   *  proxy. Empty means the app's currently selected profile. */
  profileName?: string;
  /** Re-queue a failure that never clicked reply. */
  autoRetry: boolean;
  maxAttempts: number;
  /** Token bucket for the stacking hourly budget: how much was left, and when
   *  it was last measured. Absent on states from before the bucket existed. */
  rateTokens?: number;
  rateAccruedAt?: number;

  startedAt?: number;
  lastPassAt?: number;
  lastPassSummary?: string;
  /** Why the last pass did what it did, in the engine's own words. The counted
   *  summary says "1 failed"; this says which post and what went wrong, which is
   *  the only place a broken agent call was ever explained. */
  lastPassNotes?: string[];
}

/** Defaults ported from the Go service's flags. An account that answers more
 *  often than this reads as a bot. */
export const DEFAULT_HOURLY_MAX = 5;
export const DEFAULT_DAILY_MAX = 20;
export const DEFAULT_WATCH_LIMIT = 20;
/** Profile timelines are the default: the notifications feed renders new
 *  entries only behind a "See new posts" control, which a page nobody is
 *  looking at never presses, so an unattended feed can stay blank for good. */
export const DEFAULT_WATCH_SOURCE: WatchSource = "profile";
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_REPLY_MAX_LENGTH = 280;
/** Bounds how often one handle's bell is probed, ported from maxBellAttempts. */
export const MAX_BELL_ATTEMPTS = 6;
/** How many passes may fail to draft one post before it is given up on. Kept
 *  apart from maxAttempts, which is the user's budget for retrying a send. */
export const MAX_DRAFT_ATTEMPTS = 3;
/** How many reasons from one pass are kept for the panel. */
export const MAX_PASS_NOTES = 3;
const MAX_DRAFTS_KEPT = 200;
const MAX_REPLIES_KEPT = 500;
const REPLY_HISTORY_MS = 30 * 24 * 60 * 60 * 1000;

export function emptyXReplyState(): XReplyState {
  return {
    version: 1,
    handles: {},
    drafts: [],
    replies: [],
    includeReposts: false,
    includeReplies: false,
    includePinned: false,
    watchLimit: DEFAULT_WATCH_LIMIT,
    watchSource: DEFAULT_WATCH_SOURCE,
    hourlyMax: DEFAULT_HOURLY_MAX,
    dailyMax: DEFAULT_DAILY_MAX,
    gifMode: "optional",
    gifBlocklist: [],
    autoRetry: false,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
  };
}

function positive(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

/** normalizeXReplyState accepts whatever was on disk, including a file written
 *  by an older version, and returns something the engine can run against. */
export function normalizeXReplyState(raw: unknown): XReplyState {
  const base = emptyXReplyState();
  if (!raw || typeof raw !== "object") return base;
  const record = raw as Partial<XReplyState>;
  const handles: Record<string, XReplyHandleState> = {};
  for (const [key, value] of Object.entries(record.handles ?? {})) {
    if (!value || typeof value !== "object") continue;
    const handle = String(value.handle ?? key).trim();
    if (!handle) continue;
    handles[handle.toLowerCase()] = { ...value, handle };
  }
  const drafts = Array.isArray(record.drafts)
    ? record.drafts
      .filter((draft) => draft && typeof draft.id === "string" && typeof draft.replyText === "string")
      // Written by a build that still asked for approval. Nothing asks now, so
      // a draft that was waiting for it goes out instead of sitting forever.
      .map((draft) => (draft.status === "pending" ? { ...draft, status: "approved" as const } : draft))
    : [];
  const replies = Array.isArray(record.replies)
    ? record.replies.filter((reply) => reply && typeof reply.postId === "string")
    : [];
  // autoSend was a setting once. Carrying the key forward leaves a file saying
  // "autoSend": false on an account that auto-sends — a setting that reads live
  // and is not.
  const carried: Partial<XReplyState> = { ...record };
  delete (carried as { autoSend?: boolean }).autoSend;
  return {
    ...base,
    ...carried,
    version: 1,
    handles,
    drafts: drafts.slice(-MAX_DRAFTS_KEPT),
    replies: replies.slice(-MAX_REPLIES_KEPT),
    includeReposts: record.includeReposts === true,
    includeReplies: record.includeReplies === true,
    includePinned: record.includePinned === true,
    watchLimit: positive(record.watchLimit, DEFAULT_WATCH_LIMIT),
    watchSource: record.watchSource === "notifications" ? "notifications" : DEFAULT_WATCH_SOURCE,
    hourlyMax: positive(record.hourlyMax, DEFAULT_HOURLY_MAX),
    dailyMax: positive(record.dailyMax, DEFAULT_DAILY_MAX),
    gifMode: record.gifMode === "required" || record.gifMode === "off" ? record.gifMode : "optional",
    gifBlocklist: Array.isArray(record.gifBlocklist)
      ? record.gifBlocklist.filter((word): word is string => typeof word === "string" && !!word.trim())
      : [],
    publisherHandle: typeof record.publisherHandle === "string" && record.publisherHandle.trim()
      ? record.publisherHandle.trim().replace(/^@+/, "")
      : undefined,
    profileName: typeof record.profileName === "string" && record.profileName.trim() ? record.profileName.trim() : undefined,
    autoRetry: record.autoRetry === true,
    maxAttempts: positive(record.maxAttempts, DEFAULT_MAX_ATTEMPTS),
    rateTokens: typeof record.rateTokens === "number" && Number.isFinite(record.rateTokens)
      ? Math.max(0, record.rateTokens)
      : undefined,
    rateAccruedAt: typeof record.rateAccruedAt === "number" && Number.isFinite(record.rateAccruedAt)
      ? record.rateAccruedAt
      : undefined,
    lastPassNotes: Array.isArray(record.lastPassNotes)
      ? record.lastPassNotes.filter((text): text is string => typeof text === "string" && !!text.trim()).slice(-MAX_PASS_NOTES)
      : undefined,
  };
}

export function handleState(state: XReplyState, handle: string): XReplyHandleState | undefined {
  return state.handles[handle.toLowerCase()];
}

export function withHandleState(
  state: XReplyState,
  handle: string,
  patch: Partial<XReplyHandleState>,
): XReplyState {
  const key = handle.toLowerCase();
  const current = state.handles[key] ?? { handle };
  return { ...state, handles: { ...state.handles, [key]: { ...current, ...patch, handle: current.handle || handle } } };
}

/** hasReplied reports whether this post was already answered, which is the
 *  record that keeps a restarted pass from replying twice. */
export function hasReplied(state: XReplyState, postId: string): boolean {
  return state.replies.some((reply) => reply.postId === postId)
    || state.drafts.some((draft) => draft.postId === postId && (draft.status === "sent" || draft.status === "unverified"));
}

export function hasDraftFor(state: XReplyState, postId: string): boolean {
  return state.drafts.some((draft) => draft.postId === postId && draft.status !== "rejected");
}

export interface LimitVerdict {
  allowed: boolean;
  reason?: string;
}

function countWithin(state: XReplyState, at: number, windowMs: number): number {
  return state.replies.filter((reply) => at - reply.repliedAt < windowMs).length;
}

/** accruedTokens is the stacking hourly budget: it refills at hourlyMax per
 *  hour, unused budget carries over, and the pile never exceeds the daily cap.
 *  A state from before the bucket existed starts from what the last hour's
 *  sends left, so migrating does not grant a burst. */
export function accruedTokens(state: XReplyState, at: number): number {
  if (state.rateTokens == null || state.rateAccruedAt == null) {
    return Math.max(0, state.hourlyMax - countWithin(state, at, 60 * 60 * 1000));
  }
  const elapsedHours = Math.max(0, at - state.rateAccruedAt) / (60 * 60 * 1000);
  return Math.min(state.dailyMax, Math.max(0, state.rateTokens) + state.hourlyMax * elapsedHours);
}

/** replyBudget reports what may still go out right now, for the panel. */
export function replyBudget(state: XReplyState, at: number): number {
  const dailyLeft = Math.max(0, state.dailyMax - countWithin(state, at, 24 * 60 * 60 * 1000));
  return Math.min(Math.floor(accruedTokens(state, at)), dailyLeft);
}

/** withinLimits counts what actually went out, not what was attempted, so a
 *  refused attempt never costs the hour's budget. The hourly side is a stacking
 *  bucket; the daily side is a hard rolling cap. */
export function withinLimits(state: XReplyState, at: number): LimitVerdict {
  if (countWithin(state, at, 24 * 60 * 60 * 1000) >= state.dailyMax) {
    return { allowed: false, reason: `Daily limit reached (${state.dailyMax}).` };
  }
  if (accruedTokens(state, at) < 1) {
    return { allowed: false, reason: `Hourly budget spent — it refills at ${state.hourlyMax}/h and stacks up to ${state.dailyMax}.` };
  }
  return { allowed: true };
}

/** gifAllowed reports whether a reply may carry a GIF. Every reply does now, so
 *  the only thing left to honour is the kill switch a state file can still set:
 *  the reply-per-hour budget already bounds how many GIFs an account posts. */
export function gifAllowed(state: XReplyState): boolean {
  return state.gifMode !== "off";
}

export function recordReply(state: XReplyState, record: XReplyRecord): XReplyState {
  const replies = [...state.replies.filter((reply) => record.repliedAt - reply.repliedAt < REPLY_HISTORY_MS), record];
  // One reply spends one token of the stacking budget.
  const rateTokens = Math.max(0, accruedTokens(state, record.repliedAt) - 1);
  return { ...state, replies: replies.slice(-MAX_REPLIES_KEPT), rateTokens, rateAccruedAt: record.repliedAt };
}

export function addDraft(state: XReplyState, draft: XReplyDraft): XReplyState {
  return { ...state, drafts: [...state.drafts, draft].slice(-MAX_DRAFTS_KEPT) };
}

export function updateDraft(state: XReplyState, id: string, patch: Partial<XReplyDraft>): XReplyState {
  return { ...state, drafts: state.drafts.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)) };
}

export function sendableDrafts(state: XReplyState): XReplyDraft[] {
  return state.drafts.filter((draft) => draft.status === "approved");
}
