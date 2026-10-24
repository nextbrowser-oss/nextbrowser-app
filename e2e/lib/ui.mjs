// What a user does in the Nextbrowser window, expressed through the visible
// UI only: buttons, fields and texts a person would use. No IPC, storage or
// backend calls drive a scenario.
import { blocked } from "./blocked.mjs";

const PROFILE_ROW = /^Select profile (.+)$/;

export const sidebar = (page) => page.getByRole("complementary");

export async function profileNames(page) {
  const names = [];
  for (const button of await sidebar(page).getByRole("button", { name: PROFILE_ROW }).all()) {
    const label = await button.getAttribute("aria-label");
    const match = label?.match(PROFILE_ROW);
    if (match) names.push(match[1]);
  }
  return names;
}

export async function sectionCount(page, section) {
  const button = sidebar(page).getByRole("button", { name: new RegExp(`^(Expand|Collapse) ${section}$`, "i") });
  const text = (await button.first().innerText()).replace(/\s+/g, " ");
  const count = text.match(/(\d+)/);
  return count ? Number(count[1]) : 0;
}

export async function activeWorkspace(page) {
  const label = await sidebar(page).getByRole("button", { name: /^Workspace / }).first().getAttribute("aria-label").catch(() => null);
  const text = label ?? await sidebar(page).locator(".workspace-picker strong").innerText();
  return text.replace(/^Workspace\s+/, "").trim();
}

export async function createWorkspace(page, name) {
  await sidebar(page).getByRole("button", { name: "Create workspace", exact: true }).click();
  const field = page.getByRole("textbox", { name: /Workspace name/ });
  await field.fill(name);
  await field.press("Enter");
  await field.waitFor({ state: "detached", timeout: 30_000 });
  await waitFor(async () => (await activeWorkspace(page)) === name, `workspace «${name}» to become active`);
}

export async function switchWorkspace(page, name) {
  if ((await activeWorkspace(page)) === name) return;
  await sidebar(page).locator(".workspace-picker").click();
  await page.locator(".workspace-menu-list button", { hasText: name }).first().click();
  await waitFor(async () => (await activeWorkspace(page)) === name, `workspace «${name}» to become active`);
}

export async function deleteCurrentWorkspace(page) {
  const name = await activeWorkspace(page);
  await sidebar(page).locator(".workspace-picker").click();
  await page.getByRole("button", { name: /Delete current workspace/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: /Delete workspace and contents/ }).click();
  await page.getByRole("alertdialog").waitFor({ state: "detached", timeout: 60_000 });
  return name;
}

/**
 * connection: "none" | "managed" | "personal"; toolset: "Clawbrowser" |
 * "DasBrowser" | "Camoufox" | "Multilogin"; country: a name or ISO code the
 * country search understands; personalProxy: the saved proxy's visible name.
 */
