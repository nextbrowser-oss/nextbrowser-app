const path = require("node:path");

const FORMATS = new Set(["json", "csv", "txt"]);
const SOURCES = new Set(["last_result", "data_results", "run_results"]);
const DATA_TOOLS = new Set(["evaluate", "extract", "paginate_extract", "tabs_extract"]);

function normalizeArtifactAction(action) {
  const args = action?.arguments || {};
  const format = String(args.format || "json").toLowerCase();
  const source = String(args.source || "last_result");
  if (!FORMATS.has(format)) throw new Error("Artifact format must be JSON, CSV, or text.");
  if (!SOURCES.has(source)) throw new Error("Choose the previous step result, collected data, or all workflow results for this artifact.");
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

function normalizedJSONContent(content, format = "json") {
  if (String(format).toLowerCase() !== "json" || typeof content !== "string") return content;
  try { return JSON.parse(content.trim()); }
  catch { return content; }
}

function meaningfulContractValue(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "object" && Object.keys(value).length > 0;
}

function validHTTPURL(value) {
  if (typeof value !== "string") return false;
  try { return ["http:", "https:"].includes(new URL(value).protocol); }
  catch { return false; }
}

function buildArtifactDataContract(content, format = "json") {
  if (String(format).toLowerCase() !== "json") return undefined;
  const rows = usefulValue(normalizedJSONContent(content, format));
  if (!Array.isArray(rows) || !rows.length || !rows.every((row) => row && typeof row === "object" && !Array.isArray(row))) return undefined;
  const commonFields = Object.keys(rows[0]).filter((field) => rows.every((row) => meaningfulContractValue(row[field])));
  if (!commonFields.length) return undefined;
  const fields = Object.fromEntries(commonFields.map((field) => [field,
    rows.every((row) => validHTTPURL(row[field])) ? "url"
      : rows.every((row) => typeof row[field] === "number" && Number.isFinite(row[field])) ? "number"
        : "non_empty",
  ]));
  return { kind: "rows", min_rows: rows.length, fields };
}

function assertArtifactDataContract(value, contract) {
  if (!contract || contract.kind !== "rows") return;
  const rows = usefulValue(value);
  if (!Array.isArray(rows) || rows.length < Number(contract.min_rows || 1)) {
    throw new Error(`The replayed dataset must contain at least ${Number(contract.min_rows || 1)} rows before it can be saved.`);
  }
  for (const [field, rule] of Object.entries(contract.fields || {})) {
    if (!rows.every((row) => row && meaningfulContractValue(row[field]))) {
      throw new Error(`The replayed dataset is missing a populated “${field}” field.`);
    }
    if (rule === "url" && !rows.every((row) => validHTTPURL(row[field]))) {
      throw new Error(`The replayed “${field}” field must contain a valid HTTP or HTTPS URL in every row.`);
    }
    if (rule === "number" && !rows.every((row) => typeof row[field] === "number" && Number.isFinite(row[field]))) {
      throw new Error(`The replayed “${field}” field must contain a number in every row.`);
    }
  }
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
    : spec.source === "data_results"
      ? completed.filter(({ tool }) => DATA_TOOLS.has(tool)).map(({ output }) => usefulValue(output))
      : completed.at(-1).output;
  const serialized = serializeArtifact(value, spec.format);
  const artifact = await store.addBytes(workspaceId, spec.name, serialized.bytes, { contentType: serialized.contentType, runId });
  return { saved: true, artifact };
}

module.exports = { asCSV, assertArtifactDataContract, buildArtifactDataContract, normalizeArtifactAction, saveAutomationArtifact, serializeArtifact, usefulValue };
