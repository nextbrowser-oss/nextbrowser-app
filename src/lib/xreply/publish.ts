// Publishing one approved reply, ported from the Go service's
// internal/publish/publisher.go.
//
// The order of the checks is the safety property, not an implementation detail.
// The reply button is clicked exactly once, only after the page has been proven
// to be the right post, signed in as the right account, holding exactly the
// approved text. An attempt whose outcome cannot be verified is reported as
// unverified and never resent on its own: the reply may already be live.

import type { XBrowser } from "./browser";
import {
  ATTACHMENTS_SELECTOR,
  COMPOSER_SELECTOR,
  COMPOSER_TESTID_PREFIX,
  GIF_INPUT_SELECTOR,
  GIF_RESULT_SELECTOR,
  IDENTITY_READY_SELECTOR,
  POST_READY_SELECTOR,
  composerGifRectScript,
  composerSubmitRectScript,
  focusedReplyRectScript,
  gifInputScript,
  gifPickScript,
  inspectScript,
  mediaStateScript,
  verifyScript,
  type ClickTarget,
  type GifInputResult,
  type GifPick,
  type MediaState,
  type PageDiag,
  type PageState,
  type VerifyState,
} from "./scripts";
import { postIdFromUrl } from "./posts";
import { loadPage } from "./page";
import { xlog } from "./log";

/** What a drafted reaction is worth. Ported from the Go service's GIF modes. */
export type GifMode = "optional" | "required" | "off";

export interface GifOptions {
  /** The curated search phrase the draft's reaction resolved to. */
  query: string;
  mode: GifMode;
  blocklist: string[];
  /** Whether the GIF budget still allows one. Checked before the picker opens. */
  allowed: () => Promise<boolean> | boolean;
}

export type PublishOutcome =
  | { status: "published"; replyUrl?: string; gif?: string }
  | { status: "already-published"; replyUrl: string }
  /** Nothing was submitted. Retrying later is safe. */
  | { status: "refused"; reason: string }
  /** Submit was clicked but the result could not be confirmed. Never resent. */
  | { status: "unverified"; reason: string };

export interface PublishRequest {
  postUrl: string;
  replyText: string;
  /** The handle the profile must be signed in as. */
  publisherHandle: string;
  gif?: GifOptions;
}

export interface PublishOptions {
  sleep?: (ms: number) => Promise<void>;
  verifyAttempts?: number;
  verifyDelayMs?: number;
  waitTimeoutSeconds?: number;
  onNote?: (note: string) => void;
}

const VERIFY_ATTEMPTS = 6;
const VERIFY_DELAY_MS = 2000;
const WAIT_TIMEOUT_SECONDS = 20;
/** How long the post page may take to draw the account chrome after the post
 *  itself. Mirrors the identity wait of the feed check; ends early on the
 *  signed-out markers, so only a page that draws no chrome at all pays it. */
const IDENTITY_WAIT_SECONDS = 12;
const GIF_PICK_LIMIT = 8;
/** The preview appears before the upload behind it completes, and the reply
 *  button stays disabled until it does. */
const UPLOAD_ATTEMPTS = 10;
const UPLOAD_DELAY_MS = 1000;

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/** describeDiag turns a page's diagnostics into the tail of a note: enough for
 *  a screenshot of the panel to say what the page was, without the log. */
export function describeDiag(diag?: PageDiag): string {
  if (!diag) return "";
  const parts = [
    `${diag.width}×${diag.height}`,
    diag.visible === "visible" ? "tab visible" : `tab ${diag.visible || "state unknown"}`,
    `document ${diag.ready || "unknown"}`,
    `${diag.posts} post${diag.posts === 1 ? "" : "s"} drawn`,
    diag.anchors.length ? `chrome: ${diag.anchors.join(", ")}` : "no account chrome",
  ];
  return ` (${parts.join(", ")})`;
}

