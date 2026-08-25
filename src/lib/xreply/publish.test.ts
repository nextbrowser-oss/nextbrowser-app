import { describe, expect, it, vi } from "vitest";
import { publishReply } from "./publish";
import type { XBrowser } from "./browser";
import type { PageState, VerifyState } from "./scripts";

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
    identity: { present: true, handle: "me", matches: true },
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
  verify?: VerifyState;
  submitPoint?: { found: boolean; x: number; y: number; reason: string };
  replyPoint?: { found: boolean; x: number; y: number; reason: string };
  composerText?: string;
}) {
  const inspects = Array.isArray(responses.inspect) ? [...responses.inspect] : [responses.inspect];
  const calls: string[] = [];
  const browser: XBrowser = {
    open: vi.fn(async () => { calls.push("open"); }),
    waitForLoad: vi.fn(async () => { calls.push("waitForLoad"); }),
    waitForSelector: vi.fn(async () => { calls.push("waitForSelector"); }),
    clickAt: vi.fn(async (x: number, y: number) => { calls.push(`clickAt:${x},${y}`); }),
    inputByTestIdPrefix: vi.fn(async (_prefix: string, text: string) => { calls.push(`input:${text}`); }),
    press: vi.fn(async (key: string) => { calls.push(`press:${key}`); }),
    evaluate: vi.fn(async (script: string) => {
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

const request = { postUrl: POST_URL, replyText: "A concrete note about the post.", publisherHandle: "me" };
const noSleep = { sleep: async () => undefined };

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
      inspect: pageState({ identity: { present: true, handle: "someone_else", matches: false } }),
    });
    const outcome = await publishReply(browser, request, noSleep);
    expect(outcome).toMatchObject({ status: "refused" });
    expect(outcome.status === "refused" && outcome.reason).toContain("someone_else");
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
      inspect: pageState({ login_wall: true, identity: { present: false, handle: "", matches: false } }),
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
