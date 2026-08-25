// Page scripts for the X reply engine, ported from the nextbrowser-x-reply-agent
// Go service (internal/xtimeline/script.go, internal/xnotify/script.go and
// internal/publish/scripts.go).
//
// Each script is one expression that returns a JSON-serializable value, because
// it runs through CDP Runtime.evaluate with returnByValue. Values that come from
// outside the page — draft text, handles — are inserted as JSON literals, so
// nothing a post contains can break out of the expression.

/** jsLiteral renders a value as a JavaScript literal safe to inline. */
export function jsLiteral(value: unknown): string {
  return JSON.stringify(value ?? "");
}

const TWEET_SELECTOR = `article[data-testid="tweet"], [itemtype="https://schema.org/SocialMediaPosting"]`;
/** What a rendered timeline looks like: a post, or the explicit empty state.
 *  X renders posts asynchronously, so a read right after load sees nothing. */
export const TIMELINE_READY_SELECTOR = `article[data-testid="tweet"], [data-testid="emptyState"]`;
/** The notifications feed's own rendered markers. */
export const FEED_READY_SELECTOR = `article[data-testid="notification"], article[data-testid="tweet"], [data-testid="emptyState"]`;
const ARTICLE_SELECTOR = `article[data-testid="tweet"]`;
/** The DraftJS editor itself. Wrappers share the testid prefix, so the
 *  contenteditable attribute is what separates the editor from its label. */
export const COMPOSER_SELECTOR = `[data-testid^="tweetTextarea_"][contenteditable="true"]`;
export const COMPOSER_TESTID_PREFIX = "tweetTextarea_";
const SUBMIT_SELECTOR = `[data-testid="tweetButtonInline"], [data-testid="tweetButton"]`;
const REPLY_CONTROL_SELECTOR = `[data-testid="reply"]`;
/** The composer's attachment wrapper. It stays a single testid on purpose: a
 *  looser list would also match the media of the post being replied to whenever
 *  the composer is inline rather than in a dialog. */
const ATTACHMENT_SELECTOR = `[data-testid="attachments"]`;
const GIF_BUTTON_SELECTOR = `[data-testid="gifSearchButton"]`;
/** X renamed the picker's parts: the search box is gifSearchSearchInput and a
 *  result is gifSearchGifImage, an img carrying its description in alt. */
export const GIF_INPUT_SELECTOR = `[data-testid="gifSearchSearchInput"]`;
export const GIF_RESULT_SELECTOR = `[data-testid="gifSearchGifImage"]`;
export const ATTACHMENTS_SELECTOR = ATTACHMENT_SELECTOR;

/** A raw post as the page reports it. */
export interface RawPost {
  id: string;
  url: string;
  author: string;
  text: string;
  created_at: string;
  social_context: string;
  reply_context: string;
  pinned: boolean;
  repost: boolean;
  reply: boolean;
  promoted: boolean;
}

export interface TimelineSnapshot {
  url: string;
  login_wall: boolean;
  empty_timeline: boolean;
  posts: RawPost[];
}

export interface NotificationsSnapshot {
  url: string;
  login_wall: boolean;
  empty: boolean;
  posts: RawPost[];
  triggers: { handle: string; notified_at: string; text: string }[];
}

export interface BellState {
  url: string;
  login_wall: boolean;
  header: boolean;
  following: boolean;
  unfollowed: boolean;
  enabled: boolean;
  found: boolean;
  label: string;
  x: number;
  y: number;
  visible: boolean;
}

export interface PageState {
  url: string;
  on_post: boolean;
  reply_composer_route: boolean;
  login_wall: boolean;
  composer: { present: boolean; text: string };
  submit: { present: boolean; disabled: boolean };
  media: { present: boolean; uploading: boolean };
  identity: { present: boolean; handle: string; matches: boolean };
  reply_control: boolean;
  existing_reply_url: string;
}

export interface ClickTarget {
  found: boolean;
  x: number;
  y: number;
  reason: string;
}

export interface GifInputResult {
  inserted: boolean;
  value: string;
  reason: string;
}

export interface GifPick {
  found: boolean;
  x: number;
  y: number;
  alt: string;
  considered: number;
  skipped: string[];
  reason: string;
}

