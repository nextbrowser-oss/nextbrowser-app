import { blocked } from "../lib/blocked.mjs";
import { activeWorkspace, askAgent, createProfile, createWorkspace, deleteCurrentWorkspace, escape, openMainView, setChatMode, stopProfile, switchWorkspace, waitFor } from "../lib/ui.mjs";
import { confirmNextDialog, createProject, latestCommits, mentions, openInProfile, pageEval, sleep } from "../lib/ui-workflows.mjs";

const REPO = "nextbrowser-oss/nextbrowser-app";
const REPO_URL = `https://github.com/${REPO}`;
// Replays start from this page, so a replay that does not navigate shows.
const NEUTRAL_PAGE = "https://example.com/";
const AGENT_TASK = `Open the Nextbrowser GitHub repository ${REPO_URL} in the browser, check the name of the last commit on the main branch and store that name in Artifact Center as last-commit.txt. Reply with the commit name.`;
const NEW_TASK = "Check last two commit names as one string";
// The repository page's "N Commits" link, which a person clicks to see the history.
const COMMITS_LINK = `[...document.querySelectorAll('a[href*="/commits/"]')].find((link) => /\\bcommits?$/i.test(link.innerText.trim()))`;

const main = (page) => page.getByRole("main");

// ---- Automation Studio ----

async function openStudio(page, section) {
  await openMainView(page, "Automation");
  await main(page).getByRole("button", { name: section, exact: true }).click();
}

const studioBanner = (page) => main(page).getByRole("alert").filter({ hasText: /Automation couldn.t complete the action/ }).first();

/** The Studio's error banner, or "". */
async function studioErrorText(page) {
  const banner = studioBanner(page);
  if (!(await banner.isVisible().catch(() => false))) return "";
  return (await banner.innerText()).replace(/\s+/g, " ").replace(/\s*Dismiss$/, "").trim();
}

async function studioError(page) {
  const text = await studioErrorText(page);
  if (text) throw new Error(text);
}

/** Recordings are identified by their "Recorded …" timestamp. */
async function recordingKeys(page) {
  return main(page).locator("article time.capture-created-at").evaluateAll((items) => items.map((item) => item.getAttribute("datetime")));
}

const recordingCard = (page, key) => main(page).getByRole("article").filter({ has: page.locator(`time[datetime="${key}"]`) });

async function startRecording(page) {
  await openStudio(page, "Recorder");
  await main(page).getByRole("button", { name: "Start recording", exact: true }).click();
  // Starting verifies the profile first; the app then switches to Project.
  await waitFor(async () => {
    await studioError(page);
    return page.getByRole("region", { name: "Recording in progress" }).isVisible();
  }, "the recording to start", 300_000, 1_000);
}

/** Stops from the Recorder; returns the new recording and the Recorder's warning, if it showed one. */
async function stopRecording(page, known, since) {
  await openStudio(page, "Recorder");
  await main(page).getByRole("button", { name: "Stop recording", exact: true }).click();
  const review = page.getByRole("dialog", { name: /may not replay successfully|stopped, but was not saved/ });
  let warning = "";
  let key;
  await waitFor(async () => {
    if (await review.isVisible()) {
      warning = (await review.innerText()).replace(/\s+/g, " ").trim();
      await review.getByRole("button", { name: /^(Save anyway|Retry save)$/ }).click();
    }
    key = (await recordingKeys(page)).find((item) => !known.has(item) && Date.parse(item) >= since - 120_000);
    if (key) return true;
    await studioError(page);
    return false;
  }, "the stopped recording in the list", 120_000, 1_000);
  known.add(key);
  // A capture error is reported next to a recording that was still saved.
  return { key, warning: [warning, await studioErrorText(page)].filter(Boolean).join(" · ") };
}

/** A running recording blocks every later one; cleanups stop it and discard the capture. */
async function abandonRecording(page) {
  if (!(await page.getByRole("region", { name: "Recording in progress" }).isVisible())) return;
  await openStudio(page, "Recorder");
  await main(page).getByRole("button", { name: "Stop recording", exact: true }).click();
  const review = page.getByRole("dialog", { name: /may not replay successfully|stopped, but was not saved/ });
  await review.getByRole("button", { name: "Discard" }).click({ timeout: 30_000 }).catch(() => {});
}