/** publishReply drives the browser sequence for one reply. */
export async function publishReply(
  browser: XBrowser,
  request: PublishRequest,
  options: PublishOptions = {},
): Promise<PublishOutcome> {
  const sleep = options.sleep ?? wait;
  const waitSeconds = options.waitTimeoutSeconds ?? WAIT_TIMEOUT_SECONDS;
  const note = options.onNote ?? (() => undefined);
  // Every refusal goes into the log with the page that caused it. The reason
  // is what the panel shows; the diagnostics are what explain it later.
  const refuse = (reason: string, seen?: { url: string; diag?: PageDiag; identity?: PageState["identity"] }): PublishOutcome => {
    xlog("publish.refused", { post: request.postUrl, reason, url: seen?.url, identity: seen?.identity, diag: seen?.diag });
    return { status: "refused", reason };
  };
  const postId = postIdFromUrl(request.postUrl);
  if (!postId) return refuse("The source URL carries no post id.");
  if (!request.publisherHandle) return refuse("No publishing account is configured.");

  const inspect = () =>
    browser.evaluate<PageState>(inspectScript(postId, request.replyText, request.publisherHandle), "inspect");

  // The post and the account chrome render after the load event, and a tab
  // where x.com's app has failed renders neither on any reload, so the landing
  // goes through loadPage: it waits, and reopens the post in a fresh tab when
  // nothing came. A page x.com never drew is refused as such — it is not a
  // sign-out, and calling it one sent the user to sign in again and again.
  const page = await loadPage(browser, request.postUrl, POST_READY_SELECTOR);
  if (!page.rendered && !page.login_wall) {
    return refuse(
      `x.com did not render the post page (${page.error_screen ? "its error screen" : "a blank page"}), even in a fresh tab.`,
      page,
    );
  }
  let state = await inspect();

  if (!state.login_wall && !state.identity.session) {
    // x.com draws the post and the account chrome from separate requests, and
    // the post can come first — the landing above waits for the post only.
    // The feed check waits for the chrome (readPublisher); reading it here the
    // moment the post appeared called a signed-in profile signed out, which is
    // how every reply of a pass came to be refused on a slow connection.
    await browser.waitForSelector(IDENTITY_READY_SELECTOR, IDENTITY_WAIT_SECONDS).catch(() => undefined);
    state = await inspect();
  }
  if (state.login_wall) return refuse("The browser profile is not signed in to x.com.", state);
  if (!state.identity.session) {
    // No sign-in wall and no account chrome either: a page x.com only half
    // drew, or not the page at all. Neither is cured by signing in again, so
    // it is not called a sign-out — and the note says what the page was.
    return refuse(`x.com drew the post page without the account chrome, so the reply was not sent${describeDiag(state.diag)}.`, state);
  }
  if (!state.on_post) return refuse(`Landed on ${state.url} instead of the post.`, state);
  // A reply from the wrong account cannot be taken back, so an account the page
  // did not name is refused exactly like an account that does not match.
  if (!state.identity.handle) {
    return refuse("x.com did not say which account is signed in, so the reply was not sent.", state);
  }
  if (!state.identity.matches) {
    return refuse(`Signed in as @${state.identity.handle}, expected @${request.publisherHandle}.`, state);
  }
  // A reply with this exact text already under this post is this reply. Sending
  // it again would double-post, so the existing one is adopted instead.
  if (state.existing_reply_url) return { status: "already-published", replyUrl: state.existing_reply_url };

  if (!state.composer.present) {
    if (!state.reply_control) return refuse("No reply composer on the post page.", state);
    const control = await browser.evaluate<ClickTarget>(focusedReplyRectScript(postId), "reply-point");
    if (!control.found) return refuse(`Could not open the composer: ${control.reason}.`, state);
    await browser.clickAt(control.x, control.y);
    try {
      await browser.waitForSelector(COMPOSER_SELECTOR, 10);
    } catch {
      return refuse("The reply composer did not open.", state);
    }
    state = await inspect();
    if (!state.composer.present) return refuse("The reply composer did not open.", state);
  }
  if (state.composer.text) {
    await browser.press("Escape").catch(() => undefined);
    return refuse(`The composer already holds a draft: ${state.composer.text.slice(0, 80)}`, state);
  }

  await browser.inputByTestIdPrefix(COMPOSER_TESTID_PREFIX, request.replyText);

  // A reaction is attached before the final gate, so the gate sees the composer
  // exactly as it will be submitted.
  let attached = "";
  if (request.gif && request.gif.query && request.gif.mode !== "off" && await request.gif.allowed()) {
    try {
      attached = await attachGif(browser, request.gif, { sleep, waitSeconds, note });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (request.gif.mode === "required") {
        await browser.press("Escape").catch(() => undefined);
        return refuse(`The GIF could not be attached: ${reason}`, state);
      }
      // A broken picker must not cost a reply: close it and send text only.
      note(`GIF not attached, sending text only: ${reason}`);
      await browser.press("Escape").catch(() => undefined);
    }
  }

  // Final gate before the only external write: right post, right account, right
  // text, enabled button, exactly the media this reply chose.
  state = await inspect();
  if (!state.on_post && !state.reply_composer_route) {
    await browser.press("Escape").catch(() => undefined);
    return refuse(`Landed on ${state.url} instead of the post.`, state);
  }
  if (!state.identity.session || !state.identity.matches) {
    await browser.press("Escape").catch(() => undefined);
    return refuse("The signed-in account changed while the reply was being typed.", state);
  }
  if (normalize(state.composer.text) !== normalize(request.replyText)) {
    await browser.press("Escape").catch(() => undefined);
    return refuse(`The composer holds different text: ${state.composer.text.slice(0, 80)}`, state);
  }
  if (!state.submit.present || state.submit.disabled) {
    await browser.press("Escape").catch(() => undefined);
    return refuse("The reply button is missing or disabled.", state);
  }
  if (attached && (!state.media.present || state.media.uploading)) {
    await browser.press("Escape").catch(() => undefined);
    return refuse("The attached GIF did not settle in the composer.", state);
  }
  // Media nobody attached on purpose is media nobody reviewed, so it never goes
  // out: a picker that half-cooperated leaves the composer here.
  if (!attached && state.media.present) {
    await browser.press("Escape").catch(() => undefined);
    return refuse("The composer holds media this reply did not attach.", state);
  }

  // Locate first, dispatch second. A locate that refuses dispatches nothing, so
  // the attempt stays retryable.
  const submit = await browser.evaluate<ClickTarget>(composerSubmitRectScript(), "submit-point");
  if (!submit.found) {
    await browser.press("Escape").catch(() => undefined);
    return refuse(`Could not click the reply button: ${submit.reason}.`, state);
  }

  try {
    await browser.clickAt(submit.x, submit.y);
  } catch (error) {
    // Whether the click reached the page is unknowable here, so it counts as
    // submitted and is never retried automatically.
    return { status: "unverified", reason: error instanceof Error ? error.message : String(error) };
  }

  const verifyAttempts = options.verifyAttempts ?? VERIFY_ATTEMPTS;
  for (let attempt = 0; attempt < verifyAttempts; attempt += 1) {
    await sleep(options.verifyDelayMs ?? VERIFY_DELAY_MS);
    let verified: VerifyState;
    try {
      verified = await browser.evaluate<VerifyState>(verifyScript(request.replyText, request.publisherHandle), "verify");
    } catch {
      continue;
    }
    if (verified.reply_found) return { status: "published", replyUrl: verified.reply_url, gif: attached || undefined };
    // A cleared composer with a disabled button is X's own evidence that it took
    // the reply, even when the new post has not rendered into the thread yet.
    if (!verified.composer_text && verified.submit_disabled) return { status: "published", gif: attached || undefined };
  }
  return { status: "unverified", reason: "The reply was submitted but could not be confirmed on the page." };
}

