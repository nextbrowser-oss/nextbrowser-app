// Connects to a running Nextbrowser window over the Chrome DevTools Protocol.
// The app is started outside this suite (see e2e/README.md), so the same run
// works against a packaged release and a dev build.
import { chromium } from "playwright-core";

const MAIN_PAGE = /index\.html|(localhost|127\.0\.0\.1):1421/;

export async function connectApp(cdpURL) {
  const browser = await chromium.connectOverCDP(cdpURL);
  return { browser, page: await mainPage(browser) };
}

export async function mainPage(browser, { timeoutMs = 30_000, except } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = browser.contexts().flatMap((context) => context.pages())
      .find((candidate) => candidate !== except && !candidate.isClosed() && MAIN_PAGE.test(candidate.url()));
    if (page) {
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The Nextbrowser window was not found over CDP.");
}

/**
 * "Refresh page" from the checklist. A user presses Ctrl+R / Cmd+R, which the
 * app turns into a fresh window (createWindow in electron/main.cjs), but
 * Electron's key handler does not see keys sent over CDP. Reloading the page
 * gives the same check: the window's state is read again from disk and the
 * backend.
 */
export async function refreshWindow(browser, page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await appReady(page);
  return page;
}

/**
 * After a start or a reload the app checks the agent connection behind a
 * "Connect an agent to continue" gate; the window is usable once it closes.
 */
export async function appReady(page, timeoutMs = 120_000) {
  await page.getByRole("navigation", { name: "Sidebar pages" }).waitFor({ timeout: timeoutMs });
  const gate = page.getByText("Connect an agent to continue");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const checking = await page.getByText(/^Checking…?$/).first().isVisible().catch(() => false);
    if (!(await gate.first().isVisible().catch(() => false))) return;
    if (!checking) throw new Error("The app asks to connect an agent: no agent is connected");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`The agent check did not finish in ${Math.round(timeoutMs / 1000)} s`);
}