/** Dismisses the previous run's card and error, so the next ones are this run's. */
async function clearExecution(page) {
  for (const scope of [main(page).locator(".recording-progress-card"), studioBanner(page)]) {
    const dismiss = scope.getByRole("button", { name: "Dismiss", exact: true });
    if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
  }
}

async function startSafely(page) {
  const review = page.getByRole("dialog", { name: "Review this automation" });
  await review.getByRole("button", { name: /Start safely/ }).click();
  await review.waitFor({ state: "detached", timeout: 30_000 });
}

/**
 * Waits for the execution card to settle on completed, failed or stopped. A
 * failed step may hand over to automatic AI repair, so the end state has to
 * hold for a few seconds.
 */
async function waitForExecution(page, timeoutMs = 900_000) {
  const card = main(page).locator(".recording-progress-card");
  let final = "";
  let since = 0;
  const head = card.locator(".recording-progress-head strong");
  await waitFor(async () => {
    const heading = (await head.count()) ? (await head.innerText()).trim() : "";
    // Some refusals (another run, no profile chosen) show only the banner.
    if (!heading) await studioError(page);
    if (!/^Execution (completed|failed|stopped)$/.test(heading)) {
      final = "";
      return false;
    }
    if (heading !== final) {
      final = heading;
      since = Date.now();
    }
    return Date.now() - since >= 8_000;
  }, "the automation run to finish", timeoutMs, 2_000);
  const detail = (await card.locator(":scope > small").innerText().catch(() => "")).trim();
  // The timeline folds away once the run ends, so it is read from the DOM text.
  const timeline = (await card.locator("ol > li").evaluateAll((items) => items.map((item) => [...item.querySelectorAll("strong, small")].map((part) => part.textContent.trim()).join(": ")))).join(" · ");
  return { status: final.replace("Execution ", ""), detail, timeline };
}

async function replayRecording(page, key) {
  await openStudio(page, "Recorder");
  await clearExecution(page);
  await recordingCard(page, key).getByRole("button", { name: /^(Run again|Repair & run)$/ }).click();
  await startSafely(page);
  return waitForExecution(page);
}

async function artifacts(page) {
  await openStudio(page, "Artifact Center");
  // Opening the section starts a reload; let it begin before waiting for it.
  await sleep(1_000);
  await waitFor(() => main(page).getByRole("button", { name: "Add files" }).isEnabled(), "Artifact Center to load");
  return main(page).locator("article.artifact-card").evaluateAll((cards) => cards.map((card) => ({
    name: card.querySelector("strong")?.getAttribute("title") || "",
    meta: card.querySelector(".artifact-copy > span")?.textContent.trim() || "",
    added: card.querySelector(".artifact-copy > small:last-of-type")?.textContent.trim() || "",
  })));
}

const artifactKey = (artifact) => `${artifact.name}\n${artifact.added}`;
const newArtifacts = (before, after) => after.filter((artifact) => !before.some((old) => artifactKey(old) === artifactKey(artifact)));

/** "TXT · 42 B" → 42; larger units are rounded by the app, so they give an estimate. */
function artifactBytes(artifact) {
  const match = artifact.meta.match(/([\d.]+) (B|KiB|MiB)$/);
  return match ? Number(match[1]) * { B: 1, KiB: 1024, MiB: 1024 ** 2 }[match[2]] : NaN;
}

/** A file holding these names cannot be smaller than the names themselves. */
function assertLargeEnough(saved, names) {
  const needed = names.reduce((sum, name) => sum + Buffer.byteLength(name), 0);
  if (saved.some((artifact) => !(artifactBytes(artifact) * 1.05 < needed))) return;
  throw new Error(`${saved.map((artifact) => `${artifact.name} (${artifact.meta})`).join(", ")} is too small to hold ${names.map((name) => `«${name}»`).join(" and ")} (${needed} bytes)`);
}

// ---- Workflow Builder ----

