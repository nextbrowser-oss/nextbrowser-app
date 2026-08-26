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
  type PageState,
  type VerifyState,
} from "./scripts";
import { postIdFromUrl } from "./posts";

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
const GIF_PICK_LIMIT = 8;
/** The preview appears before the upload behind it completes, and the reply
 *  button stays disabled until it does. */
const UPLOAD_ATTEMPTS = 10;
const UPLOAD_DELAY_MS = 1000;

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/** publishReply drives the browser sequence for one reply. */
export async function publishReply(
  browser: XBrowser,
  request: PublishRequest,
  options: PublishOptions = {},
): Promise<PublishOutcome> {
  const sleep = options.sleep ?? wait;
  const waitSeconds = options.waitTimeoutSeconds ?? WAIT_TIMEOUT_SECONDS;
  const note = options.onNote ?? (() => undefined);
  const postId = postIdFromUrl(request.postUrl);
  if (!postId) return { status: "refused", reason: "The source URL carries no post id." };
  if (!request.publisherHandle) return { status: "refused", reason: "No publishing account is configured." };

  const inspect = () =>
    browser.evaluate<PageState>(inspectScript(postId, request.replyText, request.publisherHandle));

  await browser.open(request.postUrl);
  await browser.waitForLoad(15).catch(() => undefined);
  let state = await inspect();

  if (state.login_wall || !state.identity.session) {
    return { status: "refused", reason: "The browser profile is not signed in to x.com." };
  }
  if (!state.on_post) return { status: "refused", reason: `Landed on ${state.url} instead of the post.` };
  // A reply from the wrong account cannot be taken back, so an account the page
  // did not name is refused exactly like an account that does not match.
  if (!state.identity.handle) {
    return { status: "refused", reason: "x.com did not say which account is signed in, so the reply was not sent." };
  }
  if (!state.identity.matches) {
    return {
      status: "refused",
      reason: `Signed in as @${state.identity.handle}, expected @${request.publisherHandle}.`,
    };
  }
  // A reply with this exact text already under this post is this reply. Sending
  // it again would double-post, so the existing one is adopted instead.
  if (state.existing_reply_url) return { status: "already-published", replyUrl: state.existing_reply_url };

  if (!state.composer.present) {
    if (!state.reply_control) return { status: "refused", reason: "No reply composer on the post page." };
    const control = await browser.evaluate<ClickTarget>(focusedReplyRectScript(postId));
    if (!control.found) return { status: "refused", reason: `Could not open the composer: ${control.reason}.` };
    await browser.clickAt(control.x, control.y);
    try {
      await browser.waitForSelector(COMPOSER_SELECTOR, 10);
    } catch {
      return { status: "refused", reason: "The reply composer did not open." };
    }
    state = await inspect();
    if (!state.composer.present) return { status: "refused", reason: "The reply composer did not open." };
  }
  if (state.composer.text) {
    await browser.press("Escape").catch(() => undefined);
    return { status: "refused", reason: `The composer already holds a draft: ${state.composer.text.slice(0, 80)}` };
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
        return { status: "refused", reason: `The GIF could not be attached: ${reason}` };
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
    return { status: "refused", reason: `Landed on ${state.url} instead of the post.` };
  }
  if (!state.identity.session || !state.identity.matches) {
    await browser.press("Escape").catch(() => undefined);
    return { status: "refused", reason: "The signed-in account changed while the reply was being typed." };
  }
  if (normalize(state.composer.text) !== normalize(request.replyText)) {
    await browser.press("Escape").catch(() => undefined);
    return { status: "refused", reason: `The composer holds different text: ${state.composer.text.slice(0, 80)}` };
  }
  if (!state.submit.present || state.submit.disabled) {
    await browser.press("Escape").catch(() => undefined);
    return { status: "refused", reason: "The reply button is missing or disabled." };
  }
  if (attached && (!state.media.present || state.media.uploading)) {
    await browser.press("Escape").catch(() => undefined);
    return { status: "refused", reason: "The attached GIF did not settle in the composer." };
  }
  // Media nobody attached on purpose is media nobody reviewed, so it never goes
  // out: a picker that half-cooperated leaves the composer here.
  if (!attached && state.media.present) {
    await browser.press("Escape").catch(() => undefined);
    return { status: "refused", reason: "The composer holds media this reply did not attach." };
  }

  // Locate first, dispatch second. A locate that refuses dispatches nothing, so
  // the attempt stays retryable.
  const submit = await browser.evaluate<ClickTarget>(composerSubmitRectScript());
  if (!submit.found) {
    await browser.press("Escape").catch(() => undefined);
    return { status: "refused", reason: `Could not click the reply button: ${submit.reason}.` };
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
      verified = await browser.evaluate<VerifyState>(verifyScript(request.replyText, request.publisherHandle));
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
  const button = await browser.evaluate<ClickTarget>(composerGifRectScript());
  if (!button.found) throw new Error(`GIF button unavailable: ${button.reason}`);
  await browser.clickAt(button.x, button.y);
  await browser.waitForSelector(GIF_INPUT_SELECTOR, context.waitSeconds);

  const typed = await browser.evaluate<GifInputResult>(gifInputScript(gif.query));
  if (!typed.inserted) throw new Error(typed.reason || "the search box rejected the query");
  await browser.waitForSelector(GIF_RESULT_SELECTOR, context.waitSeconds);

  const pick = await browser.evaluate<GifPick>(gifPickScript(gif.blocklist, GIF_PICK_LIMIT));
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
    const media = await browser.evaluate<MediaState>(mediaStateScript());
    if (media.present && !media.uploading && media.submit_enabled) return;
    await sleep(UPLOAD_DELAY_MS);
  }
  throw new Error("the attachment did not settle");
}
