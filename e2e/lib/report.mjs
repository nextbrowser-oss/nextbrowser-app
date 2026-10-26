// Writes report.md: one table per checklist section, then every error the
// user saw with the backend report it produced (or the lack of one).
import fs from "node:fs/promises";
import path from "node:path";

const ICON = { pass: "✅ pass", fail: "❌ fail", blocked: "⛔ blocked", skipped: "⏭ skipped" };
const cell = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
const seconds = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

export async function writeReport({ outDir, run, matched, consoleErrors, backend }) {
  const lines = [];
  const all = run.scenarios.flatMap((scenario) => scenario.steps);
  const count = (status) => all.filter((step) => step.status === status).length;
  lines.push(`# Nextbrowser e2e run ${run.runId}`, "");
  lines.push(`Started ${run.startedAt}. Steps: ${count("pass")} passed, ${count("fail")} failed, ${count("blocked")} blocked, ${count("skipped")} skipped.`, "");
  if (backend.available) {
    const missing = matched.filter((error) => !error.report).length;
    lines.push(`Errors the user saw: ${matched.length}; without a backend report: ${missing}. Backend reports during the run: ${backend.reports.length}.`, "");
  } else {
    lines.push(`Backend reports were not checked${backend.error ? `: ${backend.error}` : " (E2E_REPORTS_CMD is not set)"}.`, "");
  }

  for (const scenario of run.scenarios) {
    lines.push(`## ${scenario.title}`, "");
    if (scenario.checklist.length) lines.push(...scenario.checklist.map((item) => `> ${item}`), "");
    lines.push("| Step | Result | Time | Details |", "| --- | --- | --- | --- |");
    for (const step of scenario.steps) {
      const details = [step.error, step.errors.length ? `Errors on screen: ${step.errors.map((error) => error.text).join(" · ")}` : "", step.shot ? `[screenshot](${step.shot})` : ""].filter(Boolean).join("<br>");
      lines.push(`| ${cell(step.title)} | ${ICON[step.status] || step.status} | ${seconds(step.ms)} | ${cell(details)} |`);
    }
    if (scenario.notes.length) lines.push("", ...scenario.notes.map((note) => `- ${note}`));
    lines.push("");
  }

  lines.push("## Errors the user saw", "");
  if (!matched.length) lines.push("None.", "");
  else {
    lines.push("| When | Step | What the user saw | Backend report |", "| --- | --- | --- | --- |");
    for (const error of matched) {
      const report = !backend.available ? "not checked"
        : error.report ? `${error.match === "reference" ? "yes" : "probably (by time)"}: ${error.report.source}/${error.report.kind} ${error.report.name}: ${error.report.message}`
          : "**none**";
      lines.push(`| ${error.at.slice(11, 19)} | ${cell(error.step)} | ${cell(error.text)} | ${cell(report)} |`);
    }
    lines.push("");
  }

  lines.push("## Renderer exceptions and console errors", "");
  if (!consoleErrors.length) lines.push("None.", "");
  else {
    const grouped = new Map();
    for (const error of consoleErrors) {
      const key = `${error.kind}: ${error.text}`;
      const entry = grouped.get(key) || { ...error, n: 0 };
      entry.n += 1;
      grouped.set(key, entry);
    }
    lines.push("| First seen | Step | Kind | Text | Count |", "| --- | --- | --- | --- | --- |");
    for (const error of grouped.values()) lines.push(`| ${error.at.slice(11, 19)} | ${cell(error.step)} | ${error.kind} | ${cell(error.text.slice(0, 400))} | ${error.n} |`);
    lines.push("");
  }

  if (backend.available && backend.reports.length) {
    lines.push("## Reports the backend received", "", "| When | Source/kind | Name | Message | View/action |", "| --- | --- | --- | --- | --- |");
    for (const report of backend.reports) lines.push(`| ${String(report.occurred_at).slice(11, 19)} | ${report.source}/${report.kind} | ${cell(report.name)} | ${cell(String(report.message).slice(0, 300))} | ${cell([report.view, report.action].filter(Boolean).join(" / "))} |`);
    lines.push("");
  }

  const file = path.join(outDir, "report.md");
  await fs.writeFile(file, lines.join("\n"));
  return file;
}
