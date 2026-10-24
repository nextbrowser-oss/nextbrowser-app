#!/usr/bin/env node
// End-to-end run of the release checklist against a running Nextbrowser
// window. See e2e/README.md for how to start the app and what each option does.
//
//   node e2e/run.mjs [--only=workspace,profiles] [--skip=account] [--cdp=http://127.0.0.1:9333] [--out=e2e-out]
import fs from "node:fs/promises";
import path from "node:path";
import { connectApp } from "./lib/app.mjs";
import { fetchBackendReports, matchReports } from "./lib/backend-reports.mjs";
import { ErrorWatch } from "./lib/errors.mjs";
import { writeReport } from "./lib/report.mjs";
import { Run } from "./lib/runner.mjs";
import { scenarios } from "./scenarios/index.mjs";

const flags = Object.fromEntries(process.argv.slice(2).filter((arg) => arg.startsWith("--")).map((arg) => {
  const [key, value] = arg.slice(2).split("=");
  return [key, value ?? "1"];
}));
const list = (value) => (value ? value.split(",").map((item) => item.trim()).filter(Boolean) : []);
const only = list(flags.only);
const skip = list(flags.skip);
const selected = scenarios.filter((scenario) => (!only.length || only.includes(scenario.id)) && !skip.includes(scenario.id));
if (!selected.length) {
  console.error(`No scenario selected. Known: ${scenarios.map((scenario) => scenario.id).join(", ")}`);
  process.exit(2);
}

const runId = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-").slice(4, 13);
const outDir = path.resolve(flags.out || "e2e-out", runId);
await fs.mkdir(path.join(outDir, "shots"), { recursive: true });

const env = {
  cdp: flags.cdp || process.env.E2E_CDP || "http://127.0.0.1:9333",
  agent: process.env.E2E_AGENT || "",
  reportsCmd: process.env.E2E_REPORTS_CMD || "",
  nbcCmd: process.env.E2E_NBC_CMD || "",
  manualProxy: process.env.E2E_MANUAL_PROXY || "",
  manualProxyName: process.env.E2E_MANUAL_PROXY_NAME || "",
  secondAccount: process.env.E2E_SECOND_ACCOUNT || "",
  restartCmd: process.env.E2E_RESTART_CMD || "",
  flushWaitMs: Number(process.env.E2E_FLUSH_WAIT_MS || 45_000),
};

const { browser, page } = await connectApp(env.cdp);
const watch = new ErrorWatch();
const run = new Run({ browser, page, watch, outDir, runId, env });
console.log(`Run ${runId}: ${selected.map((scenario) => scenario.id).join(", ")} → ${outDir}`);

for (const scenario of selected) {
  const started = Date.now();
  const record = await run.scenario(scenario);
  const counts = record.steps.reduce((acc, step) => ({ ...acc, [step.status]: (acc[step.status] || 0) + 1 }), {});
  console.log(`  ${scenario.id}: ${Object.entries(counts).map(([status, n]) => `${n} ${status}`).join(", ")} (${Math.round((Date.now() - started) / 1000)} s)`);
  for (const step of record.steps.filter((item) => item.status === "fail" || item.status === "blocked")) {
    console.log(`    ${step.status.toUpperCase()} ${step.title}: ${step.error.split("\n")[0]}`);
  }
}

// The app sends reports in batches every 30 s; wait for the last batch.
let backend = { available: false, reports: [], error: "" };
if (env.reportsCmd) {
  console.log(`Waiting ${Math.round(env.flushWaitMs / 1000)} s for the app to send its last error reports…`);
  await new Promise((resolve) => setTimeout(resolve, env.flushWaitMs));
  try {
    backend = await fetchBackendReports(env.reportsCmd, run.startedAt);
  } catch (error) {
    backend = { available: false, reports: [], error: String(error?.message || error) };
  }
}
const matched = matchReports(watch.ui, backend.reports);
await run.writeJSON("results.json", { runId, startedAt: run.startedAt, finishedAt: new Date().toISOString(), env: { ...env, secondAccount: env.secondAccount ? "set" : "", manualProxy: env.manualProxy ? "set" : "" }, scenarios: run.scenarios, uiErrors: matched, consoleErrors: watch.console, backend });
const reportPath = await writeReport({ outDir, run, matched, consoleErrors: watch.console, backend });
console.log(`Report: ${reportPath}`);
await browser.close().catch(() => {});
const failed = run.scenarios.some((scenario) => scenario.steps.some((step) => step.status === "fail"));
const unreported = backend.available && matched.some((error) => !error.report);
process.exit(failed || unreported ? 1 : 0);
