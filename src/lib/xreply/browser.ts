// The browser surface the X reply engine needs, ported from the Go service's
// internal/clawbrowser client. Every call goes through the nextctl/nbc CLI with
// an explicit profile, so the engine always drives the one profile the app
// prepared and never a stray session.

import { nextctlJson, nextctlRun, nextctlErrorMessage } from "../../nextctl";
import type { TabsList } from "../../types";
import { compact, errorText, xlog } from "./log";

export interface XBrowser {
  /** Navigate the active tab. */
  open(url: string): Promise<void>;
  /** Evaluate one expression and return its value. The label names the read
   *  in the log, where the script itself would be pages long. */
  evaluate<T>(script: string, label?: string): Promise<T>;
  /** Wait until the active page finishes loading. */
  waitForLoad(timeoutSeconds?: number): Promise<void>;
  /** Wait until a visible element matches the selector. */
  waitForSelector(selector: string, timeoutSeconds?: number): Promise<void>;
  /** Dispatch a real mouse click at viewport coordinates. React surfaces such
   *  as the X composer accept this where a synthetic element click may not. */
  clickAt(x: number, y: number): Promise<void>;
  /** Type into the single textbox whose test id starts with the prefix. */
  inputByTestIdPrefix(prefix: string, text: string): Promise<void>;
  /** Send one key event, which is how a modal left open is closed again. */
  press(key: string): Promise<void>;
  /** Load the URL in a fresh tab and close the tabs this site was in. A tab
   *  where x.com's app has failed keeps failing on every reload of the same
   *  URL; a new tab loads it at once. */
  reopen(url: string): Promise<void>;
}

function hostOf(url?: string): string {
  try {
    return new URL(url ?? "").hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

interface BrowserState {
  elements?: { id: number; role?: string; test_id?: string; topmost?: boolean }[];
}

/** cliBrowser binds the CLI to one prepared profile. profileArgs comes from the
 *  app's session preflight, so the engine cannot pick a different profile. */
export function cliBrowser(profileArgs: string[]): XBrowser {
  const args = (...rest: string[]) => [...profileArgs, ...rest];
  // Every CLI call goes into the log with what it was, how long it took and
  // how it ended. The CLI picks "the current page" afresh on each call, so
  // when a pass reads the wrong tab the log is the only place that shows it.
  const timed = async <T>(
    what: string,
    detail: Record<string, unknown>,
    run: () => Promise<T>,
    summarize?: (value: T) => unknown,
  ): Promise<T> => {
    const startedAt = Date.now();
    try {
      const value = await run();
      xlog("cli", { what, ...detail, ms: Date.now() - startedAt, ...(summarize ? { result: compact(summarize(value)) } : {}) });
      return value;
    } catch (error) {
      xlog("cli", { what, ...detail, ms: Date.now() - startedAt, error: errorText(error) });
      throw error;
    }
  };
  return {
    async open(url) {
      await timed("open", { url }, () => nextctlJson<unknown>(args("open", url)));
    },
    async evaluate<T>(script: string, label = "eval") {
      return timed(`eval:${label}`, {}, async () => {
        const data = await nextctlJson<{ result?: T }>(args("eval", script));
        if (data?.result === undefined) throw new Error("The page returned no value.");
        return data.result;
      }, (value) => value);
    },
    async waitForLoad(timeoutSeconds = 15) {
      await timed("wait:load", { timeout: timeoutSeconds }, () =>
        nextctlJson<unknown>(args("wait", "--load", "--timeout", `${timeoutSeconds}s`)));
    },
    async waitForSelector(selector, timeoutSeconds = 15) {
      await timed("wait:selector", { selector, timeout: timeoutSeconds }, () =>
        nextctlJson<unknown>(args("wait", "--selector", selector, "--timeout", `${timeoutSeconds}s`)));
    },
    async clickAt(x, y) {
      await timed("click", { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) }, () =>
        nextctlJson<unknown>(args("click-xy", x.toFixed(2), y.toFixed(2))));
    },
    async inputByTestIdPrefix(prefix, text) {
      await timed("input", { prefix, chars: text.length }, async () => {
        const state = await nextctlJson<BrowserState>(args("state"));
        const textboxes = (state.elements ?? []).filter(
          (element) => element.role === "textbox" && (element.test_id ?? "").startsWith(prefix),
        );
        // Two composers can be on the page at once — the inline one and the one in
        // a dialog. The topmost is the one the user would type into; anything
        // still ambiguous is refused rather than guessed.
        const topmost = textboxes.filter((element) => element.topmost);
        const candidates = topmost.length === 1 ? topmost : textboxes;
        if (candidates.length !== 1) {
          throw new Error(`Could not resolve the composer: found ${candidates.length} matching text boxes.`);
        }
        const result = await nextctlRun([...args("input", String(candidates[0].id), text), "--format", "json"]);
        if (result.code !== 0) throw new Error(nextctlErrorMessage(result));
        return { textboxes: textboxes.length, element: candidates[0].id };
      }, (value) => value);
    },
    async press(key) {
      await timed("press", { key }, () => nextctlJson<unknown>(args("press", key)));
    },
    async reopen(url) {
      await timed("reopen", { url }, async () => {
        const host = hostOf(url);
        const before = await nextctlJson<TabsList>(args("tabs", "list")).catch(() => ({ tabs: [] }) as TabsList);
        const stale = (before.tabs ?? []).filter((tab) => hostOf(tab.url) === host).map((tab) => tab.id);
        const opened = await nextctlJson<{ tab?: { id?: string } }>(args("open", url, "--force-new-tab"));
        const id = opened.tab?.id;
        if (!id) throw new Error("Could not open a fresh tab: nextctl returned no tab.");
        await nextctlJson<unknown>(args("tabs", "activate", id));
        // The old tabs go only once the new one is up, so the site is never left
        // without a page — and never with the failed one as the current page.
        for (const tabId of stale) {
          if (tabId !== id) await nextctlJson<unknown>(args("tabs", "close", tabId)).catch(() => undefined);
        }
        return { tab: id, closed: stale.filter((tabId) => tabId !== id).length, tabs: (before.tabs ?? []).length };
      }, (value) => value);
    },
  };
}
