import type { MultiloginProfileSelection } from "./multiloginSelection";

export function clawbrowserTargetKey(profile?: string) {
  return `clawbrowser:${profile || "__default"}`;
}

export function multiloginTargetKey(selection: MultiloginProfileSelection) {
  return `multilogin:${selection.kind}:${selection.id}`;
}

export interface LiveStartTurn {
  /** Resolves once the previous start no longer holds a backend session call. */
  ready: Promise<void>;
  /** Hands the backend to the next start. Safe to call more than once. */
  done: () => void;
}

/**
 * A start replaced by a quick profile switch still owns its backend session
 * until its nextctl call returns and the session is queued for release. Starts
 * take turns so the next one never opens a session next to it, or reuses one
 * the stale start is about to close.
 */
export function createLiveStartTurns(): () => LiveStartTurn {
  let previous: Promise<void> = Promise.resolve();
  return () => {
    const ready = previous;
    let done!: () => void;
    previous = new Promise<void>((resolve) => { done = resolve; });
    return { ready, done };
  };
}
