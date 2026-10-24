// Error reports the backend received during the run. The backend logs each
// report as one JSON line with "event":"client_error" (see
// nextbrowser-backend internal/service/client_errors.go). How to read that log
// depends on where the backend runs, so the command comes from
// E2E_REPORTS_CMD; it gets the run's start time (RFC 3339) as its argument and
// prints log lines. e2e/reports-kubectl.sh reads the production backend.
import { execFile } from "node:child_process";

export async function fetchBackendReports(command, since) {
  if (!command) return { available: false, reports: [] };
  const output = await new Promise((resolve, reject) => {
    execFile("bash", ["-c", `${command} "$1"`, "reports", since], { maxBuffer: 64 * 1024 * 1024, timeout: 120_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${command}: ${stderr.trim() || error.message}`));
      else resolve(stdout);
    });
  });
  const reports = [];
  for (const line of output.split("\n")) {
    if (!line.includes('"client_error"')) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.event !== "client_error") continue;
      if (Date.parse(entry.occurred_at || entry.time) < Date.parse(since)) continue;
      reports.push({
        occurred_at: entry.occurred_at,
        received_at: entry.time,
        source: entry.source,
        kind: entry.kind,
        name: entry.error_name,
        message: entry.error_message,
        client_version: entry.client_version,
        platform: entry.platform,
        view: entry.view,
        action: entry.action,
        count: entry.count,
      });
    } catch { /* not a JSON log line */ }
  }
  return { available: true, reports };
}

// The "Ref: NB-…" a user sees is this hash of the error code (errorReference
// in src/lib/userFacingError.ts), so a report named with that code matches it
// exactly.
export function errorReference(code) {
  let hash = 2166136261;
  for (const char of code || "INTERNAL_ERROR") {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `NB-${(hash >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

/**
 * Pairs every error the user saw with a report the backend got: first by the
 * reference shown on screen, then by time (a weaker match, marked as such).
 * An error on screen without a report is what this suite exists to find.
 */
export function matchReports(uiErrors, reports, { beforeMs = 120_000, afterMs = 15 * 60_000 } = {}) {
  const used = new Set();
  const near = (error, report) => {
    const at = Date.parse(error.at);
    const reportAt = Date.parse(report.occurred_at);
    return reportAt >= at - beforeMs && reportAt <= at + afterMs;
  };
  const take = (error, test) => {
    const index = reports.findIndex((report, i) => !used.has(i) && near(error, report) && test(report));
    if (index >= 0) used.add(index);
    return index >= 0 ? reports[index] : null;
  };
  const byRef = uiErrors.map((error) => (error.ref ? take(error, (report) => errorReference(report.name) === error.ref) : null));
  return uiErrors.map((error, i) => {
    if (byRef[i]) return { ...error, report: byRef[i], match: "reference" };
    const report = take(error, () => true);
    return { ...error, report, match: report ? "time" : "none" };
  });
}
