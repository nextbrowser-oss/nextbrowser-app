import { useCallback, useEffect, useRef } from "react";

/** How long after "Open site" the panel keeps watching for the user's return. */
export const RECHECK_WINDOW_MS = 15 * 60_000;

/** returnWatch decides when a return to the app re-reads the account: only
 *  inside the window `arm` opened, one read at a time, and never again once a
 *  read found the account signed in. A read that did not look (undefined) or
 *  found no sign-in leaves the watch open for the next return. */
export function returnWatch(windowMs = RECHECK_WINDOW_MS, now: () => number = Date.now) {
  // Closed until armed, and closed again by a read that finds the sign-in.
  let until = Number.NEGATIVE_INFINITY;
  let running = false;
  return {
    arm() { until = now() + windowMs; },
    async onReturn(visible: boolean, recheck: () => Promise<boolean | undefined>): Promise<boolean> {
      if (!visible || running || now() > until) return false;
      running = true;
      try {
        if (await recheck()) until = Number.NEGATIVE_INFINITY;
      } catch {
        // A failed read is the same as no answer: the next return tries again.
      } finally {
        running = false;
      }
      return true;
    },
  };
}

/**
 * useRecheckOnReturn re-reads the signed-in account when the user comes back
 * to the app after opening a site to sign in. Signing in happens in the
 * browser profile's own window, so the panel never sees it happen; without
 * this it kept saying "not signed in" until someone pressed Check.
 *
 * The returned `arm` starts the watch; every return to the window (focus or
 * the page becoming visible) then runs `recheck`, as `returnWatch` allows.
 */
export function useRecheckOnReturn(recheck: () => Promise<boolean | undefined>, windowMs = RECHECK_WINDOW_MS): () => void {
  const watch = useRef(returnWatch(windowMs)).current;
  const latest = useRef(recheck);
  latest.current = recheck;

  useEffect(() => {
    const onReturn = () => { void watch.onReturn(document.visibilityState !== "hidden", () => latest.current()); };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [watch]);

  return useCallback(() => watch.arm(), [watch]);
}