export interface MediaState {
  present: boolean;
  uploading: boolean;
  submit_enabled: boolean;
}

export interface VerifyState {
  url: string;
  composer_present: boolean;
  composer_text: string;
  submit_disabled: boolean;
  reply_found: boolean;
  reply_url: string;
}

const POST_READER = `
  const readArticle = (article, seen) => {
    const stamp = article.querySelector('a[href*="/status/"] time[datetime]');
    if (!stamp) return null;
    const anchor = stamp.closest('a[href*="/status/"]');
    if (!anchor) return null;
    const permalink = /^\\/([A-Za-z0-9_]{1,20})\\/status\\/(\\d+)/.exec(anchor.getAttribute("href") || "");
    if (!permalink) return null;
    const id = permalink[2];
    if (seen.has(id)) return null;
    seen.add(id);
    // A quoted post carries its own tweetText inside a role=link card. Only the
    // post's own text counts, so a media-only post that quotes someone comes
    // back empty and is skipped instead of being answered with the quoted
    // author's words.
    const bodies = Array.from(article.querySelectorAll('[data-testid="tweetText"]'));
    const body = bodies.find((node) => !node.closest('div[role="link"]')) || null;
    const social = article.querySelector('[data-testid="socialContext"]');
    let replyContext = "";
    for (const node of article.querySelectorAll('div[dir="ltr"], span')) {
      const value = (node.textContent || "").trim();
      if (value.toLowerCase().startsWith("replying to")) { replyContext = value; break; }
    }
    return {
      id: id,
      url: "https://x.com/" + permalink[1] + "/status/" + id,
      author: permalink[1],
      text: body ? (body.innerText || "").trim() : "",
      created_at: stamp.getAttribute("datetime") || "",
      social_context: social ? (social.innerText || "").trim() : "",
      reply_context: replyContext,
      pinned: false,
      repost: false,
      reply: replyContext !== "",
      promoted: !!article.querySelector('[data-testid="placementTracking"]')
    };
  };`;

const LOGIN_WALL_CHECK = `
  const atLoginWall = () => {
    const path = location.pathname.toLowerCase();
    if (path.startsWith("/i/flow/") || path.startsWith("/i/jf/") || path.startsWith("/login") ||
        location.search.indexOf("redirect_after_login") >= 0) return true;
    return !!document.querySelector('a[href="/i/flow/login"], input[autocomplete="username"]');
  };`;

/** timelineScript reads the visible posts of a profile timeline. */
export function timelineScript(limit: number): string {
  return `(() => {${POST_READER}${LOGIN_WALL_CHECK}
  const limit = ${Math.max(1, Math.floor(limit))};
  const decodeHTML = (value) => { const area = document.createElement("textarea"); area.innerHTML = value || ""; return area.value; };
  const snapshot = { url: location.href, login_wall: false, empty_timeline: false, posts: [] };
  if (atLoginWall()) { snapshot.login_wall = true; return snapshot; }
  const articles = Array.from(document.querySelectorAll('${TWEET_SELECTOR}'));
  if (articles.length === 0) {
    const zeroPostCount = Array.from(document.querySelectorAll('main [dir="ltr"], main span')).some((node) =>
      /^0 posts?$/i.test((node.textContent || "").trim()));
    if (document.querySelector('[data-testid="emptyState"]') || zeroPostCount) { snapshot.empty_timeline = true; return snapshot; }
  }
  const seen = new Set();
  for (const article of articles) {
    if (snapshot.posts.length >= limit) break;
    if (article.getAttribute("itemtype") === "https://schema.org/SocialMediaPosting") {
      const urlMeta = article.querySelector(':scope > meta[itemprop="url"][content*="/status/"]');
      const bodyMeta = article.querySelector(':scope > meta[itemprop="articleBody"]');
      const dateMeta = article.querySelector(':scope > meta[itemprop="dateCreated"]');
      const authorMeta = article.querySelector('[itemprop="author"] meta[itemprop="url"]');
      const postURL = urlMeta ? (urlMeta.getAttribute("content") || "") : "";
      const permalink = /^https:\\/\\/x\\.com\\/([A-Za-z0-9_]{1,20})\\/status\\/(\\d+)/.exec(postURL);
      if (!permalink || seen.has(permalink[2])) continue;
      const authorURL = authorMeta ? (authorMeta.getAttribute("content") || "") : "";
      const authorMatch = /^https:\\/\\/x\\.com\\/([A-Za-z0-9_]{1,20})/.exec(authorURL);
      seen.add(permalink[2]);
      snapshot.posts.push({
        id: permalink[2], url: postURL, author: authorMatch ? authorMatch[1] : permalink[1],
        text: bodyMeta ? decodeHTML(bodyMeta.getAttribute("content")).trim() : "",
        created_at: dateMeta ? (dateMeta.getAttribute("content") || "") : "",
        social_context: "", reply_context: "", pinned: false, repost: false, reply: false, promoted: false
      });
      continue;
    }
    const post = readArticle(article, seen);
    if (post) snapshot.posts.push(post);
  }
  // X pins a post above newer ones. The top entry is pinned when something
  // below it is newer, which is the only signal the DOM gives reliably.
  if (snapshot.posts.length > 1) {
    const first = snapshot.posts[0].id.replace(/^0+/, "");
    const newerExists = snapshot.posts.slice(1).some((post) => {
      const id = post.id.replace(/^0+/, "");
      return id.length > first.length || (id.length === first.length && id > first);
    });
    if (newerExists) snapshot.posts[0].pinned = true;
  }
  return snapshot;
})()`;
}

