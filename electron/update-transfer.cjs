const fs = require("node:fs");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

// Report bytes only when the server supplies a usable content length. A
// missing length is an indeterminate download, not an invented percentage.
async function downloadUpdateFile({ fetchImpl, url, target, signal, onProgress = () => {} }) {
  const response = await fetchImpl(url, {
    headers: { "User-Agent": "Nextbrowser-runtime-updater" },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60 * 60 * 1000)]) : AbortSignal.timeout(60 * 60 * 1000),
  });
  if (!response.ok || !response.body) throw new Error(`Update download failed (${response.status}).`);
  const length = Number(response.headers.get("content-length"));
  // Compressed HTTP bodies can have a different length after decoding.
  const total = !response.headers.get("content-encoding") && length > 0 ? length : undefined;
  let received = 0;
  let lastPercent = -1;
  let lastReport = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      const percent = total ? Math.min(100, Math.floor(received / total * 100)) : undefined;
      if ((percent !== undefined && percent !== lastPercent) || Date.now() - lastReport >= 250) {
        lastPercent = percent;
        lastReport = Date.now();
        onProgress({ percent, receivedBytes: received, totalBytes: total });
      }
      callback(null, chunk);
    },
  });
  onProgress({ percent: total ? 0 : undefined, receivedBytes: 0, totalBytes: total });
  await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(target, { mode: 0o600 }), { signal });
}

module.exports = { downloadUpdateFile };
