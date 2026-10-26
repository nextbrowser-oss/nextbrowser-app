// Steps several scenarios share: projects, account state, a chat's last
// reply, reconnecting after a restart, and the outside observers (nbc in a
// profile's browser, the GitHub API) that tell whether a run did what the
// checklist expects. Scenario actions still go through the visible UI only.
import { appReady, connectApp } from "./app.mjs";
import { blocked } from "./blocked.mjs";
import { nbc } from "./oracle.mjs";
import { sidebar, waitFor } from "./ui.mjs";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- Projects, workspaces and the account ----

export async function createProject(page, name, { agent } = {}) {
  await sidebar(page).getByRole("button", { name: "Create project", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByRole("textbox", { name: /^Project name/ }).fill(name);
  if (agent) await dialog.getByRole("combobox").selectOption(agent);
  await dialog.getByRole("radio", { name: /^Chat\b/ }).check();
  await dialog.getByRole("button", { name: "Create project", exact: true }).click();
  await dialog.waitFor({ state: "detached", timeout: 30_000 });
  await waitFor(async () => (await projectNames(page)).includes(name), `project «${name}» in the sidebar`);
}

/** Projects of the active workspace; rows are titled "Open <name>". */
export async function projectNames(page) {
  return sidebar(page).locator(".workspace-chat-list > button")
    .evaluateAll((rows) => rows.map((row) => (row.getAttribute("title") || "").replace(/^Open /, "")));
}

/** Every workspace in the picker menu, read and closed again. */
export async function workspaceNames(page) {
  const picker = sidebar(page).locator(".workspace-picker");
  if ((await picker.getAttribute("aria-expanded")) !== "true") await picker.click();
  const names = await page.locator(".workspace-menu-list button")
    .evaluateAll((items) => items.map((item) => item.getAttribute("title") || item.textContent.trim()));
  await picker.click();
  return names;
}

/** The sidebar footer: the account's email, or "Browser account not connected". */
export async function accountLabel(page) {
  return (await sidebar(page).locator(".sidebar-account-footer > span").first().innerText()).trim();
}

/** Accepts the window.confirm() the action opens (Playwright dismisses unhandled ones). */
export async function confirmNextDialog(page, action) {
  const accept = (dialog) => { dialog.accept().catch(() => {}); };
  page.once("dialog", accept);
  try {
    await action();
  } finally {
    page.off("dialog", accept);
  }
}

// ---- Chat ----

/** Waits for the open chat's last agent reply to finish, as askAgent does for its own. */
export async function waitForLastReply(page, { timeoutMs = 600_000 } = {}) {
  const replies = page.locator(".assistant-bubble");
  await waitFor(async () => (await replies.count()) > 0, "an agent reply in the chat", timeoutMs, 2_000);
  const reply = replies.last();
  await waitFor(async () => !(await reply.locator(".status-badge.status-streaming, .status-badge.status-queued").count()), "the agent to finish", timeoutMs, 2_000);
  const status = ((await reply.locator(".status-badge").getAttribute("class")) || "").match(/status-(\w+)/g)?.pop()?.slice(7) || "unknown";
  return { status, text: (await reply.locator(".msg-body").innerText()).trim() };
}

// ---- Restart ----

/**
 * After the app restarts, the old CDP connection is dead. Connects again and
 * points the run (and so every s.page) at the new window.
 */
export async function reconnectApp(run, { timeoutMs = 180_000 } = {}) {
  await run.browser.close().catch(() => {});
  const deadline = Date.now() + timeoutMs;
  let connection;
  let last;
  while (!connection && Date.now() < deadline) {
    try {
      connection = await connectApp(run.env.cdp);
    } catch (error) {
      last = error;
      await sleep(2_000);
    }
  }
  if (!connection) throw new Error(`The app did not come back on ${run.env.cdp} in ${Math.round(timeoutMs / 1000)} s: ${last?.message}`);
  run.browser = connection.browser;
  run.page = connection.page;
  run.watch.attach(connection.page);
  await appReady(connection.page, Math.max(30_000, deadline - Date.now()));
  return connection.page;
}

// ---- Observers outside the app ----

/** Navigates the profile's current tab, the way a person types a URL. */
export { pageEval } from "./oracle.mjs";

export async function openInProfile(nbcCmd, profile, url, runtime = "clawbrowser") {
  await nbc(nbcCmd, ["open", url, "--profile", profile, "--runtime", runtime, "--format", "json"]);
}

async function github(path) {
  let response;
  try {
    response = await fetch(`https://api.github.com/${path}`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "nextbrowser-e2e" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    blocked(`The GitHub API is unreachable from this machine: ${error.message}`);
  }
  if (!response.ok) blocked(`The GitHub API answered ${response.status} for ${path}`);
  return response.json();
}

/** The newest commits of the default branch: what the GitHub page shows as their names. */
export async function latestCommits(repo, count = 2) {
  const commits = await github(`repos/${repo}/commits?per_page=${count}`);
  return commits.map((commit) => ({ sha: commit.sha, title: commit.commit.message.split("\n")[0].trim() }));
}

export async function repoStars(repo) {
  return (await github(`repos/${repo}`)).stargazers_count;
}

/** Whether a text names a phrase, ignoring case, spacing and Markdown marks. */
export function mentions(text, phrase) {
  const plain = (value) => String(value ?? "").replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  return plain(text).includes(plain(phrase));
}
