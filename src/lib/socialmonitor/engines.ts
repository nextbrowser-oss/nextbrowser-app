// The social monitoring engines the app runs the same way: Instagram, TikTok
// and Facebook. Each is an open-source package with the same contract —
// runPass(state) → { state, events, summary, matches }, checkAccount, a
// normalized settings document — so the app keeps one store slot, one panel
// and one schedule kind per engine, and this file says what differs: the
// files, the settings the panel edits, how a match is described, and what the
// reply agent is asked to do with one.
//
// The X and Reddit monitors came first and keep their own code paths.

import * as facebook from "@nextbrowser-oss/facebook-monitoring";
import * as instagram from "@nextbrowser-oss/instagram-monitoring";
import * as linkedin from "@nextbrowser-oss/linkedin-monitoring";
import * as tiktok from "@nextbrowser-oss/tiktok-monitoring";
import type { SocialEvent, SocialMatch } from "./feed";
import { cliProfile } from "../cliProfile";

export type SocialEngineId = "instagram-monitor" | "tiktok-monitor" | "facebook-monitor" | "linkedin-monitor";

export interface SocialAccount {
  handle?: string;
  signedIn: boolean;
  checkedAt: number;
}

/** The state fields the app reads; each engine's document has more, and
 *  keeps its account in its own shape (spec.account reads it). */
export interface SocialState {
  version: number;
  settings: object;
  lastPass?: { at: number; finishedAt?: number; notes: string[] };
}

export interface SocialAccountCheck {
  signedIn: boolean;
  handle?: string;
  securityCheck?: boolean;
  blocked?: string;
}

export interface SocialSummary {
  signedIn: boolean;
  handle?: string;
  sourcesRead: number;
  newItems: number;
  urgent: number;
  loginRequired?: boolean;
  securityCheck?: boolean;
  rateLimited?: boolean;
  blocked?: string;
}

export interface SocialBrowser {
  open(url: string): Promise<void>;
  evaluate<T>(script: string, label?: string): Promise<T>;
  waitForLoad(timeoutSeconds?: number): Promise<void>;
}

export interface SocialLogEntry {
  t: string;
  ev: string;
  [field: string]: unknown;
}

export interface TermListSpec {
  /** The settings field the list edits. */
  key: string;
  label: string;
  placeholder: string;
  prefix?: string;
  /** Reads what a person typed: one entry or several, comma-separated. */
  parse: (text: string) => string[];
  /** For a setting that is not a list of strings: how its value shows as
   *  chips, and how chips go back into the setting. */
  read?: (value: unknown) => string[];
  write?: (values: string[]) => unknown;
}

export interface ToggleSpec {
  key: string;
  label: string;
  title?: string;
}

export interface SocialEngineSpec {
  engine: SocialEngineId;
  /** "Instagram" */
  name: string;
  /** "instagram.com" */
  site: string;
  /** Written before the account's handle. */
  handlePrefix: string;
  files: { state: string; feed: string; log: string };
  normalizeState(raw: unknown): SocialState;
  withSettings(state: SocialState, patch: Record<string, unknown>): SocialState;
  /** Settings the app applies to every pass it runs on a schedule, for
   *  throttles the schedule already stands in for. */
  passSettings?: Record<string, unknown>;
  runPass(deps: {
    browser: SocialBrowser;
    state: SocialState;
    log?: (entry: SocialLogEntry) => void;
    onStep?: (step: string) => void;
    shouldStop?: () => boolean;
  }): Promise<{ state: SocialState; events: SocialEvent[]; summary: SocialSummary; matches: SocialMatch[] }>;
  checkAccount(deps: { browser: SocialBrowser; log?: (entry: SocialLogEntry) => void }): Promise<SocialAccountCheck>;
  /** The account the state last saw, as the panel shows it. */
  account(state: SocialState): SocialAccount | undefined;
  /** The state with the account a check just read. */
  withAccount(state: SocialState, check: SocialAccountCheck, at: number): SocialState;
  /** The line under "What to watch". */
  intro: string;
  lists: TermListSpec[];
  toggles: ToggleSpec[];
  /** Whether the settings give a pass anything to read. */
  canStart(settings: Record<string, unknown>): boolean;
  startHint: string;
  /** What a signed-out account means for this engine. */
  signedOutNote: string;
  /** The account's own follower count and its history, when the engine
   *  tracks one. */
  followers(state: SocialState): { value?: number; history: { at: number; value: number }[] } | undefined;
  /** A short label for where a match was found. */
  where(match: SocialMatch): string;
  /** One line of context: the post or the group a match belongs to. */
  context(match: SocialMatch): string | undefined;
  /** A link to a match's author, when there is one. */
  authorUrl(match: SocialMatch): string | undefined;
  /** What the reply agent is asked to do with one match. */
  replyTask(match: SocialMatch, profileName?: string): string;
}

