import { describe, expect, it, vi } from "vitest";
import { publishReply } from "./publish";
import type { XBrowser } from "./browser";
import type { PageHealth, PageState, VerifyState } from "./scripts";

const POST_URL = "https://x.com/author/status/1899000000000000000";

function pageState(patch: Partial<PageState> = {}): PageState {
  return {
    url: POST_URL,
    on_post: true,
    reply_composer_route: false,
    login_wall: false,
    composer: { present: true, text: "" },
    submit: { present: true, disabled: false },
    media: { present: false, uploading: false },
    identity: { present: true, session: true, handle: "me", matches: true },
    reply_control: true,
    existing_reply_url: "",
    ...patch,
  };
}

function verifyState(patch: Partial<VerifyState> = {}): VerifyState {
  return {
    url: POST_URL,
    composer_present: false,
    composer_text: "",
    submit_disabled: true,
    reply_found: true,
    reply_url: "https://x.com/me/status/1899000000000000001",
    ...patch,
  };
}

/** fakeBrowser answers each script by the marker it contains, so a test states
 *  what the page looks like instead of what the engine asks for. */
function fakeBrowser(responses: {
  inspect: PageState[] | PageState;
  /** What each page load reported, in order; a drawn page when exhausted. */
  health?: PageHealth[];
  verify?: VerifyState;
  submitPoint?: { found: boolean; x: number; y: number; reason: string };
  replyPoint?: { found: boolean; x: number; y: number; reason: string };
  composerText?: string;
}) {
  const inspects = Array.isArray(responses.inspect) ? [...responses.inspect] : [responses.inspect];
  const healths = [...(responses.health ?? [])];
  const calls: string[] = [];
  const browser: XBrowser = {
    open: vi.fn(async () => { calls.push("open"); }),
    reopen: vi.fn(async () => { calls.push("reopen"); }),
    waitForLoad: vi.fn(async () => { calls.push("waitForLoad"); }),
    waitForSelector: vi.fn(async () => { calls.push("waitForSelector"); }),
    clickAt: vi.fn(async (x: number, y: number) => { calls.push(`clickAt:${x},${y}`); }),
    inputByTestIdPrefix: vi.fn(async (_prefix: string, text: string) => { calls.push(`input:${text}`); }),
    press: vi.fn(async (key: string) => { calls.push(`press:${key}`); }),
    evaluate: vi.fn(async (script: string) => {
      if (script.includes("error_screen")) {
        calls.push("health");
        return (healths.shift() ?? drawn()) as never;
      }
      if (script.includes("existing_reply_url")) {
        calls.push("inspect");
        return (inspects.length > 1 ? inspects.shift() : inspects[0]) as never;
      }
      if (script.includes("reply_found")) { calls.push("verify"); return (responses.verify ?? verifyState()) as never; }
      if (script.includes("focusedReplyControl")) {
        calls.push("replyPoint");
        return (responses.replyPoint ?? { found: true, x: 10, y: 20, reason: "" }) as never;
      }
      calls.push("submitPoint");
      return (responses.submitPoint ?? { found: true, x: 30, y: 40, reason: "" }) as never;
    }),
  };
  return { browser, calls };
}

const drawn = (): PageHealth => ({ url: POST_URL, rendered: true, error_screen: false, login_wall: false });
const errorScreen = (): PageHealth => ({ url: POST_URL, rendered: false, error_screen: true, login_wall: false });

const request = { postUrl: POST_URL, replyText: "A concrete note about the post.", publisherHandle: "me" };
const noSleep = { sleep: async () => undefined };

describe("a post page x.com did not draw", () => {
  it("reopens the post in a fresh tab when the first load is the error screen", async () => {
    const { browser, calls } = fakeBrowser({
      inspect: [pageState(), pageState({ composer: { present: true, text: request.replyText } })],
      health: [errorScreen(), drawn()],
    });
    const outcome = await publishReply(browser, request, noSleep);
    expect(outcome.status).toBe("published");
    expect(calls.filter((call) => call === "reopen")).toHaveLength(1);
  });

  it("refuses a page that never renders without calling it a sign-out", async () => {
    const { browser, calls } = fakeBrowser({ inspect: pageState(), health: [errorScreen(), errorScreen()] });
    const outcome = await publishReply(browser, request, noSleep);
    expect(outcome).toMatchObject({ status: "refused" });
    const reason = outcome.status === "refused" ? outcome.reason : "";
    expect(reason).toContain("did not render the post page");
    expect(reason).not.toContain("not signed in");
    expect(calls.filter((call) => call === "reopen")).toHaveLength(1);
    expect(calls.some((call) => call.startsWith("clickAt") || call.startsWith("input:"))).toBe(false);
  });
});