/** notificationsScript reads the notifications feed: posts it renders in full,
 *  and notices that only say an account has posted. */
export function notificationsScript(limit: number): string {
  return `(() => {${POST_READER}${LOGIN_WALL_CHECK}
  const limit = ${Math.max(1, Math.floor(limit))};
  const snapshot = { url: location.href, login_wall: false, empty: false, posts: [], triggers: [] };
  if (atLoginWall()) { snapshot.login_wall = true; return snapshot; }
  const handleOf = (root) => {
    for (const anchor of Array.from(root.querySelectorAll("a"))) {
      const match = /^\\/([A-Za-z0-9_]{1,15})$/.exec(anchor.getAttribute("href") || "");
      if (match) return match[1];
    }
    return "";
  };
  // A notice names the account and the time, never the post: it is a trigger to
  // read that profile, not a source of post text.
  for (const notice of Array.from(document.querySelectorAll('article[data-testid="notification"]'))) {
    if (snapshot.triggers.length >= limit) break;
    const text = (notice.innerText || "").replace(/\\s+/g, " ").trim();
    if (text.toLowerCase().indexOf("new post notifications") < 0) continue;
    const handle = handleOf(notice);
    if (!handle) continue;
    const stamp = notice.querySelector("time[datetime]");
    snapshot.triggers.push({ handle: handle, notified_at: stamp ? (stamp.getAttribute("datetime") || "") : "", text: text.slice(0, 160) });
  }
  const seen = new Set();
  for (const article of Array.from(document.querySelectorAll('${ARTICLE_SELECTOR}'))) {
    if (snapshot.posts.length >= limit) break;
    const post = readArticle(article, seen);
    if (post) snapshot.posts.push(post);
  }
  if (snapshot.posts.length === 0 && snapshot.triggers.length === 0) {
    snapshot.empty = !!document.querySelector('[data-testid="emptyState"]') ||
      !!document.querySelector('article[data-testid="notification"]') ||
      !!document.querySelector('div[data-testid="primaryColumn"]');
  }
  return snapshot;
})()`;
}

/** bellScript reads the Notify button of the loaded profile. X labels the
 *  button by the action it offers, so "Turn off post notifications" is what an
 *  account that already notifies looks like. */