const MONITOR_ENGINES: SocialEngineId[] = ["instagram-monitor", "tiktok-monitor", "facebook-monitor", "linkedin-monitor"];

export function isSocialEngine(engine: unknown): engine is SocialEngineId {
  return MONITOR_ENGINES.includes(engine as SocialEngineId);
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function quote(text: string | undefined, max = 80): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The approval rule every reply task ends with, word for word, so no engine
 *  can hand the agent a task that posts without asking. */
/** The profile as it goes on an nbc command line, quoted when it has to be:
 *  profile names may hold spaces or Cyrillic. Without a name the agent is
 *  left a placeholder to fill in. */
export { cliProfile };

const APPROVAL = "Write one reply that answers this specific item in the account's own voice - never a canned line, and no claim the thread does not support. Show me the draft and post nothing until I approve it.";

interface InstagramPost {
  owner?: string;
  caption?: string;
}

const instagramSpec: SocialEngineSpec = {
  engine: "instagram-monitor",
  name: "Instagram",
  site: "instagram.com",
  handlePrefix: "@",
  files: { state: "instagram-monitor-state.json", feed: "instagram-monitor-feed.json", log: "instagram-monitor-log.jsonl" },
  normalizeState: (raw) => instagram.normalizeState(raw) as SocialState,
  withSettings: (state, patch) => instagram.withSettings(state as instagram.MonitorState, patch as Partial<instagram.MonitorSettings>) as SocialState,
  runPass: async (deps) => {
    const result = await instagram.runPass({ ...deps, state: deps.state as instagram.MonitorState });
    return {
      state: result.state as SocialState,
      events: result.events as unknown as SocialEvent[],
      summary: result.summary,
      matches: result.matches as unknown as SocialMatch[],
    };
  },
  checkAccount: (deps) => instagram.checkAccount(deps),
  account: (state) => (state as instagram.MonitorState).account,
  withAccount: (state, check, at) => {
    const previous = (state as instagram.MonitorState).account;
    const handle = check.handle ?? previous?.handle;
    return { ...state, account: { ...previous, ...(handle ? { handle } : {}), signedIn: check.signedIn, checkedAt: at } } as SocialState;
  },
  intro: "Mentions, tags and comments on your posts always count. Keywords are found as whole words, hashtags included, in watched profiles' comments.",
  lists: [
    {
      key: "profiles",
      label: "Profiles to watch",
      placeholder: "competitor or partner, without @",
      prefix: "@",
      parse: (text) => text.split(/[\s,]+/).map(instagram.normalizeHandle).filter(Boolean),
    },
    { key: "keywords", label: "Keywords", placeholder: "brand, product or phrase", parse: instagram.splitKeywords },
    { key: "excludeKeywords", label: "Skip", placeholder: "words that rule a match out", parse: instagram.splitKeywords },
  ],
  toggles: [
    { key: "watchActivity", label: "Mentions and replies" },
    { key: "watchOwnComments", label: "Comments on your posts" },
    { key: "watchTags", label: "Posts you are tagged in" },
    { key: "watchProfileComments", label: "Keyword comments on watched profiles", title: "Read only when keywords are set" },
  ],
  canStart: (settings) => settings.watchActivity === true || settings.watchOwnComments === true || settings.watchTags === true || list(settings.profiles).length > 0,
  startHint: "Turn on a source or add a profile to watch first",
  signedOutNote: "Instagram shows nothing signed out — open it and sign in",
  followers: (state) => {
    const handle = (state as instagram.MonitorState).account?.handle?.toLowerCase();
    const stats = handle ? (state as instagram.MonitorState).followers[handle] : undefined;
    return stats ? { value: stats.followers, history: stats.history } : undefined;
  },
  where: (match) => {
    switch (match.source.kind) {
      case "activity": return "Activity";
      case "own_comments": return "Your post";
      case "tags": return "Tagged";
      case "profile_comments": return `${match.source.name}'s post`;
      default: return match.source.name;
    }
  },
  context: (match) => {
    const post = match.item.post as InstagramPost | undefined;
    if (!post || match.item.kind === "post") return undefined;
    const owner = post.owner ? `@${post.owner}'s post` : "a post";
    return post.caption ? `on ${owner}: “${quote(post.caption)}”` : `on ${owner}`;
  },
  authorUrl: (match) => (match.item.author ? `https://www.instagram.com/${match.item.author}/` : undefined),
  replyTask: (match, profileName) => {
    const { item } = match;
    const profile = profileName ? `the browser profile "${profileName}"` : "the skill's browser profile";
    const what = item.kind === "post" ? "post" : "comment";
    const why = match.triage.reasons.length ? ` It was ranked ${match.triage.urgency} because: ${match.triage.reasons.join("; ")}.` : "";
    const how = item.kind === "post"
      ? "Once I approve it, add it as a comment on the post"
      : "Once I approve it, post it with the comment's own Reply button so it lands in the same thread";
    return [
      `Draft a reply to this Instagram ${what} that monitoring found, by @${item.author}: ${item.url}.${why}`,
      `Work in ClawBrowser on ${profile}, which is signed in to Instagram. Open the link with \`nbc open --profile ${cliProfile(profileName)} ${item.url}\` and read the ${what} and the thread around it.`,
      APPROVAL,
      `${how}, follow the Instagram skill's posting steps, and report whether the reply appeared on the page.`,
    ].join("\n\n");
  },
};


interface TikTokVideo {
  author?: string;
  desc?: string;
}

const tiktokSpec: SocialEngineSpec = {
  engine: "tiktok-monitor",
  name: "TikTok",
  site: "tiktok.com",
  handlePrefix: "@",
  files: { state: "tiktok-monitor-state.json", feed: "tiktok-monitor-feed.json", log: "tiktok-monitor-log.jsonl" },
  normalizeState: (raw) => tiktok.normalizeState(raw) as SocialState,
  withSettings: (state, patch) => tiktok.withSettings(state as tiktok.MonitorState, patch as tiktok.SettingsPatch) as SocialState,
  runPass: async (deps) => {
    const result = await tiktok.runPass({ ...deps, state: deps.state as tiktok.MonitorState });
    return {
      state: result.state as SocialState,
      events: result.events as unknown as SocialEvent[],
      summary: result.summary,
      matches: result.matches as unknown as SocialMatch[],
    };
  },
  checkAccount: (deps) => tiktok.checkAccount(deps),
  account: (state) => (state as tiktok.MonitorState).account,
  withAccount: (state, check, at) => {
    const previous = (state as tiktok.MonitorState).account;
    const handle = check.handle ?? previous?.handle;
    return { ...state, account: { ...previous, ...(handle ? { handle } : {}), signedIn: check.signedIn, checkedAt: at } } as SocialState;
  },
  intro: "Creators' new videos always count. Comments under them count when they name a keyword or you; comments on your own videos always count.",
  lists: [
    {
      key: "creators",
      label: "Creators to watch",
      placeholder: "creator, without @",
      prefix: "@",
      parse: (text) => text.split(/[\s,]+/).map(tiktok.normalizeHandle).filter(Boolean),
    },
    { key: "keywords", label: "Keywords", placeholder: "brand, product or #hashtag", parse: tiktok.splitKeywords },
    { key: "excludeKeywords", label: "Skip", placeholder: "words that rule a match out", parse: tiktok.splitKeywords },
  ],
  toggles: [
    { key: "watchOwnVideos", label: "Comments on your videos", title: "Needs the profile signed in to TikTok" },
    { key: "watchComments", label: "Keyword comments on creators' videos" },
    { key: "trackEngagement", label: "Engagement jumps" },
  ],
  canStart: (settings) => list(settings.creators).length > 0 || settings.watchOwnVideos === true,
  startHint: "Add a creator to watch first",
  signedOutNote: "public creators are still read; comments on your videos wait for a sign-in",
  followers: (state) => {
    const handle = (state as tiktok.MonitorState).account?.handle?.toLowerCase();
    const stats = handle ? (state as tiktok.MonitorState).followers[handle] : undefined;
    return stats ? { value: stats.followers, history: stats.history } : undefined;
  },
  where: (match) => {
    switch (match.source.kind) {
      case "own_comments": return "Your video";
      case "creator_comments": return `${match.source.name}'s video`;
      default: return match.source.name;
    }
  },
  context: (match) => {
    const video = match.item.video as TikTokVideo | undefined;
    if (!video || match.item.kind !== "comment") return undefined;
    const owner = video.author ? `@${video.author}'s video` : "a video";
    return video.desc ? `on ${owner}: “${quote(video.desc)}”` : `on ${owner}`;
  },
  authorUrl: (match) => (match.item.author ? `https://www.tiktok.com/@${match.item.author}` : undefined),
  replyTask: (match, profileName) => {
    const { item } = match;
    const profile = profileName ? `the browser profile "${profileName}"` : "the skill's browser profile";
    const why = match.triage.reasons.length ? ` It was ranked ${match.triage.urgency} because: ${match.triage.reasons.join("; ")}.` : "";
    const target = item.kind === "comment"
      ? `this TikTok comment by @${item.author}: "${quote(item.text, 200)}". TikTok has no link to a single comment, so find it under the video: ${item.url}`
      : `this TikTok video by @${item.author}: ${item.url}`;
    const how = item.kind === "comment"
      ? "Once I approve it, post it with that comment's own Reply button so it lands in its thread"
      : "Once I approve it, post it as a comment on the video";
    return [
      `Draft a reply to ${target}.${why}`,
      `Work in ClawBrowser on ${profile}, which is signed in to TikTok. Open the video with \`nbc open --profile ${cliProfile(profileName)} ${item.url}\` and read the ${item.kind === "comment" ? "comment and the thread around it" : "video's description and its top comments"}.`,
      APPROVAL,
      `${how}, follow the TikTok skill's posting steps, and report whether the reply appeared on the page. If TikTok shows a captcha, stop and tell me.`,
    ].join("\n\n");
  },
};

interface FacebookGroup {
  name?: string;
}

interface FacebookPost {
  author?: string;
  text?: string;
}

const facebookSpec: SocialEngineSpec = {
  engine: "facebook-monitor",
  name: "Facebook",
  site: "facebook.com",
  handlePrefix: "",
  files: { state: "facebook-monitor-state.json", feed: "facebook-monitor-feed.json", log: "facebook-monitor-log.jsonl" },
  normalizeState: (raw) => facebook.normalizeState(raw) as SocialState,
  withSettings: (state, patch) => facebook.withSettings(state as facebook.MonitorState, patch as Partial<facebook.MonitorSettings>) as SocialState,
  runPass: async (deps) => {
    const result = await facebook.runPass({ ...deps, state: deps.state as facebook.MonitorState });
    const { summary } = result;
    return {
      state: result.state as SocialState,
      events: result.events as unknown as SocialEvent[],
      summary: {
        signedIn: summary.signedIn,
        ...(summary.account ? { handle: summary.account } : {}),
        sourcesRead: summary.groupsRead,
        newItems: summary.newItems,
        urgent: summary.urgent,
        loginRequired: summary.loginRequired,
        securityCheck: summary.securityCheck,
        rateLimited: summary.rateLimited,
        ...(summary.blocked ? { blocked: summary.blocked } : {}),
      },
      matches: result.matches as unknown as SocialMatch[],
    };
  },
  checkAccount: async (deps) => {
    const check = await facebook.checkAccount(deps);
    return {
      signedIn: check.signedIn,
      ...(check.name ? { handle: check.name } : {}),
      ...(check.securityCheck ? { securityCheck: true } : {}),
      ...(check.blocked ? { blocked: check.blocked } : {}),
    };
  },
  account: (state) => {
    const account = (state as facebook.MonitorState).account;
    return account ? { ...(account.name ? { handle: account.name } : {}), signedIn: account.signedIn, checkedAt: account.checkedAt } : undefined;
  },
  withAccount: (state, check, at) => {
    const previous = (state as facebook.MonitorState).account;
    const name = check.handle ?? previous?.name;
    return { ...state, account: { ...previous, ...(name ? { name } : {}), signedIn: check.signedIn, checkedAt: at } } as SocialState;
  },
  intro: "Posts and comments in your groups count when they name a keyword or you. Turn on Every post to see everything the groups post.",
  lists: [
    {
      key: "groups",
      label: "Groups to watch",
      placeholder: "group link or id",
      parse: (text) => text.split(/[\s,]+/).map(facebook.normalizeGroup).filter(Boolean),
    },
    { key: "keywords", label: "Keywords", placeholder: "brand, product or phrase", parse: facebook.splitKeywords },
    { key: "excludeKeywords", label: "Skip", placeholder: "words that rule a match out", parse: facebook.splitKeywords },
  ],
  toggles: [
    { key: "reportAllPosts", label: "Every post", title: "Report every new post, not only the ones that name a keyword or you" },
    { key: "watchComments", label: "Comments under posts" },
  ],
  canStart: (settings) => list(settings.groups).length > 0,
  startHint: "Add a group first — only groups this account is a member of can be read",
  signedOutNote: "group posts are only shown to members, so sign in",
  followers: () => undefined,
  where: (match) => {
    const group = match.item.group as FacebookGroup | undefined;
    return group?.name || match.source.name;
  },
  context: (match) => {
    const post = match.item.post as FacebookPost | undefined;
    if (!post || match.item.kind !== "comment") return undefined;
    const owner = post.author ? `${post.author}'s post` : "a post";
    return post.text ? `on ${owner}: “${quote(post.text)}”` : `on ${owner}`;
  },
  authorUrl: (match) => (typeof match.item.authorUrl === "string" ? match.item.authorUrl : undefined),
  replyTask: (match, profileName) => {
    const { item } = match;
    const profile = profileName ? `the browser profile "${profileName}"` : "the skill's browser profile";
    const group = (item.group as FacebookGroup | undefined)?.name;
    const why = match.triage.reasons.length ? ` It was ranked ${match.triage.urgency} because: ${match.triage.reasons.join("; ")}.` : "";
    const how = item.kind === "comment"
      ? "Once I approve it, post it with that comment's own Reply link so it lands in its thread"
      : "Once I approve it, post it as a comment on the post";
    return [
      `Draft a reply to this Facebook ${item.kind === "comment" ? "comment" : "post"}${group ? ` in the group "${group}"` : ""}, by ${item.author}: ${item.url}.${why}`,
      `Work in ClawBrowser on ${profile}, which is signed in to Facebook and a member of the group. Open the link with \`nbc open --profile ${cliProfile(profileName)} ${item.url}\` and read the ${item.kind === "comment" ? "comment, the post and the thread" : "whole post (press See more if it is cut) and its comments"}. Keep to the group's rules.`,
      APPROVAL,
      `${how}, follow the Facebook skill's posting steps, and report whether the reply appeared on the page. If Facebook asks for a security check or says the account is temporarily blocked, stop and tell me.`,
    ].join("\n\n");
  },
};

interface LinkedInPost {
  author?: string;
  text?: string;
}

const linkedinSpec: SocialEngineSpec = {
  engine: "linkedin-monitor",
  name: "LinkedIn",
  site: "linkedin.com",
  handlePrefix: "",
  files: { state: "linkedin-monitor-state.json", feed: "linkedin-monitor-feed.json", log: "linkedin-monitor-log.jsonl" },
  normalizeState: (raw) => linkedin.normalizeState(raw) as SocialState,
  withSettings: (state, patch) => linkedin.withSettings(state as linkedin.MonitorState, patch as Partial<linkedin.MonitorSettings>) as SocialState,
  runPass: async (deps) => {
    const result = await linkedin.runPass({ ...deps, state: deps.state as linkedin.MonitorState });
    return {
      state: result.state as SocialState,
      events: result.events as unknown as SocialEvent[],
      summary: result.summary,
      matches: result.matches as unknown as SocialMatch[],
    };
  },
  checkAccount: async (deps) => {
    const check = await linkedin.checkAccount(deps);
    const handle = check.name ?? check.handle;
    return {
      signedIn: check.signedIn,
      ...(handle ? { handle } : {}),
      ...(check.securityCheck ? { securityCheck: true } : {}),
      ...(check.blocked ? { blocked: check.blocked } : {}),
    };
  },
  account: (state) => {
    const account = (state as linkedin.MonitorState).account;
    if (!account) return undefined;
    const handle = account.name ?? account.handle;
    return { ...(handle ? { handle } : {}), signedIn: account.signedIn, checkedAt: account.checkedAt };
  },
  withAccount: (state, check, at) => {
    const previous = (state as linkedin.MonitorState).account;
    const name = check.handle ?? previous?.name;
    return { ...state, account: { ...previous, ...(name ? { name } : {}), signedIn: check.signedIn, checkedAt: at } } as SocialState;
  },
  intro: "Mentions of you and your company always count, and so do comments on your posts. Keywords find posts and comments that name them, in search and on the accounts you watch.",
  lists: [
    {
      key: "companyNames",
      label: "Your company",
      placeholder: "company name, as people write it",
      parse: linkedin.splitKeywords,
    },
    {
      key: "accounts",
      label: "Accounts to watch",
      placeholder: "profile or company link, in/name or company/name",
      parse: (text) => text.split(/[\s,]+/).map((value) => linkedin.normalizeAccount(value)).filter((account): account is linkedin.AccountRef => !!account).map(linkedin.accountLabel),
      read: (value) => linkedin.normalizeAccounts(value).map(linkedin.accountLabel),
      write: (values) => values,
    },
    { key: "keywords", label: "Keywords", placeholder: "product, competitor or phrase", parse: linkedin.splitKeywords },
    { key: "excludeKeywords", label: "Skip", placeholder: "words that rule a match out", parse: linkedin.splitKeywords },
  ],
  toggles: [
    { key: "watchNotifications", label: "Mentions and comments" },
    { key: "searchKeywords", label: "Search for your company and keywords", title: "A search or two per pass; LinkedIn limits searches on free accounts" },
    { key: "watchComments", label: "Comments under posts" },
  ],
  canStart: (settings) => settings.watchNotifications === true || list(settings.companyNames).length > 0 || list(settings.keywords).length > 0
    || (Array.isArray(settings.accounts) && settings.accounts.length > 0),
  startHint: "Turn on mentions, or add your company, a keyword or an account first",
  signedOutNote: "LinkedIn shows little signed out, so sign in",
  followers: () => undefined,
  where: (match) => {
    switch (match.source.kind) {
      case "notifications": return "Notifications";
      case "search": return `Search “${quote(match.source.name, 40)}”`;
      default: return match.source.name;
    }
  },
  context: (match) => {
    const post = match.item.post as LinkedInPost | undefined;
    if (!post || match.item.kind !== "comment") {
      const headline = match.item.authorHeadline;
      return typeof headline === "string" && headline ? quote(headline, 90) : undefined;
    }
    const owner = post.author ? `${post.author}'s post` : "a post";
    return post.text ? `on ${owner}: “${quote(post.text)}”` : `on ${owner}`;
  },
  authorUrl: (match) => (typeof match.item.authorUrl === "string" ? match.item.authorUrl : undefined),
  replyTask: (match, profileName) => {
    const { item } = match;
    const profile = profileName ? `the browser profile "${profileName}"` : "the skill's browser profile";
    const why = match.triage.reasons.length ? ` It was ranked ${match.triage.urgency} because: ${match.triage.reasons.join("; ")}.` : "";
    const how = item.kind === "comment"
      ? "Once I approve it, post it with that comment's own Reply button so it lands in its thread"
      : "Once I approve it, post it as a comment on the post";
    return [
      `Draft a reply to this LinkedIn ${item.kind === "comment" ? "comment" : "post"} by ${item.author}: ${item.url}.${why}`,
      `Work in ClawBrowser on ${profile}, which is signed in to LinkedIn. Open the link with \`nbc open --profile ${cliProfile(profileName)} ${item.url}\` and read the ${item.kind === "comment" ? "comment, the post and the thread" : "whole post (press …see more if it is cut) and its comments"}. Keep it professional and specific - no sales pitch the thread did not ask for.`,
      APPROVAL,
      `${how}, follow the LinkedIn skill's posting steps, and report whether the reply appeared on the page. If LinkedIn asks for a security check, says the account is restricted or shows a usage limit, stop and tell me.`,
    ].join("\n\n");
  },
};

const SPECS: Partial<Record<SocialEngineId, SocialEngineSpec>> = {
  "instagram-monitor": instagramSpec,
  "tiktok-monitor": tiktokSpec,
  "facebook-monitor": facebookSpec,
  "linkedin-monitor": linkedinSpec,
};

/** socialEngine returns the spec for an engine the app runs, or undefined for
 *  one it does not know. */
export function socialEngine(engine: unknown): SocialEngineSpec | undefined {
  return isSocialEngine(engine) ? SPECS[engine] : undefined;
}

export function socialEngines(): SocialEngineSpec[] {
  return Object.values(SPECS).filter((spec): spec is SocialEngineSpec => !!spec);
}
