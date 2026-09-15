// Keep one download in flight and publish progress before the updater performs
// network work (its first download-progress event can arrive much later).
function createAppUpdateDownload({ supported, getStatus, setStatus, check, download, reportError }) {
  let pending;
  return function downloadUpdate() {
    if (pending) return pending;
    pending = Promise.resolve().then(async () => {
      if (!supported()) {
        setStatus("disabled", { message: "App updates are unavailable in this build." });
        return getStatus();
      }
      if (!["available", "downloaded"].includes(getStatus().status)) await check();
      if (getStatus().status === "available") {
        setStatus("downloading", { version: getStatus().version, percent: 0 });
        try { await download(); } catch (error) { reportError(error); }
      }
      return getStatus();
    }).finally(() => { pending = undefined; });
    return pending;
  };
}
module.exports = { createAppUpdateDownload };