export function bellScript(): string {
  return `(() => {${LOGIN_WALL_CHECK}
  const state = { url: location.href, login_wall: false, header: false, following: false, unfollowed: false, enabled: false, found: false, label: "", x: 0, y: 0, visible: false };
  if (atLoginWall()) { state.login_wall = true; return state; }
  const nodes = Array.from(document.querySelectorAll('button[aria-label], div[role="button"][aria-label]'));
  const pick = (needle) => nodes.find((node) => (node.getAttribute("aria-label") || "").toLowerCase().indexOf(needle) >= 0);
  const on = pick("turn off post notifications");
  const off = pick("turn on post notifications");
  const target = off || on;
  // header separates a profile that has not rendered from one this account does
  // not follow: both lack a bell, but only the second is worth giving up on.
  state.header = !!document.querySelector('[data-testid="userActions"]');
  state.following = !!document.querySelector('[data-testid$="-unfollow"]');
  state.unfollowed = !!document.querySelector('[data-testid$="-follow"]');
  if (!target) return state;
  const rect = target.getBoundingClientRect();
  state.found = true;
  state.label = target.getAttribute("aria-label") || "";
  state.enabled = !!on || target.getAttribute("aria-pressed") === "true";
  state.x = rect.left + rect.width / 2;
  state.y = rect.top + rect.height / 2;
  state.visible = rect.width > 0 && rect.height > 0;
  return state;
})()`;
}

const FOCUSED_TWEET_HELPER = `
  // A status page renders ancestor tweets above the focused one, and their reply
  // controls point at the wrong post. Two facts identify the focused tweet: it
  // links its own status in a timestamp, or it is the only article whose
  // timestamp is not a link. An ambiguous page yields no control at all, so the
  // attempt fails instead of replying to the wrong tweet.
  const focusedReplyControl = (postId) => {
    const articles = Array.from(document.querySelectorAll('${TWEET_SELECTOR}'));
    const exact = articles.filter((article) => Array.from(article.querySelectorAll('a[href*="/status/"] time')).some((time) => {
      const anchor = time.closest('a[href*="/status/"]');
      return anchor && (anchor.getAttribute("href") || "").includes("/status/" + postId);
    }));
    if (exact.length === 1) return exact[0].querySelector('${REPLY_CONTROL_SELECTOR}');
    const unlinked = articles.filter((article) => !article.querySelector('a[href*="/status/"] time'));
    if (unlinked.length !== 1) return null;
    return unlinked[0].querySelector('${REPLY_CONTROL_SELECTOR}');
  };`;

const REPLY_FINDER_HELPER = `
  const normalizeReply = (value) => (value || "").replace(/\\s+/g, " ").trim();
  const findPublisherReply = (wanted, publisherHandle) => {
    const target = normalizeReply(wanted);
    const expected = (publisherHandle || "").toLowerCase();
    if (!target || !expected) return "";
    for (const article of document.querySelectorAll('${ARTICLE_SELECTOR}')) {
      const body = article.querySelector('[data-testid="tweetText"]');
      if (!body || normalizeReply(body.innerText) !== target) continue;
      for (const time of Array.from(article.querySelectorAll('a[href*="/status/"] time[datetime]'))) {
        const anchor = time.closest('a[href*="/status/"]');
        const match = /^\\/([A-Za-z0-9_]{1,15})\\/status\\/(\\d+)/.exec(anchor ? (anchor.getAttribute("href") || "") : "");
        if (match && match[1].toLowerCase() === expected) return new URL(anchor.getAttribute("href"), location.origin).toString();
      }
    }
    return "";
  };`;

const IDENTITY_HELPER = `
  const publisherIdentity = (wantedHandle) => {
    const expected = (wantedHandle || "").toLowerCase();
    const nodes = Array.from(document.querySelectorAll('[data-testid="SideNav_AccountSwitcher_Button"], a[data-testid="AppTabBar_Profile_Link"]'));
    for (const node of nodes) {
      const textMatch = /@([A-Za-z0-9_]{1,15})(?![A-Za-z0-9_])/.exec(node.innerText || node.getAttribute("aria-label") || "");
      const hrefMatch = /^\\/([A-Za-z0-9_]{1,15})\\/?(?:[?#]|$)/.exec(node.getAttribute("href") || "");
      const handle = textMatch ? textMatch[1] : (hrefMatch ? hrefMatch[1] : "");
      if (handle) return { present: true, handle: handle, matches: handle.toLowerCase() === expected };
    }
    return { present: nodes.length > 0, handle: "", matches: false };
  };`;

const HIT_TEST_HELPER = `
  // An overlay, a sticky banner or a shifted layout would swallow a click, so
  // the point is verified to actually hit the element before it is dispatched.
  const clickPoint = (element) => {
    if (!element) return { found: false, x: 0, y: 0, reason: "element not found" };
    element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { found: false, x: 0, y: 0, reason: "element has no size" };
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !(hit === element || element.contains(hit) || hit.contains(element))) {
      return { found: false, x: x, y: y, reason: "element is covered at its click point" };
    }
    return { found: true, x: x, y: y, reason: "" };
  };`;

