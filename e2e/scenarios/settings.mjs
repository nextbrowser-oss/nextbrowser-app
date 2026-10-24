import { blocked } from "../lib/blocked.mjs";
import { nbc } from "../lib/oracle.mjs";
import { activeWorkspace, askAgent, createWorkspace, deleteCurrentWorkspace, escape, openMainView, setChatMode, sidebar, switchWorkspace, waitFor } from "../lib/ui.mjs";
import { appears, closeSettings, compareVersions, currentAgent, githubJSON, goBack, latestRelease, openSettings, parseBytes, pause, readUiScale, releaseBefore, semver, setUiScale, settingsDialog, settingsValue, sidebarLayout, sidebarProblems, themeToggle, uiScaleControl, urlOpenedBy } from "../lib/ui-settings.mjs";

const APP_REPOS = ["nextbrowser-oss/nextbrowser-app"];
// nextctl's own repository is private; the app installs nextctl from the
// public nbc_releases (NEXTCTL_RELEASE_BASE in electron/main.cjs).
const NEXTCTL_REPOS = ["nextbrowser-oss/nextctl", "nextbrowser-oss/nbc_releases"];
// UI_SCALE_MIN and UI_SCALE_MAX in src/App.tsx.
const UI_SCALES = [80, 130];
// The two agents the app treats as primary (PRIMARY_AGENTS in src/agents.ts),
// with what each calls itself.
const AGENT_WORDS = { "Claude Code": /\bclaude\b/i, Codex: /\bcodex\b/i };
const HOST = /^(\*\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(:\d{1,5})?$|^\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?$/i;

// formatStars in src/App.tsx.
const formatStars = (count) => (count < 1000 ? `${count}` : `${count < 10_000 ? Math.round(count / 100) / 10 : Math.round(count / 1000)}k`);

// The agent card in Settings (App.tsx) has no landmarks; its parts are found by class.
const agentCard = (page) => settingsDialog(page).locator(".settings-agent-card");
const agentGate = (page) => page.getByRole("dialog", { name: "Connect an agent to continue" });

async function agentState(page) {
  const card = agentCard(page);
  const error = card.locator(".settings-agent-error");
  return {
    name: (await card.getByRole("button", { name: "Choose active agent" }).locator("strong").innerText()).trim(),
    pill: (await card.locator(".agent-state-pill").innerText()).trim(),
    detail: (await card.locator(".settings-agent-picker-row > span.muted").innerText()).trim(),
    error: (await error.count()) ? (await error.innerText()).replace(/\s+/g, " ").trim() : "",
  };
}

/**
 * Makes `name` the active agent: from Settings' picker, or from the
 * "Connect an agent" gate when it covers the window (the app opens it while
 * the active agent is not ready, AgentConnectionGate.tsx).
 */
async function chooseAgent(page, name) {
  const gate = agentGate(page);
  if (await gate.isVisible().catch(() => false)) {
    const option = gate.getByRole("button", { name, exact: true });
    if (await option.count()) await option.click();
    else await gate.getByRole("combobox").selectOption({ label: name });
    await gate.getByRole("button", { name: new RegExp(`^(Connect|Sign in to) ${escape(name)}$`) }).click();
    return;
  }
  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "Choose active agent" }).click();
  await page.getByRole("listbox", { name: "Agents" }).getByRole("option", { name, exact: true }).click();
}

/** Waits until `name` is ready, or says why it will not be. */
async function agentOutcome(page, name, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let quietSince = 0;
  let state;
  while (Date.now() < deadline) {
    const gate = agentGate(page);
    const gateOpen = await gate.isVisible().catch(() => false);
    const gateError = gateOpen ? (await gate.locator(".agent-gate-error").innerText().catch(() => "")).replace(/\s+/g, " ").trim() : "";
    // Settings stays open under the gate; it is reopened only when nothing covers the button.
    if (!(await settingsDialog(page).count()) && !gateOpen) await openSettings(page);
    if (await settingsDialog(page).count()) state = await agentState(page);
    if (state?.name === name && state.pill === "Ready" && !gateOpen) return { ready: true, state };
    if (gateError || (state?.name === name && state.error)) return { ready: false, state, reason: gateError || state.error };
    const checking = await page.getByText(/^Checking…?$/).first().isVisible().catch(() => false);
    if (checking) quietSince = 0;
    else if (!quietSince) quietSince = Date.now();
    else if (Date.now() - quietSince > 60_000) return { ready: false, state, reason: `it stays «${state?.pill}»: ${state?.detail}` };
    await pause(1_000);
  }
  return { ready: false, state, reason: `it was still «${state?.pill}» after ${Math.round(timeoutMs / 1000)} s` };
}

