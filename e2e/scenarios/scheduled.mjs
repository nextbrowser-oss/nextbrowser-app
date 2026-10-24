import { blocked } from "../lib/blocked.mjs";
import { activeWorkspace, createProfile, createWorkspace, deleteCurrentWorkspace, escape, sidebar, stopProfile, switchWorkspace, waitFor } from "../lib/ui.mjs";
import { projectNames, repoStars, waitForLastReply } from "../lib/ui-workflows.mjs";

const REPO = "nextbrowser-oss/nextbrowser-app";
const PROMPT = "Check GitHub star for nextbrowser project. Use Clawbrowser with GE proxy";
const TRAFFIC_LIMIT = /traffic (?:limit|is used up|exhausted)|PROXY_TRAFFIC_EXHAUSTED|star .*unlock/i;

const main = (page) => page.getByRole("main");
const scheduleRow = (page, title) => main(page).locator(".schedule-row", { hasText: title });

async function openScheduled(page) {
  await page.getByRole("navigation", { name: "Sidebar pages" }).getByRole("button", { name: /^Scheduled\b/ }).click();
  await main(page).getByRole("heading", { name: "Scheduled runs" }).waitFor();
}

/**
 * A daily run fires at hour:minute in the app's local time, which is the
 * Windows clock and zone, not this suite's. Picks the minute after the next
 * minute boundary + 2, so the schedule is saved well before it is due.
 */
async function firstRunTime(page) {
  const now = await page.evaluate(() => Date.now());
  const due = (Math.floor(now / 60_000) + 3) * 60_000;
  const local = await page.evaluate((time) => { const date = new Date(time); return { hour: date.getHours(), minute: date.getMinutes() }; }, due);
  return { ...local, due };
}

async function deleteSchedule(page, title) {
  await openScheduled(page);
  const row = scheduleRow(page, title);
  if (!(await row.count())) return;
  await row.getByRole("button", { name: "Edit or delete scheduled run" }).click();
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: `Delete “${title}”?` });
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await row.waitFor({ state: "detached", timeout: 30_000 });
}

export default {
  id: "scheduled",
  title: "Scheduled runs",
  checklist: [
    "Create runs 'Check GitHub star for nextbrowser project. Use Clawbrowser with GE proxy', set it up daily (a few minutes after you do it). Check if it runs.",
  ],
  async run(s) {
    const home = await activeWorkspace(s.page);
    const workspace = s.name("scheduled");
    const profile = s.name("Claw GE");
    const title = s.name("GitHub stars");
    let created = false;
    let scheduled = false;
    s.cleanup(async () => {
      if (scheduled) await deleteSchedule(s.page, title).catch((error) => s.note(`Schedule «${title}» was not deleted: ${error.message}`));
      if (!created) return;
      await switchWorkspace(s.page, workspace).catch(() => {});
      await stopProfile(s.page, profile).catch(() => {});
      if ((await activeWorkspace(s.page)) === workspace) await deleteCurrentWorkspace(s.page);
      await switchWorkspace(s.page, home);
    });

    await s.step("Create a workspace with a Clawbrowser GE profile", async () => {
      await createWorkspace(s.page, workspace);
      created = true;
      await createProfile(s.page, { name: profile, connection: "managed", country: "GE", toolset: "Clawbrowser" });
    });

    let due;
    await s.step("Schedule the run daily, a few minutes from now", async () => {
      await openScheduled(s.page);
      await main(s.page).getByRole("button", { name: /New schedule/ }).click();
      const editor = s.page.getByRole("dialog", { name: "New scheduled run" });
      await editor.getByPlaceholder("e.g. Daily listing check").fill(title);
      await editor.getByPlaceholder("Describe what the agent should do each time").fill(PROMPT);
      await editor.getByRole("combobox", { name: /^Browser profile/ }).selectOption({ label: profile });
      await editor.getByRole("combobox", { name: /^Repeat/ }).selectOption("daily");
      await editor.getByRole("button", { name: "Daily", exact: true }).click();
      const time = await firstRunTime(s.page);
      await editor.getByRole("spinbutton", { name: /^Hour/ }).fill(String(time.hour));
      await editor.getByRole("spinbutton", { name: /^Min/ }).fill(String(time.minute));
      await editor.getByRole("button", { name: "Add", exact: true }).click();
      await editor.waitFor({ state: "detached", timeout: 15_000 });
      scheduled = true;
      due = time.due;
      const hhmm = `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
      const row = (await scheduleRow(s.page, title).innerText()).replace(/\s+/g, " ");
      s.note(`Scheduled «${title}» daily at ${hhmm} (app time): ${row}`);
      if (!row.includes(hhmm)) throw new Error(`The schedule shows «${row}», not ${hhmm}`);
      if (!row.includes(`Profile: ${profile}`)) throw new Error(`The schedule does not use «${profile}»: ${row}`);
    });

    await s.step("The run starts at its time", async () => {
      const row = scheduleRow(s.page, title);
      let text = "";
      // Due in about 3 minutes; the scheduler ticks while the app is open.
      await waitFor(async () => {
        await openScheduled(s.page);
        text = (await row.innerText()).replace(/\s+/g, " ");
        return /Last started/.test(text);
      }, `«${title}» to start`, Math.max(60_000, due - Date.now()) + 420_000, 10_000).catch((error) => {
        const failure = text.match(/Could not start: (.*?)(?: It retries|$)/)?.[1];
        if (failure && /agent|sign in|connect/i.test(failure)) blocked(`The scheduled run could not start an agent: ${failure}`);
        throw new Error(failure ? `The scheduled run did not start: ${failure}` : error.message);
      });
      s.note(`Schedule after its time: ${text}`);
    });

    await s.step("The run finishes in its own chat; record the result", async () => {
      // "New chat each run" adds a project named after the schedule.
      await waitFor(async () => (await projectNames(s.page)).includes(title), `the run's chat «${title}» in the sidebar`, 120_000, 2_000);
      const expand = sidebar(s.page).getByRole("button", { name: "Expand projects" });
      if (await expand.isVisible()) await expand.click();
      await sidebar(s.page).getByRole("button", { name: new RegExp(`^${escape(title)}`) }).first().click();
      const reply = await waitForLastReply(s.page, { timeoutMs: 600_000 });
      s.note(`Scheduled run result (${reply.status}): ${reply.text.slice(0, 600)}`);
      await s.shot("scheduled run result");
      if (TRAFFIC_LIMIT.test(reply.text)) blocked(`The QA account has no proxy traffic left: ${reply.text.slice(0, 200)}`);
      if (reply.status !== "done") throw new Error(`The scheduled run ended as ${reply.status}: ${reply.text.slice(0, 300)}`);
    });

    await s.step("The result names the repository's star count", async () => {
      const stars = await repoStars(REPO);
      const reply = await waitForLastReply(s.page, { timeoutMs: 10_000 });
      const numbers = [...reply.text.matchAll(/(\d[\d,.]*)\s*(k)?/gi)].map((match) => Number(match[1].replace(/,/g, "")) * (match[2] ? 1000 : 1));
      const close = numbers.some((value) => Math.abs(value - stars) <= Math.max(3, stars * 0.05));
      if (!close) throw new Error(`GitHub shows ${stars} stars for ${REPO}; the result names none near it`);
    }, { soft: true });
  },
};