/** identityScript reads only who is signed in, which is what the panel shows
 *  before anything is watched. */
export function identityScript(): string {
  return `(() => {${IDENTITY_HELPER}${LOGIN_WALL_CHECK}
  return { url: location.href, login_wall: atLoginWall(), identity: publisherIdentity("") };
})()`;
}

/** inspectScript reports composer and submit state without scrolling, so click
 *  points measured afterwards stay valid. */
export function inspectScript(postId: string, replyText: string, publisherHandle: string): string {
  return `(() => {${FOCUSED_TWEET_HELPER}${REPLY_FINDER_HELPER}${IDENTITY_HELPER}
  const postId = ${jsLiteral(postId)};
  const wanted = ${jsLiteral(replyText)};
  const publisherHandle = ${jsLiteral(publisherHandle)};
  const path = location.pathname.toLowerCase();
  const state = {
    url: location.href,
    on_post: path.includes("/status/" + postId),
    reply_composer_route: false,
    login_wall: path.startsWith("/i/flow/login") || path.startsWith("/login"),
    composer: { present: false, text: "" },
    submit: { present: false, disabled: true },
    media: { present: false, uploading: false },
    identity: publisherIdentity(publisherHandle),
    reply_control: false,
    existing_reply_url: ""
  };
  const editor = document.querySelector('${COMPOSER_SELECTOR}');
  if (editor) {
    state.composer.present = true;
    state.composer.text = (editor.innerText || "").trim();
    state.reply_composer_route = path === "/compose/post" && !!editor.closest('[role="dialog"]');
  }
  const submit = document.querySelector('${SUBMIT_SELECTOR}');
  if (submit) {
    state.submit.present = true;
    state.submit.disabled = submit.getAttribute("aria-disabled") === "true" || submit.disabled === true;
  }
  const composerRoot = editor ? (editor.closest('[role="dialog"]') || editor.closest('form') || document) : document;
  const attachments = composerRoot.querySelector('${ATTACHMENT_SELECTOR}');
  state.media.present = !!attachments;
  // The composer renders a progressbar for the character counter too, so an
  // upload is only what runs inside the media preview itself.
  state.media.uploading = !!(attachments && attachments.querySelector('[role="progressbar"]'));
  state.reply_control = !!focusedReplyControl(postId);
  state.existing_reply_url = findPublisherReply(wanted, publisherHandle);
  return state;
})()`;
}

/** focusedReplyRectScript locates the reply control of the focused post only. */
export function focusedReplyRectScript(postId: string): string {
  return `(() => {${HIT_TEST_HELPER}${FOCUSED_TWEET_HELPER}
  return clickPoint(focusedReplyControl(${jsLiteral(postId)}));
})()`;
}

/** composerSubmitRectScript locates the submit button of the open composer. */
export function composerSubmitRectScript(): string {
  return `(() => {${HIT_TEST_HELPER}
  const editor = document.querySelector('${COMPOSER_SELECTOR}');
  if (!editor) return clickPoint(null);
  const root = editor.closest('[role="dialog"]') || editor.closest('form') || document;
  return clickPoint(root.querySelector('${SUBMIT_SELECTOR}'));
})()`;
}

/** pointScript locates any element by selector. */
export function pointScript(selector: string): string {
  return `(() => {${HIT_TEST_HELPER}
  return clickPoint(document.querySelector(${jsLiteral(selector)}));
})()`;
}

/** verifyScript looks for durable evidence that the reply was accepted: the
 *  reply rendered in the conversation, or a cleared, disabled composer. */
