// Observe Camoufox's download callback without replacing its release selection,
// checksum checks, extraction, or activation. Older packages keep working with
// indeterminate progress if they do not expose the callback.
const CAMOUFOX_FETCH_PROGRESS_SCRIPT = String.raw`
import inspect, json, runpy, sys, time
import camoufox.pkgman as pkgman
original = pkgman.webdl
def emit(**data):
    print("NBC_CAMOUFOX_PROGRESS " + json.dumps(data), file=sys.stderr, flush=True)
def observed(*args, **kwargs):
    emit(phase="downloading", receivedBytes=0)
    if "progress_callback" in inspect.signature(original).parameters:
        previous = kwargs.get("progress_callback")
        last = [0.0]
        def progress(received, total):
            now = time.monotonic()
            if now - last[0] >= 0.2 or received == total:
                emit(phase="downloading", receivedBytes=received, totalBytes=total)
                last[0] = now
            if previous:
                previous(received, total)
        kwargs["progress_callback"] = progress
    result = original(*args, **kwargs)
    emit(phase="installing")
    return result
pkgman.webdl = observed
sys.argv = ["camoufox", "fetch"]
runpy.run_module("camoufox", run_name="__main__")
`;

function camoufoxProgressReader(onProgress) {
  let pending = "";
  return (chunk) => {
    const lines = (pending + String(chunk)).split(/\r?\n/);
    pending = lines.pop().slice(-8192);
    for (const line of lines) {
      if (line.length > 8192 || !line.startsWith("NBC_CAMOUFOX_PROGRESS ")) continue;
      let data;
      try { data = JSON.parse(line.slice(21)); } catch { continue; }
      if (!data || (data.phase !== "downloading" && data.phase !== "installing")) continue;
      const receivedBytes = Number.isSafeInteger(data.receivedBytes) && data.receivedBytes >= 0 ? data.receivedBytes : undefined;
      const totalBytes = Number.isSafeInteger(data.totalBytes) && data.totalBytes > 0 ? data.totalBytes : undefined;
      onProgress({ phase: data.phase, canCancel: false,
        receivedBytes, totalBytes,
        percent: data.phase === "downloading" && receivedBytes !== undefined && totalBytes ? Math.min(100, Math.floor(receivedBytes / totalBytes * 100)) : undefined,
        message: data.phase === "downloading" ? "Downloading Camoufox browser data…" : "Installing and verifying Camoufox browser data…",
      });
    }
  };
}

function stripCamoufoxProgress(output) {
  return String(output || "").split(/\r?\n/).filter((line) => !line.startsWith("NBC_CAMOUFOX_PROGRESS ")).join("\n");
}

module.exports = { CAMOUFOX_FETCH_PROGRESS_SCRIPT, camoufoxProgressReader, stripCamoufoxProgress };