/** Clicks a button that disables itself while it works, and waits for it to finish. */
async function clickAndSettle(button, what, timeoutMs) {
  await button.click();
  await waitFor(async () => button.isDisabled(), `${what} to start`, 5_000, 100).catch(() => {});
  await waitFor(async () => !(await button.isDisabled()), `${what} to finish`, timeoutMs, 1_000);
}

async function restoreAgent(page, name) {
  if ((await currentAgent(page)) === name && !(await agentGate(page).isVisible().catch(() => false))) return;
  await chooseAgent(page, name);
  await waitFor(async () => !(await agentGate(page).isVisible().catch(() => false)) && (await currentAgent(page)) === name, `${name} to be the active agent again`, 120_000, 1_000);
}

export default {
  id: "settings",
  title: "Settings",
  checklist: [
    "Check discord link",
    "Check GitHub stars link",
    "Check if inside settings correct version for nextbrowser, nextctl (should be from GitHub tag)",
    "Ask agent to downgrade nextctl and all toolset, then update via settings",
    "Use resize. Check if it looks fine",
    "Switch agent from settings. Check if new agent is really a new agent",
    "Pick proxy usage. Check if it reflects real proxy usage. If graph exists and check if domains make sense in the list",
  ],
  async run(s) {
    // Steps that talk to the agent do it in a workspace of their own, so no
    // project of the user's gets new messages; deleting it removes the rest.
    const scratch = { name: s.name("settings"), home: "", created: false };
    const useScratchWorkspace = async () => {
      if (scratch.created) return switchWorkspace(s.page, scratch.name);
      scratch.home = await activeWorkspace(s.page);
      await createWorkspace(s.page, scratch.name);
      scratch.created = true;
    };
    s.cleanup(async () => {
      if (!scratch.created) return;
      await closeSettings(s.page);
      await switchWorkspace(s.page, scratch.name).catch(() => {});
      if ((await activeWorkspace(s.page)) === scratch.name) await deleteCurrentWorkspace(s.page);
      await switchWorkspace(s.page, scratch.home);
    });

    await s.step("The Discord button opens a valid Discord invite", async () => {
      const url = await urlOpenedBy(s.page, () => s.page.getByRole("button", { name: "Join Nextbrowser on Discord" }).click());
      const parsed = new URL(url);
      const code = parsed.hostname === "discord.gg" ? parsed.pathname.slice(1) : parsed.pathname.match(/^\/invite\/([\w-]+)/)?.[1];
      if (!/^(www\.)?discord\.(com|gg)$/.test(parsed.hostname) || !code) throw new Error(`The button opens ${url}, not a Discord invite`);
      // Discord's public invite API tells a live invite from an expired one.
      const response = await fetch(`https://discord.com/api/v10/invites/${code}`, { signal: AbortSignal.timeout(20_000) });
      if (response.status === 429) {
        s.note(`The button opens ${url}; Discord rate-limited the invite check`);
        return;
      }
      if (response.status === 404) throw new Error(`The button opens ${url}, but Discord says invite ${code} is unknown or expired`);
      if (!response.ok) throw new Error(`Discord answered ${response.status} for invite ${code}`);
      const invite = await response.json();
      s.note(`The Discord button opens ${url}: server «${invite.guild?.name ?? "?"}», ${invite.expires_at ? `expires ${invite.expires_at}` : "does not expire"}.`);
    }, { soft: true });

    await s.step("The GitHub button opens the repository and shows its real star count", async () => {
      const button = s.page.getByRole("button", { name: "Star Nextbrowser on GitHub" });
      // The count shows "—" until the host answers (SocialButtons in App.tsx).
      await waitFor(async () => !(await button.innerText()).includes("—"), "the star count to load", 30_000).catch(() => {});
      const shown = (await button.innerText()).trim();
      const url = await urlOpenedBy(s.page, () => button.click());
      const parsed = new URL(url);
      const repo = parsed.pathname.replace(/^\/|\/$/g, "");
      if (parsed.hostname !== "github.com" || repo.split("/").length !== 2) throw new Error(`The button opens ${url}, not a GitHub repository`);
      const { stargazers_count: stars, full_name: fullName } = await githubJSON(`repos/${repo}`);
      s.note(`The GitHub button opens ${url} (${fullName}) and shows «${shown}»; GitHub counts ${stars} stars.`);
      if (shown.includes("—")) throw new Error("The star count never loaded");
      // The host caches the count for two minutes, so allow a few stars of drift.
      const near = new Set(Array.from({ length: 7 }, (_, i) => formatStars(Math.max(0, stars - 3 + i))));
      if (!near.has(shown)) throw new Error(`The button shows «${shown}» stars, GitHub has ${stars} («${formatStars(stars)}»)`);
    }, { soft: true });

    await s.step("Settings shows the released Nextbrowser and nextctl versions", async () => {
      try {
        await openSettings(s.page);
        const shown = { Nextbrowser: await settingsValue(s.page, "Nextbrowser"), nextctl: await settingsValue(s.page, "nextctl") };
        const update = (await settingsDialog(s.page).locator(".settings-update-row strong").first().innerText()).trim();
        await s.shot("versions");
        s.note(`Settings: Nextbrowser ${shown.Nextbrowser}, nextctl ${shown.nextctl}; App update: «${update}».`);
        const problems = [];
        for (const [name, repos] of [["Nextbrowser", APP_REPOS], ["nextctl", NEXTCTL_REPOS]]) {
          const version = semver(shown[name]);
          // A dev build shows `git describe` plus "(dev)" (vite.config.ts).
          if (!version || /\(dev\)|dirty|-\d+-g[0-9a-f]{6,}|not detected|not found|update required/i.test(shown[name]) || version.join(".") === "0.0.0") {
            problems.push(`${name} shows «${shown[name]}», not a released version`);
            continue;
          }
          const latest = await latestRelease(repos);
          const order = compareVersions(version, semver(latest.tag));
          s.note(`${name}: Settings ${shown[name]}, latest release ${latest.tag} in ${latest.repo}.`);
          if (order < 0) problems.push(`${name} ${shown[name]} is older than the latest release ${latest.tag}`);
          if (order > 0) s.note(`${name} ${shown[name]} is newer than the latest release ${latest.tag}: a release candidate?`);
        }
        if (/^Update to /.test(update)) s.note(`Settings offers an app update: «${update}».`);
        if (problems.length) throw new Error(problems.join("; "));
      } finally {
        await closeSettings(s.page);
      }
    }, { soft: true });

    await s.step("Interface size: the smallest and largest sizes look fine, then back", async () => {
      const { where, control } = await uiScaleControl(s.page);
      const original = await readUiScale(control);
      s.cleanup(async () => {
        const { control: again } = await uiScaleControl(s.page);
        await setUiScale(again, original);
        await closeSettings(s.page);
      });
      const base = await s.page.evaluate(() => window.innerWidth);
      s.note(`Interface size control in ${where}, at ${original}%.`);
      const problems = [];
      for (const percent of UI_SCALES) {
        await setUiScale(control, percent);
        await pause(500);
        const view = await s.page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, scrollWidth: document.documentElement.scrollWidth }));
        // Electron's page zoom (app_set_zoom_factor) shrinks or grows the CSS viewport by the same factor.
        const expected = Math.round((base * original) / percent);
        if (Math.abs(view.width - expected) > expected * 0.04) problems.push(`at ${percent}% the page is ${view.width} px wide, expected about ${expected}: the size did not apply`);
        if (view.scrollWidth > view.width + 1) problems.push(`at ${percent}% the window scrolls sideways (${view.scrollWidth} > ${view.width} px)`);
        for (const [label, locator] of [["Settings", s.page.getByRole("button", { name: /^Settings(, update available)?$/ })], ["theme", themeToggle(s.page)], ["Project tab", s.page.getByRole("button", { name: "Open Project", exact: true })]]) {
          const box = await locator.boundingBox();
          if (!box || box.x + box.width > view.width + 1 || box.y + box.height > view.height + 1) problems.push(`at ${percent}% the ${label} button is off screen`);
        }
        problems.push(...sidebarProblems(await sidebarLayout(s.page)).map((problem) => `at ${percent}%: ${problem}`));
        await s.shot(`interface ${percent}%`);
      }
      await setUiScale(control, original);
      if (problems.length) throw new Error(problems.join("; "));
    }, { soft: true });

    const agents = await s.step("Switch the agent from Settings", async () => {
      await useScratchWorkspace();
      await openSettings(s.page);
      const before = await agentState(s.page);
      const target = before.name === "Codex" ? "Claude Code" : "Codex";
      s.cleanup(async () => {
        await restoreAgent(s.page, before.name);
        await closeSettings(s.page);
      });
      await chooseAgent(s.page, target);
      const outcome = await agentOutcome(s.page, target);
      if (!outcome.ready) {
        await restoreAgent(s.page, before.name);
        blocked(`Only ${before.name} is connected on this computer: ${target} is not usable, ${outcome.reason}`);
      }
      const after = outcome.state;
      await s.shot(`agent ${target}`);
      s.note(`Agent: ${before.name} (${before.detail}) → ${after.name} (${after.detail}).`);
      if (after.detail === before.detail) throw new Error(`Settings shows the same «${after.detail}» for ${before.name} and ${target}`);
      await closeSettings(s.page);
      const footer = await currentAgent(s.page);
      if (footer !== target) throw new Error(`The sidebar still names ${footer} as the agent`);
      return { before: before.name, target };
    }, { soft: true });

    await s.step("The new agent answers as itself", async () => {
      if (!agents) blocked("The agent was not switched");
      await openMainView(s.page, "Project");
      await setChatMode(s.page, "Chat");
      const reply = await askAgent(s.page, "Which coding agent CLI are you running as, Claude Code or Codex? Answer with the name only and do not use any tools.", { timeoutMs: 300_000 });
      s.note(`${agents.target} replied (${reply.status}): «${reply.text.slice(0, 200)}»`);
      if (reply.status !== "done") throw new Error(`The reply ended ${reply.status}: ${reply.text.slice(0, 300)}`);
      if (!AGENT_WORDS[agents.target].test(reply.text)) throw new Error(`The reply does not name ${agents.target}: «${reply.text.slice(0, 200)}»`);
      if (AGENT_WORDS[agents.before]?.test(reply.text)) s.note(`The reply also names ${agents.before}.`);
    }, { soft: true });

    await s.step("Switch back to the first agent", async () => {
      if (!agents) return;
      await restoreAgent(s.page, agents.before);
      await closeSettings(s.page);
    }, { soft: true });

    const usage = await s.step("Proxy usage opens from Settings and repeats its numbers", async () => {
      const settings = await openSettings(s.page);
      const link = settings.getByRole("button", { name: /^Proxy usage/ });
      const summary = (await link.innerText()).replace(/\s+/g, " ").trim();
      await link.click();
      await s.page.getByRole("heading", { name: "Proxy usage" }).waitFor({ timeout: 15_000 });
      s.cleanup(async () => {
        if (await s.page.getByRole("heading", { name: "Proxy usage" }).isVisible().catch(() => false)) await goBack(s.page);
      });
      await s.page.getByText("Loading usage history…").waitFor({ state: "detached", timeout: 60_000 }).catch(() => {});
      // The allocation line of UsageView.tsx has no role of its own.
      const allocation = (await s.page.locator(".proxy-usage-current-title").innerText()).replace(/\s+/g, " ").trim();
      s.note(`Settings: «${summary}»; usage page: «${allocation}».`);
      const settingsUsed = summary.match(/([\d.]+ (?:B|KiB|MiB|GiB|TiB)) \//)?.[1];
      const pageUsed = allocation.match(/^([\d.]+ (?:B|KiB|MiB|GiB|TiB))/)?.[1];
      if (!pageUsed) blocked(`The usage page shows no allocation: «${allocation}»`);
      if (settingsUsed && settingsUsed !== pageUsed) throw new Error(`Settings says ${settingsUsed} used, the usage page ${pageUsed}`);
      return { used: pageUsed };
    }, { soft: true });

    await s.step("The used traffic matches what nextctl reports for the account", async () => {
      if (!usage) blocked("The usage page did not open");
      const data = await nbc(s.run.env.nbcCmd, ["proxy-traffic", "--format", "json"]);
      const real = Number(data?.proxy_traffic?.used_bytes);
      if (!Number.isFinite(real)) throw new Error(`nbc proxy-traffic gave no used_bytes: ${JSON.stringify(data).slice(0, 300)}`);
      const shown = parseBytes(usage.used);
      // humanBytes rounds to one decimal of its unit; traffic may also grow a little meanwhile.
      const unit = 1024 ** Math.max(0, Math.floor(Math.log(Math.max(real, 1)) / Math.log(1024)));
      const slack = unit * 0.1 + real * 0.02;
      s.note(`The page shows ${usage.used} (${Math.round(shown)} B); nextctl reports ${real} B.`);
      if (Math.abs(shown - real) > slack) throw new Error(`The page shows ${usage.used}, nextctl reports ${real} B`);
    }, { soft: true });

    const hasHistory = await s.step("The traffic graph is drawn", async () => {
      if (!usage) blocked("The usage page did not open");
      const chart = s.page.getByRole("img", { name: "Proxy traffic trend by date" });
      for (const range of [null, "30 days", "90 days"]) {
        if (range) {
          await s.page.getByRole("group", { name: "Usage range" }).getByRole("button", { name: range, exact: true }).click();
          await s.page.getByText("Loading usage history…").waitFor({ state: "detached", timeout: 60_000 }).catch(() => {});
        }
        if (await chart.isVisible().catch(() => false)) break;
      }
      if (!(await chart.isVisible().catch(() => false))) blocked("No proxy traffic recorded in the last 90 days, so there is no graph or domain list");
      const box = await chart.boundingBox();
      if (!box || box.width < 200 || box.height < 60) throw new Error(`The graph is ${Math.round(box?.width ?? 0)}×${Math.round(box?.height ?? 0)} px`);
      await s.shot("proxy usage");
      return true;
    }, { soft: true });

    await s.step("The domain list holds host names and adds up", async () => {
      if (!hasHistory) blocked("No traffic history to list domains for");
      const table = s.page.getByRole("table");
      if (!(await table.count())) blocked("The usage page lists no domains for this range");
      const rows = [];
      for (const row of (await table.getByRole("row").all()).slice(1)) {
        const cells = (await row.getByRole("cell").allInnerTexts()).map((text) => text.trim());
        rows.push({ domain: cells[1], bytes: parseBytes(cells[2]), requests: Number(cells[3].replace(/[^\d]/g, "")) });
      }
      const total = parseBytes(await s.page.getByText("Traffic in range", { exact: true }).locator("xpath=following-sibling::strong").innerText());
      s.note(`Top domains: ${rows.slice(0, 8).map((row) => row.domain).join(", ")}${rows.length > 8 ? ` and ${rows.length - 8} more` : ""}.`);
      const problems = [];
      const odd = rows.filter((row) => !HOST.test(row.domain || ""));
      if (odd.length) problems.push(`not host names: ${odd.map((row) => `«${row.domain}»`).join(", ")}`);
      const sum = rows.reduce((acc, row) => acc + (Number.isFinite(row.bytes) ? row.bytes : 0), 0);
      if (Number.isFinite(total) && sum > total * 1.1 + 1024) problems.push(`the listed domains add up to ${Math.round(sum)} B, more than the ${Math.round(total)} B in range`);
      if (rows.some((row) => row.bytes > 0 && row.requests === 0)) problems.push("a domain has traffic but no requests");
      if (problems.length) throw new Error(problems.join("; "));
    }, { soft: true });

    await s.step("Leave the usage page", async () => {
      if (await s.page.getByRole("heading", { name: "Proxy usage" }).isVisible().catch(() => false)) await goBack(s.page);
    }, { soft: true });

    await s.step("Downgrade nextctl and the toolsets through the agent, then update them from the app", async () => {
      if (process.env.E2E_ALLOW_DOWNGRADE !== "1") blocked("Destructive: set E2E_ALLOW_DOWNGRADE=1 to let the agent install an older nextctl and older browser toolsets");
      const latest = await latestRelease(NEXTCTL_REPOS);
      const previous = await releaseBefore(latest.repo, latest.tag);
      if (!previous) blocked(`No release before ${latest.tag} in ${latest.repo}`);
      await useScratchWorkspace();
      await openMainView(s.page, "Project");
      await setChatMode(s.page, "Chat");
      const reply = await askAgent(s.page, [
        `Downgrade nextctl on this computer to ${previous}: install the release assets from https://github.com/${latest.repo}/releases/tag/${previous}`,
        "over the nextctl binary the Nextbrowser app runs (the one `nbc --version` and `nextctl --version` resolve to).",
        "Then downgrade every installed browser toolset (Clawbrowser, Camoufox, DasBrowser) to its previous release.",
        "Change nothing else. Finish by printing the nextctl version and each toolset's version.",
      ].join(" "), { timeoutMs: 30 * 60_000 });
      s.note(`Downgrade reply (${reply.status}): «${reply.text.slice(0, 400)}»`);
      if (reply.status !== "done") throw new Error(`The agent's downgrade ended ${reply.status}`);

      // The app reads nextctl's version at start-up and after its own update.
      await s.run.refresh();
      // At start-up the app may offer the toolset updates itself; this step takes them from Settings.
      const offer = s.page.getByRole("dialog", { name: "Browser toolset update available" });
      if (await appears(offer)) await offer.getByRole("button", { name: "Later", exact: true }).click();
      await openSettings(s.page);
      const downgraded = await settingsValue(s.page, "nextctl");
      s.note(`After the downgrade Settings shows nextctl ${downgraded}.`);
      if (compareVersions(semver(downgraded) ?? [0, 0, 0], semver(previous)) !== 0) s.note(`Settings does not show ${previous}: the agent's downgrade did not take or nextctl updated itself.`);
      await closeSettings(s.page);

      // nextctl updates from the sidebar footer (Sidebar.tsx), not from
      // Settings. The button is named by its last error when it has one.
      const updateNextctl = sidebar(s.page).locator(".nextctl-refresh");
      await clickAndSettle(updateNextctl, "the nextctl update", 15 * 60_000);
      const nextctlError = await updateNextctl.getAttribute("aria-label");
      if (nextctlError !== "Check for a newer nextctl and update") throw new Error(`The nextctl update failed: ${nextctlError}`);

      // Toolsets update from Settings: each row offers "Update", which asks to confirm.
      const settings = await openSettings(s.page);
      const check = settings.getByRole("button", { name: "Check browser toolset updates" });
      await clickAndSettle(check, "the toolset check", 120_000);
      for (let round = 0; round < 4; round += 1) {
        const update = settings.locator(".settings-runtime-row").getByRole("button", { name: "Update", exact: true }).first();
        if (!(await update.count())) break;
        await update.click();
        await s.page.getByRole("dialog", { name: "Browser toolset update available" }).getByRole("button", { name: /^Update (now|\d+ toolsets)$/ }).click();
        const closeProfiles = s.page.getByRole("button", { name: "Continue the update" });
        if (await appears(closeProfiles, 3_000)) await closeProfiles.click();
        const progress = s.page.getByRole("status").filter({ hasText: /^(Updating |Update failed|Update partly complete|Browser toolsets updated)/ });
        await waitFor(async () => /Update failed|Update partly complete|Browser toolsets updated/.test(await progress.first().innerText().catch(() => "")), "the toolset update to finish", 20 * 60_000, 3_000);
        const result = (await progress.first().innerText()).replace(/\s+/g, " ").trim();
        if (!/Browser toolsets updated/.test(result)) throw new Error(`Toolset update: ${result.slice(0, 400)}`);
        await s.page.getByRole("button", { name: "Dismiss update status" }).click().catch(() => {});
        await clickAndSettle(check, "the toolset check", 120_000);
      }
      const rows = (await settings.locator(".settings-runtime-row").allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim());
      const nextctl = await settingsValue(s.page, "nextctl");
      s.note(`After updating: nextctl ${nextctl}; toolsets: ${rows.join("; ")}.`);
      await s.shot("after update");
      const problems = [];
      if (compareVersions(semver(nextctl) ?? [0, 0, 0], semver(latest.tag)) < 0) problems.push(`nextctl is ${nextctl}, the latest release is ${latest.tag}`);
      const stale = rows.filter((row) => / → /.test(row));
      if (stale.length) problems.push(`toolsets still behind: ${stale.join("; ")}`);
      await closeSettings(s.page);
      if (problems.length) throw new Error(problems.join("; "));
    }, { soft: true });
  },
};