export function verifyScript(replyText: string, publisherHandle: string): string {
  return `(() => {${REPLY_FINDER_HELPER}
  const wanted = ${jsLiteral(replyText)};
  const publisherHandle = ${jsLiteral(publisherHandle)};
  const state = { url: location.href, composer_present: false, composer_text: "", submit_disabled: false, reply_found: false, reply_url: "" };
  const editor = document.querySelector('${COMPOSER_SELECTOR}');
  if (editor) { state.composer_present = true; state.composer_text = normalizeReply(editor.innerText); }
  const submit = document.querySelector('${SUBMIT_SELECTOR}');
  if (submit) state.submit_disabled = submit.getAttribute("aria-disabled") === "true" || submit.disabled === true;
  const replyURL = findPublisherReply(wanted, publisherHandle);
  if (replyURL) { state.reply_found = true; state.reply_url = replyURL; }
  return state;
})()`;
}

/** composerGifRectScript locates the GIF button of the open composer. */
export function composerGifRectScript(): string {
  return `(() => {${HIT_TEST_HELPER}
  const editor = document.querySelector('${COMPOSER_SELECTOR}');
  if (!editor) return clickPoint(null);
  const root = editor.closest('[role="dialog"]') || editor.closest('form') || document;
  return clickPoint(root.querySelector('${GIF_BUTTON_SELECTOR}'));
})()`;
}

/** gifInputScript types the curated search phrase into the picker. React
 *  ignores a plain value assignment, so the native setter is used. */
export function gifInputScript(query: string): string {
  return `(() => {
  const query = ${jsLiteral(query)};
  const input = document.querySelector('${GIF_INPUT_SELECTOR}');
  if (!input) return { inserted: false, value: "", reason: "GIF search input not found" };
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, query);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: query }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return { inserted: input.value === query, value: input.value, reason: input.value === query ? "" : "GIF search input rejected text" };
})()`;
}

/** gifPickScript chooses which search result to attach. X returns whatever the
 *  picker promotes at that moment, so the description of each result is read and
 *  anything matching the blocklist is skipped instead of being posted from the
 *  account. */
export function gifPickScript(blocklist: string[], limit: number): string {
  const words = blocklist.map((word) => word.trim().toLowerCase()).filter(Boolean);
  return `(() => {${HIT_TEST_HELPER}
  const blocked = ${jsLiteral(words)};
  const limit = ${Math.max(1, Math.floor(limit))};
  const describe = (node) => {
    // The result is itself an img on the current markup, so its own alt matters
    // as much as that of any image inside it.
    const image = node.querySelector("img");
    return [node.getAttribute("aria-label"), node.getAttribute("alt"), image ? image.getAttribute("alt") : "", node.getAttribute("title"), node.innerText || ""]
      .filter((value) => !!value).join(" ").replace(/\s+/g, " ").trim();
  };
  const nodes = Array.from(document.querySelectorAll('${GIF_RESULT_SELECTOR}')).slice(0, limit);
  if (nodes.length === 0) return { found: false, x: 0, y: 0, alt: "", considered: 0, skipped: [], reason: "no search results" };
  const skipped = [];
  for (const node of nodes) {
    const alt = describe(node);
    const lowered = alt.toLowerCase();
    const hit = blocked.find((word) => !!word && lowered.indexOf(word) >= 0);
    if (hit) { skipped.push((alt || "(no description)") + " [blocked: " + hit + "]"); continue; }
    const point = clickPoint(node);
    if (!point.found) { skipped.push((alt || "(no description)") + " [" + point.reason + "]"); continue; }
    return { found: true, x: point.x, y: point.y, alt: alt, considered: nodes.length, skipped: skipped, reason: "" };
  }
  return { found: false, x: 0, y: 0, alt: "", considered: nodes.length, skipped: skipped, reason: "every result was skipped" };
})()`;
}

/** mediaStateScript reports the composer's attachment on its own, which is what
 *  the publisher waits on while X finishes an upload. */
export function mediaStateScript(): string {
  return `(() => {
  const editor = document.querySelector('${COMPOSER_SELECTOR}');
  const composerRoot = editor ? (editor.closest('[role="dialog"]') || editor.closest('form') || document) : document;
  const attachments = composerRoot.querySelector('${ATTACHMENT_SELECTOR}');
  const submit = document.querySelector('${SUBMIT_SELECTOR}');
  return {
    present: !!attachments,
    uploading: !!(attachments && attachments.querySelector('[role="progressbar"]')),
    submit_enabled: !!submit && submit.getAttribute("aria-disabled") !== "true" && submit.disabled !== true
  };
})()`;
}
