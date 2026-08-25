const path = require("node:path");

const FORMATS = new Set(["json", "csv", "txt"]);
const SOURCES = new Set(["last_result", "run_results"]);

function normalizeArtifactAction(action) {
  const args = action?.arguments || {};
  const format = String(args.format || "json").toLowerCase();
  const source = String(args.source || "last_result");
  if (!FORMATS.has(format)) throw new Error("Artifact format must be JSON, CSV, or text.");
  if (!SOURCES.has(source)) throw new Error("Choose the previous step result or all workflow results for this artifact.");
  const requested = path.basename(String(args.name || `workflow-result.${format}`).trim());
  if (!requested) throw new Error("Give the artifact a file name.");
  const name = requested.toLowerCase().endsWith(`.${format}`) ? requested : `${requested.replace(/\.[^.]+$/, "")}.${format}`;
  return { format, source, name };
}

function usefulValue(value) {
  let current = value;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!current || typeof current !== "object" || Array.isArray(current)) break;
    if (Array.isArray(current.rows)) return current.rows;
    if (Object.prototype.hasOwnProperty.call(current, "result")) current = current.result;
    else if (Object.prototype.hasOwnProperty.call(current, "data")) current = current.data;
    else break;
  }
  return current;
}

function csvCell(value) {
  const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function asCSV(value) {
  const useful = usefulValue(value);
  const input = Array.isArray(useful) ? useful : [useful];
  const rows = input.map((item) => item && typeof item === "object" && !Array.isArray(item) ? item : { value: item });
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  if (!headers.length) return "value\n";
  return `${headers.map(csvCell).join(",")}\n${rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")).join("\n")}${rows.length ? "\n" : ""}`;
}

function serializeArtifact(value, format) {
  if (format === "csv") return { bytes: Buffer.from(asCSV(value)), contentType: "text/csv; charset=utf-8" };
  if (format === "txt") return { bytes: Buffer.from(typeof value === "string" ? value : JSON.stringify(value, null, 2)), contentType: "text/plain; charset=utf-8" };
  return { bytes: Buffer.from(JSON.stringify(value, null, 2)), contentType: "application/json" };
}

async function saveAutomationArtifact({ action, results, workspaceId, runId, store }) {
  if (!workspaceId) throw new Error("Select a workspace before saving an artifact.");
  const spec = normalizeArtifactAction(action);
  const completed = results.filter((result) => result?.ok);
  if (!completed.length) throw new Error("There is no completed workflow result to save yet. Move this step after a data-producing step.");
  const value = spec.source === "run_results"
    ? completed.map(({ index, tool, output }) => ({ step: index + 1, tool, output }))
    : completed.at(-1).output;
  const serialized = serializeArtifact(value, spec.format);
  const artifact = await store.addBytes(workspaceId, spec.name, serialized.bytes, { contentType: serialized.contentType, runId });
  return { saved: true, artifact };
}

module.exports = { asCSV, normalizeArtifactAction, saveAutomationArtifact, serializeArtifact, usefulValue };