describe("publishing one reply", () => {
  it("types the draft and clicks the reply button exactly once", async () => {
    const { browser, calls } = fakeBrowser({
      inspect: [pageState(), pageState({ composer: { present: true, text: request.replyText } })],
    });
    const outcome = await publishReply(browser, request, noSleep);
    expect(outcome).toEqual({ status: "published", replyUrl: "https://x.com/me/status/1899000000000000001" });
    expect(calls.filter((call) => call.startsWith("clickAt"))).toEqual(["clickAt:30,40"]);
    expect(calls).toContain(`input:${request.replyText}`);
  });

  it("refuses when the profile is signed in as another account", async () => {
    const { browser, calls } = fakeBrowser({
      inspect: pageState({ identity: { present: true, session: true, handle: "someone_else", matches: false } }),
    });
    const outcome = await publishReply(browser, request, noSleep);
    expect(outcome).toMatchObject({ status: "refused" });
    expect(outcome.status === "refused" && outcome.reason).toContain("someone_else");
    expect(calls.some((call) => call.startsWith("clickAt"))).toBe(false);
  });

  it("refuses when the page never named the signed-in account", async () => {
    // A session the page did not name is not a licence to guess: a reply from
    // the wrong account cannot be taken back.
    const { browser, calls } = fakeBrowser({
      inspect: pageState({ identity: { present: true, session: true, handle: "", matches: false } }),
    });
    const outcome = await publishReply(browser, request, noSleep);
    expect(outcome).toMatchObject({ status: "refused" });
    expect(outcome.status === "refused" && outcome.reason).toContain("did not say which account");
    expect(calls.some((call) => call.startsWith("clickAt"))).toBe(false);
  });

  it("adopts a reply that is already under the post instead of sending it twice", async () => {
    const { browser, calls } = fakeBrowser({
      inspect: pageState({ existing_reply_url: "https://x.com/me/status/42" }),
    });
    const outcome = await publishReply(browser, request, noSleep);
    expect(outcome).toEqual({ status: "already-published", replyUrl: "https://x.com/me/status/42" });
    expect(calls.some((call) => call.startsWith("input"))).toBe(false);
  });

  it("never types into a composer that already holds a draft", async () => {
    const { browser, calls } = fakeBrowser({ inspect: pageState({ composer: { present: true, text: "half-written" } }) });
    const outcome = await publishReply(browser, request, noSleep);
    expect(outcome).toMatchObject({ status: "refused" });
    expect(calls.some((call) => call.startsWith("input"))).toBe(false);
    expect(calls).toContain("press:Escape");
  });

  it("refuses when the composer holds text other than the approved reply", async () => {
    const { browser, calls } = fakeBrowser({
      inspect: [pageState(), pageState({ composer: { present: true, text: "something else entirely" } })],
    });
    const outcome = await publishReply(browser, request, noSleep);
    expect(outcome).toMatchObject({ status: "refused" });
    expect(calls.some((call) => call.startsWith("clickAt:30"))).toBe(false);
  });

  it("refuses when media nobody attached is in the composer", async () => {
    const { browser } = fakeBrowser({
      inspect: [
        pageState(),
        pageState({ composer: { present: true, text: request.replyText }, media: { present: true, uploading: false } }),
      ],
    });
    await expect(publishReply(browser, request, noSleep)).resolves.toMatchObject({ status: "refused" });
  });

  it("refuses when the reply button is disabled", async () => {
    const { browser } = fakeBrowser({
      inspect: [
        pageState(),
        pageState({ composer: { present: true, text: request.replyText }, submit: { present: true, disabled: true } }),
      ],
    });
    await expect(publishReply(browser, request, noSleep)).resolves.toMatchObject({ status: "refused" });
  });

  it("reports an unconfirmed submit instead of clicking again", async () => {
    const { browser, calls } = fakeBrowser({
      inspect: [pageState(), pageState({ composer: { present: true, text: request.replyText } })],
      verify: verifyState({ reply_found: false, composer_present: true, composer_text: request.replyText, submit_disabled: false }),
    });
    const outcome = await publishReply(browser, request, noSleep);
    expect(outcome).toMatchObject({ status: "unverified" });
    expect(calls.filter((call) => call === "clickAt:30,40")).toHaveLength(1);
  });

  it("treats a cleared, disabled composer as evidence the reply went out", async () => {
    const { browser } = fakeBrowser({
      inspect: [pageState(), pageState({ composer: { present: true, text: request.replyText } })],
      verify: verifyState({ reply_found: false, reply_url: "", composer_text: "", submit_disabled: true }),
    });
    await expect(publishReply(browser, request, noSleep)).resolves.toEqual({ status: "published", replyUrl: undefined });
  });

  it("stops at a sign-in wall", async () => {
    const { browser } = fakeBrowser({
      inspect: pageState({ login_wall: true, identity: { present: false, session: false, handle: "", matches: false } }),
    });
    await expect(publishReply(browser, request, noSleep)).resolves.toMatchObject({
      status: "refused",
      reason: "The browser profile is not signed in to x.com.",
    });
  });

  it("refuses a source URL without a post id", async () => {
    const { browser } = fakeBrowser({ inspect: pageState() });
    await expect(publishReply(browser, { ...request, postUrl: "https://x.com/author" }, noSleep))
      .resolves.toMatchObject({ status: "refused" });
  });
});