export async function createProfile(page, { name, connection = "managed", country = "US", toolset = "Clawbrowser", personalProxy }) {
  await sidebar(page).getByRole("button", { name: "Create profile", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create profile" });
  await dialog.waitFor();
  try {
    await fillProfileDialog(page, dialog, { name, connection, country, toolset, personalProxy });
  } catch (error) {
    // Leave the window usable for the next step.
    if (await dialog.isVisible()) await dialog.getByRole("button", { name: "Close profile creation" }).click().catch(() => {});
    throw error;
  }
  await waitFor(async () => (await profileNames(page)).includes(name), `profile «${name}» in the sidebar`, 60_000);
}

async function fillProfileDialog(page, dialog, { name, connection, country, toolset, personalProxy }) {
  await dialog.getByRole("textbox", { name: /Profile name/ }).fill(name);
  await dialog.getByRole("radio", { name: new RegExp(`^${toolset}\\b`) }).check();
  if (toolset === "Multilogin" && await page.getByText("Connect Multilogin").first().isVisible().catch(() => false)) {
    blocked("The Multilogin connector is not connected: it needs an API token from the Multilogin desktop app");
  }
  const connectionName = { none: /^No proxy/, managed: /^Managed proxy/, personal: /^Personal proxy/ }[connection];
  const connectionRadio = dialog.getByRole("radio", { name: connectionName });
  if (await connectionRadio.count()) await connectionRadio.check();
  if (connection === "managed") await chooseCountry(page, dialog, country);
  if (connection === "personal") {
    await dialog.getByRole("button", { name: "Personal proxy", exact: true }).click();
    await page.getByRole("option", { name: new RegExp(escape(personalProxy)) }).first().click();
  }
  await dialog.getByRole("button", { name: "Create profile", exact: true }).click();
  await waitFor(async () => {
    if (!(await dialog.count())) return true;
    const error = dialog.locator('[class~="error"], [role="alert"]').first();
    if (await error.count() && await error.isVisible()) throw new Error(`Create profile: ${(await error.innerText()).trim()}`);
    return false;
  }, "the Create profile dialog to close", 120_000);
}

export async function chooseCountry(page, scope, country) {
  await scope.getByRole("button", { name: "Proxy country" }).click();
  await page.getByLabel("Search countries").fill(country);
  const option = page.getByRole("option", { name: new RegExp(`\\b${escape(country)}\\b`, "i") }).first();
  await option.click();
}

export async function deleteProfile(page, name) {
  await openProfileActions(page, name);
  await page.getByRole("dialog", { name: `Profile actions for ${name}` }).getByRole("button", { name: /Delete profile/ }).click();
  const confirm = page.getByRole("dialog", { name: `Delete profile "${name}"?` });
  await confirm.getByRole("button", { name: /^Delete/ }).click();
  await waitFor(async () => !(await profileNames(page)).includes(name), `profile «${name}» to leave the sidebar`, 60_000);
}

export async function openProfileActions(page, name) {
  await sidebar(page).getByRole("button", { name: `Profile actions for ${name}`, exact: true }).click();
  await page.getByRole("dialog", { name: `Profile actions for ${name}` }).waitFor();
}

export async function profileStatus(page, name) {
  const row = sidebar(page).getByRole("button", { name: `Select profile ${name}`, exact: true });
  return (await row.innerText()).replace(/\s+/g, " ").trim();
}

export async function startProfile(page, name, { timeoutMs = 240_000 } = {}) {
  await sidebar(page).getByRole("button", { name: `Start ${name}`, exact: true }).click();
  await waitFor(async () => {
    if (await sidebar(page).getByRole("button", { name: `Stop ${name}`, exact: true }).count()) return true;
    const failure = await visibleProfileError(page);
    if (failure) throw new Error(`Start of «${name}» failed: ${failure}`);
    return false;
  }, `profile «${name}» to run`, timeoutMs);
}

export async function stopProfile(page, name) {
  const stop = sidebar(page).getByRole("button", { name: `Stop ${name}`, exact: true });
  if (!(await stop.count())) return;
  await stop.click();
  await waitFor(async () => (await sidebar(page).getByRole("button", { name: `Start ${name}`, exact: true }).count()) > 0, `profile «${name}» to stop`, 120_000);
}

async function visibleProfileError(page) {
  const errors = sidebar(page).locator('[class~="error"], [role="alert"]');
  for (const error of await errors.all()) {
    if (await error.isVisible()) return (await error.innerText()).replace(/\s+/g, " ").trim();
  }
  return "";
}

// ---- Project chat ----

export async function openMainView(page, view) {
  await page.getByRole("button", { name: `Open ${view}`, exact: true }).click();
}

export async function setChatMode(page, mode) {
  const button = page.getByRole("group", { name: "Project chat mode" }).getByRole("button", { name: mode, exact: true });
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
}

/** Sends one chat message and waits for the agent's reply to finish. */
export async function askAgent(page, text, { timeoutMs = 600_000 } = {}) {
  const replies = page.locator(".assistant-bubble");
  const before = await replies.count();
  const composer = page.getByRole("textbox", { name: /^Message / }).last();
  await composer.fill(text);
  await page.getByRole("button", { name: "Send message to the selected agent" }).click();
  await waitFor(async () => (await replies.count()) > before, "the agent's reply to appear", 60_000);
  const reply = replies.nth(before);
  await waitFor(async () => !(await reply.locator(".status-badge.status-streaming, .status-badge.status-queued").count()), "the agent to finish", timeoutMs, 2_000);
  const status = ((await reply.locator(".status-badge").getAttribute("class")) || "").match(/status-(\w+)/g)?.pop()?.slice(7) || "unknown";
  return { status, text: (await reply.locator(".msg-body").innerText()).trim() };
}

/** Closes whatever a failed step left open, so cleanups can use the window. */
export async function resetUi(page) {
  // A test build carries an old version, so the app offers an update; "Later" keeps the build.
  const later = page.getByRole("button", { name: "Later", exact: true });
  if (await later.isVisible().catch(() => false)) await later.click({ timeout: 5_000 }).catch(() => {});
  for (let i = 0; i < 3; i += 1) {
    const close = page.locator('.modal-overlay button[title="Close"], [role="dialog"] button[aria-label^="Close"], .modal-overlay button:has-text("Cancel")').first();
    if (await close.count() && await close.isVisible().catch(() => false)) await close.click({ timeout: 5_000 }).catch(() => {});
    else await page.keyboard.press("Escape").catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (!(await page.locator(".modal-overlay").count())) return;
  }
}

// ---- Waiting ----

export async function waitFor(check, what, timeoutMs = 30_000, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      if (!/Timeout|not attached|detached/i.test(String(error?.message))) throw error;
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)} s waiting for ${what}${last ? ` (${last.message})` : ""}`);
}

export const escape = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