/** The name of the workflow open in the editor, or "". */
async function openWorkflowTitle(page) {
  const name = main(page).getByRole("textbox", { name: "Workflow name" });
  return (await name.count()) ? name.inputValue() : "";
}

async function openWorkflow(page, title) {
  await openStudio(page, "Workflow Builder");
  if ((await openWorkflowTitle(page)) === title) return;
  const restore = main(page).getByRole("button", { name: "Open workflow sidebar" });
  if (await restore.isVisible()) await restore.click();
  await main(page).getByRole("button", { name: new RegExp(`^${escape(title)}`) }).click();
  await waitFor(async () => (await openWorkflowTitle(page)) === title, `workflow «${title}» to open`);
}

async function saveWorkflow(page) {
  const save = main(page).getByRole("button", { name: "Save", exact: true });
  if (!(await save.count())) return;
  if (!(await save.isEnabled())) {
    const alerts = await main(page).getByRole("alert").allInnerTexts();
    throw new Error(`The workflow cannot be saved: ${alerts.join(" · ") || "Save is disabled"}`);
  }
  await save.click();
  await waitFor(async () => {
    await studioError(page);
    return !(await save.count());
  }, "the workflow to save");
}

/** The open workflow's steps, read from each step's inspector. */
async function workflowSteps(page) {
  const nodes = main(page).getByRole("region", { name: "Workflow diagram" }).getByRole("button", { name: /STEP \d+/ });
  const steps = [];
  for (let index = 0; index < await nodes.count(); index += 1) {
    await nodes.nth(index).click();
    const action = main(page).getByRole("combobox", { name: `Step ${index + 1} action` });
    let tool = await action.inputValue();
    if (tool === "advanced") tool = (await action.locator("option").first().textContent()).trim().replace(/^Advanced: /, "");
    const args = JSON.parse(await main(page).locator(`textarea[aria-label="Step ${index + 1} arguments"]`).inputValue());
    steps.push({ tool, args });
  }
  return steps;
}

/** A recording card's steps, from its "Show recorded steps" list. */
async function recordedSteps(page, key) {
  const labels = { "Collect with page script": "evaluate", "Save to Artifact Center": "save_artifact", "Open a web page": "navigate", "Open a URL": "open" };
  const items = await recordingCard(page, key).locator("details.capture-steps li")
    .evaluateAll((rows) => rows.map((row) => ({ label: row.querySelector("b")?.textContent || "", args: row.querySelector("code")?.textContent || "{}" })));
  return items.map((item) => ({ tool: labels[item.label] || item.label, args: JSON.parse(item.args) }));
}

/**
 * What the run's last page script returns on the page the run ended on: the
 * value a save step after it writes to the artifact. Artifact Center has no
 * in-app view of a file's content, so this is the closest observable.
 */
async function dataStepValue(nbcCmd, profile, steps) {
  const script = steps.filter((step) => step.tool === "evaluate").pop()?.args.expression;
  if (!script) return undefined;
  const value = await pageEval(nbcCmd, profile, script);
  return typeof value === "string" ? value : JSON.stringify(value);
}

async function deleteWorkflow(page, title) {
  await openWorkflow(page, title);
  await main(page).getByLabel("More workflow actions").click();
  await confirmNextDialog(page, () => main(page).getByRole("button", { name: "Delete workflow", exact: true }).click());
  await waitFor(async () => (await openWorkflowTitle(page)) !== title, `workflow «${title}» to be deleted`);
}

async function deleteRecording(page, key) {
  await openStudio(page, "Recorder");
  const card = recordingCard(page, key);
  if (!(await card.count())) return;
  await confirmNextDialog(page, () => card.getByRole("button", { name: "Delete", exact: true }).click());
  await card.waitFor({ state: "detached", timeout: 30_000 });
}