describe("the account chrome on the post page", () => {
  const noChrome = (): PageState => pageState({ identity: { present: false, session: false, handle: "", matches: false } });

  it("waits for the chrome when the post drew first, then publishes", async () => {
    // x.com draws the post and the account chrome from separate requests, and
    // the landing waits for the post only. Reading the chrome the moment the
    // post appeared called a signed-in profile signed out.
    const { browser, calls } = fakeBrowser({
      inspect: [noChrome(), pageState(), pageState({ composer: { present: true, text: request.replyText } })],
    });
    const outcome = await publishReply(browser, request, noSleep);
    expect(outcome.status).toBe("published");
    expect(browser.waitForSelector).toHaveBeenCalledWith(expect.stringContaining("SideNav_AccountSwitcher_Button"), expect.any(Number));
    expect(calls.filter((call) => call === "inspect").length).toBeGreaterThanOrEqual(3);
  });

  it("refuses a page that never drew the chrome without calling it a sign-out", async () => {
    const { browser, calls } = fakeBrowser({ inspect: noChrome() });
    const outcome = await publishReply(browser, request, noSleep);
    expect(outcome).toMatchObject({ status: "refused" });
    const reason = outcome.status === "refused" ? outcome.reason : "";
    expect(reason).toContain("without the account chrome");
    expect(reason).not.toContain("not signed in");
    expect(calls.some((call) => call.startsWith("clickAt") || call.startsWith("input:"))).toBe(false);
  });

  it("reports the sign-in wall as not signed in", async () => {
    const { browser } = fakeBrowser({
      inspect: pageState({ login_wall: true, identity: { present: false, session: false, handle: "", matches: false } }),
    });
    const outcome = await publishReply(browser, request, noSleep);
    expect(outcome).toEqual({ status: "refused", reason: "The browser profile is not signed in to x.com." });
  });

  it("says what the page was when it refuses", async () => {
    // The note is what a screenshot of the panel carries, so it names the
    // viewport, the tab's state and what x.com had drawn.
    const diag = {
      width: 1280, height: 670, ready: "complete", visible: "visible", focus: false, title: "Post",
      anchors: [], login_markers: [], posts: 1, composer: true, error_text: false,
    };
    const { browser } = fakeBrowser({ inspect: { ...noChrome(), diag } });
    const outcome = await publishReply(browser, request, noSleep);
    const reason = outcome.status === "refused" ? outcome.reason : "";
    expect(reason).toContain("1280×670");
    expect(reason).toContain("no account chrome");
  });
});
