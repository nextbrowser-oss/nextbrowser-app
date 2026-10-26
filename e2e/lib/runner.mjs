// Runs scenarios step by step and records what happened: a status per step
// (pass, fail, blocked, skipped), timings, screenshots and the errors seen
// while the step ran. A step that fails ends its scenario, because later
// steps of a user journey depend on it; cleanups still run.
import fs from "node:fs/promises";
import path from "node:path";
import { refreshWindow } from "./app.mjs";
import { Blocked } from "./blocked.mjs";
import { resetUi } from "./ui.mjs";

export { Blocked, blocked } from "./blocked.mjs";

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

export class Run {
  constructor({ browser, page, watch, outDir, runId, env }) {
    this.browser = browser;
    this.page = page;
    this.watch = watch;
    this.outDir = outDir;
    this.runId = runId;
    this.env = env;
    this.scenarios = [];
    this.startedAt = new Date().toISOString();
    this.shots = 0;
    watch.attach(page);
  }

  async shot(label) {
    this.shots += 1;
    const file = `${String(this.shots).padStart(3, "0")}-${slug(label)}.png`;
    try {
      await this.page.screenshot({ path: path.join(this.outDir, "shots", file), timeout: 15_000, animations: "disabled" });
      return `shots/${file}`;
    } catch {
      return "";
    }
  }

  async refresh() {
    this.page = await refreshWindow(this.browser, this.page);
    this.watch.attach(this.page);
    return this.page;
  }

  async scenario(definition) {
    const record = { id: definition.id, title: definition.title, checklist: definition.checklist ?? [], steps: [], notes: [] };
    this.scenarios.push(record);
    const cleanups = [];
    let stopped = "";
    const context = {
      run: this,
      get page() { return context.run.page; },
      name: (suffix) => `e2e ${this.runId} ${suffix}`,
      note: (text) => { record.notes.push(text); },
      shot: (label) => this.shot(`${definition.id} ${label}`),
      cleanup: (fn) => { cleanups.push(fn); },
      // A soft step records its failure and lets the scenario go on: use it
      // for independent checks, such as one profile out of five.
      step: async (title, fn, { soft = false } = {}) => {
        const step = { title, status: "pass", ms: 0, error: "", shot: "", errors: [] };
        record.steps.push(step);
        if (stopped) {
          step.status = "skipped";
          step.error = stopped;
          return undefined;
        }
        this.watch.step = `${definition.id}: ${title}`;
        const started = Date.now();
        let value;
        try {
          value = await fn();
        } catch (error) {
          step.status = error instanceof Blocked ? "blocked" : "fail";
          step.error = String(error?.message || error).split("\n").slice(0, 6).join("\n");
          step.shot = await this.shot(`${definition.id} ${title} ${step.status}`);
          if (!soft) stopped = `${step.status === "blocked" ? "Blocked" : "Failed"} at «${title}»`;
          await resetUi(this.page).catch(() => {});
        }
        step.ms = Date.now() - started;
        step.errors = await this.watch.scan(this.page);
        return value;
      },
    };
    await resetUi(this.page).catch(() => {});
    try {
      await definition.run(context);
    } catch (error) {
      record.steps.push({ title: "scenario error", status: "fail", ms: 0, error: String(error?.message || error), shot: await this.shot(`${definition.id} crash`), errors: [] });
    }
    await resetUi(this.page).catch(() => {});
    for (const fn of cleanups.reverse()) {
      this.watch.step = `${definition.id}: cleanup`;
      try { await fn(); } catch (error) { record.notes.push(`Cleanup failed: ${String(error?.message || error)}`); }
    }
    await this.watch.scan(this.page);
    return record;
  }

  async writeJSON(name, value) {
    await fs.writeFile(path.join(this.outDir, name), JSON.stringify(value, null, 2));
  }
}