/** "Turn into workflow" on a recording, then a unique name to find and delete the workflow by. */
async function turnIntoWorkflow(s, source, workflows) {
  await openStudio(s.page, "Recorder");
  // The editor may show another workflow for a moment; the notice comes once the new one is open.
  const notice = main(s.page).getByRole("status").filter({ hasText: "Recording saved as a reusable workflow." });
  if (await notice.isVisible()) await notice.getByRole("button", { name: "Dismiss" }).click();
  const turn = recordingCard(s.page, source.key).getByRole("button", { name: "Turn into workflow" });
  if (await turn.isDisabled()) throw new Error("the recording is not replayable, so it cannot become a workflow");
  await turn.click();
  await waitFor(async () => {
    await studioError(s.page);
    return notice.isVisible();
  }, `the ${source.kind} workflow to open`, 60_000);
  await sleep(1_000);
  const original = await openWorkflowTitle(s.page);
  const title = s.name(`${source.kind} workflow`);
  s.note(`The ${source.kind} recording became «${original}», renamed «${title}»`);
  await main(s.page).getByRole("textbox", { name: "Workflow name" }).fill(title);
  try {
    await saveWorkflow(s.page);
  } catch (error) {
    workflows.push(original);
    throw error;
  }
  workflows.push(title);
  return title;
}

// ---- The person browsing during a manual recording ----

