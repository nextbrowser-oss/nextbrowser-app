// The browser surface the X reply engine needs, ported from the Go service's
// internal/clawbrowser client. Every call goes through the nextctl/nbc CLI with
// an explicit profile, so the engine always drives the one profile the app
// prepared and never a stray session.

import { nextctlJson, nextctlRun, nextctlErrorMessage } from "../../nextctl";

export interface XBrowser {
  /** Navigate the active tab. */
  open(url: string): Promise<void>;
  /** Evaluate one expression and return its value. */
  evaluate<T>(script: string): Promise<T>;
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
}

interface BrowserState {
  elements?: { id: number; role?: string; test_id?: string; topmost?: boolean }[];
}

/** cliBrowser binds the CLI to one prepared profile. profileArgs comes from the
 *  app's session preflight, so the engine cannot pick a different profile. */
export function cliBrowser(profileArgs: string[]): XBrowser {
  const args = (...rest: string[]) => [...profileArgs, ...rest];
  return {
    async open(url) {
      await nextctlJson<unknown>(args("open", url));
    },
    async evaluate<T>(script: string) {
      const data = await nextctlJson<{ result?: T }>(args("eval", script));
      if (data?.result === undefined) throw new Error("The page returned no value.");
      return data.result;
    },
    async waitForLoad(timeoutSeconds = 15) {
      await nextctlJson<unknown>(args("wait", "--load", "--timeout", `${timeoutSeconds}s`));
    },
    async waitForSelector(selector, timeoutSeconds = 15) {
      await nextctlJson<unknown>(args("wait", "--selector", selector, "--timeout", `${timeoutSeconds}s`));
    },
    async clickAt(x, y) {
      await nextctlJson<unknown>(args("click-xy", x.toFixed(2), y.toFixed(2)));
    },
    async inputByTestIdPrefix(prefix, text) {
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
    },
    async press(key) {
      await nextctlJson<unknown>(args("press", key));
    },
  };
}
