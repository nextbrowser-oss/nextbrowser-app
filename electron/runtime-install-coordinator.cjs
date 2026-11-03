const { installSelectedRuntimeUpdates, classifyRuntimeUpdateFailure } = require("./browser-runtime-updates.cjs");

const names = { clawbrowser: "Clawbrowser", camoufox: "Camoufox", dasbrowser: "DasBrowser" };

// One lock per runtime, not per settings window or entire batch. Adding a new
// browser joins the live batch; repeated requests join the same promise.
function createRuntimeInstallCoordinator({ checkForUpdates, installRuntime, onStatus = () => {} }) {
  const jobs = new Map();
  let revision = 0;
  function snapshot() {
    const items = [...jobs.values()].map((job) => ({ ...job.status, runtime: job.runtime, name: names[job.runtime] }));
    const active = items.filter((item) => item.status === "installing");
    const completed = items.filter((item) => item.status === "ready").map((item) => item.runtime);
    const errors = items.flatMap((item) => item.errors || []);
    const cancelled = items.some((item) => item.status === "cancelled");
    const single = active.length === 1 ? active[0] : undefined;
    return {
      status: active.length ? "installing" : errors.length ? (completed.length ? "partial" : "failed") : cancelled ? "cancelled" : items.length ? "ready" : "idle",
      runtimes: items.map((item) => item.runtime), completed, errors, items,
      total: items.length,
      currentRuntime: single?.runtime, currentName: single?.name,
      currentVersion: single?.currentVersion,
      phase: single?.phase, percent: single?.percent,
      receivedBytes: single?.receivedBytes, totalBytes: single?.totalBytes,
      canCancel: active.some((item) => item.canCancel),
      cancelRequested: !!active.length && active.every((item) => item.cancelRequested),
      progress: items.length ? Math.round((items.length - active.length) / items.length * 100) : 0,
      updatedAt: revision,
      message: active.length ? `${active.length} browser toolset${active.length === 1 ? " is" : "s are"} being prepared.`
        : errors.length ? "Some browser toolsets need attention. Completed installations were kept."
          : cancelled ? "Stopped. Completed installations were kept."
            : "Browser toolsets are ready to use.",
    };
  }
  function publish() {
    revision = Math.max(Date.now(), revision + 1);
    const result = snapshot();
    onStatus(result);
    return result;
  }
  function start(runtime, retry) {
    const controller = new AbortController();
    const job = { runtime, controller, status: { status: "installing", phase: "checking", canCancel: true, message: "Checking download availability…" } };
    jobs.set(runtime, job);
    // Reserve the promise and job synchronously, before the first check awaits.
    job.promise = Promise.resolve().then(async () => {
      try {
        const result = await installSelectedRuntimeUpdates({
          requestedRuntimes: [runtime], retryRuntimes: retry ? [runtime] : [],
          signal: controller.signal, checkForUpdates,
          installRuntime: (update, report) => installRuntime(update, report, controller.signal),
          onStatus: (status) => {
            job.status = { ...status, cancelRequested: controller.signal.aborted };
            publish();
          },
        });
        job.status = { ...result, cancelRequested: false };
      } catch (error) {
        job.status = { status: controller.signal.aborted ? "cancelled" : "failed", canCancel: false,
          errors: controller.signal.aborted ? [] : [{ runtime, name: names[runtime], ...classifyRuntimeUpdateFailure(error) }],
          message: controller.signal.aborted ? "Installation cancelled." : "Could not prepare this browser. Retry when ready." };
      }
      return publish();
    });
    return job;
  }
  return {
    isActive: () => [...jobs.values()].some((job) => job.status.status === "installing"),
    snapshot,
    async install(requested) {
      const runtimes = [...new Set((Array.isArray(requested) ? requested : []).filter((runtime) => Object.hasOwn(names, runtime)))];
      if (!runtimes.length) return snapshot();
      const retry = new Set([...jobs.values()].filter((job) => job.status.status === "failed" || job.status.status === "partial").map((job) => job.runtime));
      if (![...jobs.values()].some((job) => job.status.status === "installing")) jobs.clear();
      const selected = runtimes.map((runtime) => {
        const existing = jobs.get(runtime);
        return existing?.status.status === "installing" ? existing : start(runtime, retry.has(runtime));
      });
      publish();
      await Promise.all(selected.map((job) => job.promise));
      return snapshot();
    },
    cancel(runtime) {
      for (const job of jobs.values()) {
        if ((!runtime || runtime === job.runtime) && job.status.status === "installing") {
          job.controller.abort();
          job.status = { ...job.status, cancelRequested: true, message: job.status.canCancel ? "Cancelling download…" : "Finishing this component before stopping…" };
        }
      }
      return publish();
    },
  };
}

module.exports = { createRuntimeInstallCoordinator };
