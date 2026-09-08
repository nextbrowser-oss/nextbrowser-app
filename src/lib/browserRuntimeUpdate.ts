export type BrowserRuntimeUpdateCandidate<T extends string = string> = {
  runtime: T;
  name: string;
  latestVersion?: string;
};

// The renderer must show progress before the Electron process has finished its
// fresh update check. Relying only on an asynchronous IPC event leaves a silent
// gap after the user confirms an update (and the event can be missed during
// startup).
export function pendingBrowserRuntimeUpdate<T extends string>(
  runtimes: readonly T[],
  candidates: readonly BrowserRuntimeUpdateCandidate<T>[],
) {
  const first = candidates.find((candidate) => candidate.runtime === runtimes[0]);
  return {
    status: "installing" as const,
    runtimes: [...runtimes],
    completed: [] as T[],
    errors: [],
    currentRuntime: first?.runtime ?? runtimes[0],
    currentName: first?.name ?? "browser toolsets",
    currentVersion: first?.latestVersion,
    total: runtimes.length,
    progress: 0,
    message: "Checking the selected browser toolset updates…",
  };
}