/** attachGif searches the picker and attaches the first acceptable result,
 *  returning its description. Ported from the Go publisher's attachGIF. */
async function attachGif(
  browser: XBrowser,
  gif: GifOptions,
  context: { sleep: (ms: number) => Promise<void>; waitSeconds: number; note: (note: string) => void },
): Promise<string> {
  const button = await browser.evaluate<ClickTarget>(composerGifRectScript(), "gif-button");
  if (!button.found) throw new Error(`GIF button unavailable: ${button.reason}`);
  await browser.clickAt(button.x, button.y);
  await browser.waitForSelector(GIF_INPUT_SELECTOR, context.waitSeconds);

  const typed = await browser.evaluate<GifInputResult>(gifInputScript(gif.query), "gif-input");
  if (!typed.inserted) throw new Error(typed.reason || "the search box rejected the query");
  await browser.waitForSelector(GIF_RESULT_SELECTOR, context.waitSeconds);

  const pick = await browser.evaluate<GifPick>(gifPickScript(gif.blocklist, GIF_PICK_LIMIT), "gif-pick");
  if (pick.skipped?.length) context.note(`GIF results skipped: ${pick.skipped.join("; ")}`);
  if (!pick.found) throw new Error(`${pick.reason} (${pick.considered} results considered)`);

  await browser.clickAt(pick.x, pick.y);
  await browser.waitForSelector(ATTACHMENTS_SELECTOR, context.waitSeconds);
  await awaitUpload(browser, context.sleep);
  return pick.alt || "(no description)";
}

/** awaitUpload waits for X to finish taking the GIF. */
async function awaitUpload(browser: XBrowser, sleep: (ms: number) => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < UPLOAD_ATTEMPTS; attempt += 1) {
    const media = await browser.evaluate<MediaState>(mediaStateScript(), "media");
    if (media.present && !media.uploading && media.submit_enabled) return;
    await sleep(UPLOAD_DELAY_MS);
  }
  throw new Error("the attachment did not settle");
}