/** Opens the repository and clicks its commits link, through nbc in the recorded profile. */
async function browseToCommits(nbcCmd, profile) {
  await openInProfile(nbcCmd, profile, REPO_URL);
  await waitFor(async () => String(await pageEval(nbcCmd, profile, `Boolean(${COMMITS_LINK})`)) === "true", "the repository page with its commits link", 60_000, 2_000);
  // The recorder re-arms on each page it sees (it polls every 250 ms).
  await sleep(2_000);
  await pageEval(nbcCmd, profile, `(() => { const link = ${COMMITS_LINK}; link.click(); return link.href; })()`);
  await waitFor(async () => /\/commits\//.test(String(await pageEval(nbcCmd, profile, "location.href"))), "the commits page", 60_000, 2_000);
}

async function profileUrl(nbcCmd, profile) {
  return String(await pageEval(nbcCmd, profile, "location.href"));
}

export default {
  id: "automation",
  title: "Automation",
  checklist: [
    "Create manual Record ('Open your nextbrowser GitHub, check last commit name')",
    "Run this manual Record. It should open it the same way you did it",
    "Create agentic Record (Ask agent to open nextbrowser GitHub and check last commit name. Store the name in artefact center)",
    "Run it. Check the result",
    "Convert Records to Workflow",
    "Change the workflow task: 'Check last two commit names as one string'",
    "Run it and check if you got a new artefact with the two last commit names",
  ],
  async run(s) {
    const home = await activeWorkspace(s.page);
    const workspace = s.name("automation");
    const profile = s.name("Automation claw");
    const nbcCmd = s.run.env.nbcCmd;
    const known = new Set();
    const recordings = [];
    const workflows = [];
    let manual;
    let agentic;
    let created = false;
    s.cleanup(async () => {
      await abandonRecording(s.page).catch(() => {});
      // Recordings and workflows belong to the account, not the workspace.
      for (const title of workflows) await deleteWorkflow(s.page, title).catch((error) => s.note(`Workflow «${title}» was not deleted: ${error.message}`));
      for (const key of recordings) await deleteRecording(s.page, key).catch((error) => s.note(`Recording ${key} was not deleted: ${error.message}`));
      if (!created) return;
      await switchWorkspace(s.page, workspace).catch(() => {});
      await stopProfile(s.page, profile).catch(() => {});
      if ((await activeWorkspace(s.page)) === workspace) await deleteCurrentWorkspace(s.page);
      await switchWorkspace(s.page, home);
    });

    await s.step("Create a workspace with a project and one Clawbrowser profile", async () => {
      await createWorkspace(s.page, workspace);
      created = true;
      await createProfile(s.page, { name: profile, connection: "none", toolset: "Clawbrowser" });
      await createProject(s.page, s.name("automation project"), { agent: s.run.env.agent || undefined });
      await openStudio(s.page, "Recorder");
      await sleep(3_000);
      for (const key of await recordingKeys(s.page)) known.add(key);
    });

    await s.step("Create a manual recording: open the Nextbrowser GitHub and read the last commit name", async () => {
      if (!nbcCmd) blocked("E2E_NBC_CMD is not set: the suite browses in the recorded profile through nbc");
      const [last] = await latestCommits(REPO, 1);
      const since = Date.now();
      await startRecording(s.page);
      let stopped;
      try {
        await browseToCommits(nbcCmd, profile);
        await waitFor(async () => String(await pageEval(nbcCmd, profile, `document.body.innerText.includes(${JSON.stringify(last.title)})`)) === "true",
          `the commits page to show the last commit «${last.title}»`, 30_000, 2_000);
      } finally {
        stopped = await stopRecording(s.page, known, since);
        recordings.push(stopped.key);
      }
      manual = { kind: "manual", key: stopped.key };
      const card = (await recordingCard(s.page, stopped.key).innerText()).replace(/\s+/g, " ");
      s.note(`Manual recording: ${card.slice(0, 300)}`);
      if (stopped.warning) throw new Error(`The Recorder warned about the capture: ${stopped.warning}`);
      if (/Not reusable:/.test(card)) throw new Error(`The recording is not replayable: ${card.match(/Not reusable:[^.]*\./)?.[0]}`);
    }, { soft: true });

    await s.step("Run the manual recording: it opens the commits page the same way", async () => {
      if (!manual) blocked("The manual recording was not created");
      await openInProfile(nbcCmd, profile, NEUTRAL_PAGE);
      const result = await replayRecording(s.page, manual.key);
      s.note(`Manual replay ${result.status}: ${result.detail} Timeline: ${result.timeline.slice(0, 400)}`);
      if (result.status !== "completed") throw new Error(`The replay ${result.status}: ${result.detail}`);
      const url = await profileUrl(nbcCmd, profile);
      if (!url.startsWith(`${REPO_URL}/commits`)) throw new Error(`After the replay the browser shows ${url}, not the commits page`);
    }, { soft: true });

    await s.step("Create an agentic recording: the agent reads the last commit name and stores it in Artifact Center", async () => {
      const [last] = await latestCommits(REPO, 1);
      const before = await artifacts(s.page);
      const since = Date.now();
      await startRecording(s.page);
      let reply;
      let stopped;
      try {
        await setChatMode(s.page, "Chat");
        reply = await askAgent(s.page, AGENT_TASK, { timeoutMs: 900_000 });
      } finally {
        stopped = await stopRecording(s.page, known, since);
        recordings.push(stopped.key);
      }
      agentic = { kind: "agentic", key: stopped.key };
      s.note(`Agent (${reply.status}): ${reply.text.slice(0, 400)}`);
      if (reply.status !== "done") throw new Error(`The agent's reply ended as ${reply.status}: ${reply.text.slice(0, 300)}`);
      if (!mentions(reply.text, last.title)) throw new Error(`The agent's reply does not name the last commit «${last.title}»`);
      if (stopped.warning) throw new Error(`The Recorder warned about the capture: ${stopped.warning}`);
      const saved = newArtifacts(before, await artifacts(s.page));
      if (!saved.length) throw new Error("The agent saved nothing to Artifact Center");
      s.note(`Agent saved: ${saved.map((artifact) => `${artifact.name} (${artifact.meta})`).join(", ")}`);
      assertLargeEnough(saved, [last.title]);
    }, { soft: true });

    await s.step("Run the agentic recording: it saves the last commit name again", async () => {
      if (!agentic) blocked("The agentic recording was not created");
      const [last] = await latestCommits(REPO, 1);
      const before = await artifacts(s.page);
      if (nbcCmd) await openInProfile(nbcCmd, profile, NEUTRAL_PAGE);
      const result = await replayRecording(s.page, agentic.key);
      s.note(`Agentic replay ${result.status}: ${result.detail} Timeline: ${result.timeline.slice(0, 400)}`);
      if (result.status !== "completed") throw new Error(`The replay ${result.status}: ${result.detail}`);
      const saved = newArtifacts(before, await artifacts(s.page));
      if (!saved.length) throw new Error("The replay saved no new artifact");
      s.note(`Replay saved: ${saved.map((artifact) => `${artifact.name} (${artifact.meta})`).join(", ")}`);
      assertLargeEnough(saved, [last.title]);
      if (!nbcCmd) return s.note("E2E_NBC_CMD is not set: the saved value was not compared with the commit name");
      await openStudio(s.page, "Recorder");
      const value = await dataStepValue(nbcCmd, profile, await recordedSteps(s.page, agentic.key));
      if (value === undefined) return s.note("The recording has no page-script step whose value could be compared");
      if (!mentions(value, last.title)) throw new Error(`The recording's data step reads «${value.slice(0, 200)}», not the last commit «${last.title}»`);
    }, { soft: true });

    await s.step("Turn both recordings into workflows", async () => {
      const sources = [manual, agentic].filter(Boolean);
      if (!sources.length) blocked("No recording was created");
      const problems = [manual, agentic].some((source) => !source) ? [`only the ${sources[0].kind} recording exists`] : [];
      for (const source of sources) {
        try {
          source.workflow = await turnIntoWorkflow(s, source, workflows);
        } catch (error) {
          problems.push(`${source.kind}: ${error.message}`);
        }
      }
      if (problems.length) throw new Error(problems.join("; "));
    }, { soft: true });

    let changed = false;
    await s.step(`Change the workflow task: «${NEW_TASK}»`, async () => {
      if (!agentic?.workflow) blocked("The agentic recording did not become a workflow");
      await openWorkflow(s.page, agentic.workflow);
      // The task text alone does not change the saved steps, which replay as
      // recorded; "Edit with AI" has the agent rewrite them for the new task.
      await main(s.page).getByRole("button", { name: "Edit with AI" }).click();
      const editor = main(s.page).getByRole("region", { name: "Edit workflow with AI" });
      await editor.getByRole("textbox").fill(`${NEW_TASK}. Save that one string to Artifact Center.`);
      await editor.getByRole("button", { name: "Update steps" }).click();
      await waitFor(async () => {
        await studioError(s.page);
        return !(await editor.count());
      }, "the agent to rewrite the workflow", 900_000, 2_000);
      await main(s.page).getByRole("textbox", { name: /What should this workflow accomplish/ }).fill(NEW_TASK);
      await saveWorkflow(s.page);
      const steps = await workflowSteps(s.page);
      s.note(`Rewritten steps: ${steps.map((step) => step.tool).join(" → ")}`);
      if (!steps.some((step) => step.tool === "save_artifact")) throw new Error("The rewritten workflow no longer saves to Artifact Center");
      changed = true;
    }, { soft: true });

    await s.step("Run the changed workflow: a new artifact holds the last two commit names", async () => {
      if (!changed) blocked("The workflow task was not changed");
      const commits = await latestCommits(REPO, 2);
      const before = await artifacts(s.page);
      await openWorkflow(s.page, agentic.workflow);
      await clearExecution(s.page);
      await main(s.page).getByRole("button", { name: /^(Run|Save & run)$/ }).click();
      await startSafely(s.page);
      const result = await waitForExecution(s.page);
      s.note(`Workflow run ${result.status}: ${result.detail} Timeline: ${result.timeline.slice(0, 400)}`);
      if (result.status !== "completed") throw new Error(`The workflow run ${result.status}: ${result.detail}`);
      const saved = newArtifacts(before, await artifacts(s.page));
      if (!saved.length) throw new Error("The workflow run saved no new artifact");
      s.note(`Workflow saved: ${saved.map((artifact) => `${artifact.name} (${artifact.meta})`).join(", ")}`);
      await s.shot("workflow artifact");
      assertLargeEnough(saved, commits.map((commit) => commit.title));
      if (!nbcCmd) return s.note("E2E_NBC_CMD is not set: the saved value was not compared with the commit names");
      await openWorkflow(s.page, agentic.workflow);
      const value = await dataStepValue(nbcCmd, profile, await workflowSteps(s.page));
      if (value === undefined) return s.note("The workflow has no page-script step whose value could be compared");
      s.note(`The workflow's data step reads: ${value.slice(0, 300)}`);
      const missing = commits.filter((commit) => !mentions(value, commit.title));
      if (missing.length) throw new Error(`The workflow's data step does not read ${missing.map((commit) => `«${commit.title}»`).join(" and ")}: «${value.slice(0, 200)}»`);
    }, { soft: true });
  },
};
