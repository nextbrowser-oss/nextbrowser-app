// Loading one x.com page and making sure it was actually drawn.
//
// The page load event fires long before x.com renders the account chrome or a
// timeline, so a read right after load meets an empty shell. And a tab where
// x.com's app has failed — the "Something went wrong … Try again" screen —
// keeps failing on every reload of the same URL, while a fresh tab loads it at
// once. Both look like a signed-out profile to a script that only checks for
// the chrome, which is how a healthy account came to be asked to sign in.

import type { XBrowser } from "./browser";
import { pageHealthScript, type PageHealth } from "./scripts";

export interface LoadedPage extends PageHealth {
  /** Whether the URL had to be reopened in a fresh tab to render. */
  reopened: boolean;
}

const LOAD_WAIT_SECONDS = 15;
const READY_WAIT_SECONDS = 10;

/** loadPage lands on a URL and waits for x.com to draw it. When nothing
 *  renders, or the page is x.com's own error screen, the URL is reopened in a
 *  fresh tab once. The result says what the page finally showed; a caller that
 *  finds it still unrendered reports a page failure, not a sign-out. */
export async function loadPage(browser: XBrowser, url: string, readySelector: string): Promise<LoadedPage> {
  await browser.open(url);
  const first = await settle(browser, readySelector);
  if (first.rendered || first.login_wall) return { ...first, reopened: false };
  await browser.reopen(url);
  const second = await settle(browser, readySelector);
  return { ...second, reopened: true };
}

async function settle(browser: XBrowser, readySelector: string): Promise<PageHealth> {
  await browser.waitForLoad(LOAD_WAIT_SECONDS).catch(() => undefined);
  await browser.waitForSelector(readySelector, READY_WAIT_SECONDS).catch(() => undefined);
  return browser.evaluate<PageHealth>(pageHealthScript());
}
