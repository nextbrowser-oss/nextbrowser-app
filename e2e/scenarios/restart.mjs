import { execFile } from "node:child_process";
import { blocked } from "../lib/blocked.mjs";
import { activeWorkspace, createProfile, createWorkspace, deleteCurrentWorkspace, profileNames, sidebar, switchWorkspace, waitFor } from "../lib/ui.mjs";
import { projectNames, reconnectApp } from "../lib/ui-workflows.mjs";

function shell(command, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile("bash", ["-c", command], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const output = `${stdout}${stderr}`.trim();
      if (error) reject(new Error(`E2E_RESTART_CMD failed: ${output.slice(-500) || error.message}`));
      else resolve(output);
    });
  });
}

/** The sidebar footer's agent status, e.g. "Claude Code · Connected". */
async function agentLabel(page) {
  return (await sidebar(page).getByRole("button", { name: "Open agent settings" }).innerText()).replace(/\s+/g, " ").trim();
}

/** The toggle offers the other theme. */
async function theme(page) {
  const label = await page.getByRole("button", { name: /^Switch to (light|dark) theme$/ }).getAttribute("aria-label");
  return label.includes("light") ? "dark" : "light";
}

async function setTheme(page, wanted) {
  if ((await theme(page)) !== wanted) await page.getByRole("button", { name: /^Switch to (light|dark) theme$/ }).click();
}

/** Reads the interface size in Settings ("110%"), stepping it towards `wanted` first when given. */
async function interfaceSize(page, wanted) {
  await page.getByRole("button", { name: /^Settings\b/ }).first().click();
  const settings = page.locator(".settings-modal");
  const value = async () => (await settings.locator(".ui-scale-value").innerText()).trim();
  try {
    for (let i = 0; i < 10 && wanted && (await value()) !== wanted; i += 1) {
      const step = parseInt(await value(), 10) < parseInt(wanted, 10) ? "Increase interface size" : "Decrease interface size";
      await settings.getByRole("button", { name: step }).click();
    }
    return await value();
  } finally {
    await page.getByRole("button", { name: "Close settings" }).click();
  }
}

/** A size one step away from the current one, whichever way is still allowed. */
async function otherInterfaceSize(page) {
  const current = parseInt(await interfaceSize(page), 10);
  return `${current >= 130 ? current - 10 : current + 10}%`;
}

async function snapshot(page) {
  return {
    workspace: await activeWorkspace(page),
    profiles: (await profileNames(page)).sort(),
    projects: (await projectNames(page)).sort(),
    agent: await agentLabel(page),
    theme: await theme(page),
    size: await interfaceSize(page),
  };
}

export default {
  id: "restart",
  title: "Restart",
  checklist: [
    "Shutdown app",
    "Open again. Check if all setup from the previous run, like the agent, is kept.",
  ],
  async run(s) {
    const restartCmd = s.run.env.restartCmd;
    const home = await activeWorkspace(s.page);
    const workspace = s.name("restart");
    const profile = s.name("Restart claw");
    const appearance = { theme: await theme(s.page), size: "" };
    let created = false;
    s.cleanup(async () => {
      await setTheme(s.page, appearance.theme).catch(() => {});
      if (appearance.size) await interfaceSize(s.page, appearance.size).catch(() => {});
      if (!created) return;
      await switchWorkspace(s.page, workspace).catch(() => {});
      if ((await activeWorkspace(s.page)) === workspace) await deleteCurrentWorkspace(s.page);
      await switchWorkspace(s.page, home);
    });

    // Changed settings and a new workspace show whether the app saved them,
    // not just that it starts with its defaults.
    const before = await s.step("Set up a workspace, a profile, the theme and the interface size", async () => {
      if (!restartCmd) blocked("E2E_RESTART_CMD is not set: the suite cannot quit and start the app");
      const agent = await agentLabel(s.page);
      if (!/Connected$/.test(agent)) blocked(`No agent is connected (${agent})`);
      await createWorkspace(s.page, workspace);
      created = true;
      await createProfile(s.page, { name: profile, connection: "none", toolset: "Clawbrowser" });
      appearance.size = await interfaceSize(s.page);
      await setTheme(s.page, appearance.theme === "dark" ? "light" : "dark");
      await interfaceSize(s.page, await otherInterfaceSize(s.page));
      const state = await snapshot(s.page);
      s.note(`Before the restart: ${JSON.stringify(state)}`);
      return state;
    });

    await s.step("Shut down the app (and start it again with E2E_RESTART_CMD)", async () => {
      const old = s.run.browser;
      const output = await shell(restartCmd, 300_000);
      if (output) s.note(`E2E_RESTART_CMD: ${output.slice(-300)}`);
      await waitFor(async () => !old.isConnected(), "the old window to close", 60_000, 1_000);
    });

    await s.step("Open again: the window comes back with the agent connected", async () => {
      await reconnectApp(s.run);
      await waitFor(async () => (await activeWorkspace(s.page)) !== "Create workspace", "the workspaces to load", 60_000);
      await waitFor(async () => (await profileNames(s.page)).length >= before.profiles.length, "the profiles to load", 60_000).catch(() => {});
      await s.shot("after restart");
    });

    const after = await s.step("Read the setup after the restart", async () => {
      const state = await snapshot(s.page);
      s.note(`After the restart: ${JSON.stringify(state)}`);
      return state;
    });

    const same = (what, key) => s.step(`Kept: ${what}`, async () => {
      if (!after) blocked("The setup after the restart was not read");
      const was = JSON.stringify(before[key]);
      const now = JSON.stringify(after[key]);
      if (was !== now) throw new Error(`${what} was ${was}, now ${now}`);
    }, { soft: true });
    await same("the agent and its connection", "agent");
    await same("the active workspace", "workspace");
    await same("the workspace's profiles", "profiles");
    await same("the workspace's projects", "projects");
    await same("the theme", "theme");
    await same("the interface size", "size");
  },
};
