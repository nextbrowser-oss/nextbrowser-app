import { blocked } from "../lib/blocked.mjs";
import { activeWorkspace, createWorkspace, deleteCurrentWorkspace, profileNames, sidebar, switchWorkspace, waitFor } from "../lib/ui.mjs";
import { accountLabel, createProject, projectNames, sleep, workspaceNames } from "../lib/ui-workflows.mjs";

// Signing in is a browser flow the suite cannot finish by itself. «Sign in»
// in the sidebar footer opens "Sign in to Nextbrowser": the app asks the
// backend for a pairing request (pairing_start) and opens its verification
// page in the default browser of the machine the app runs on. A person then,
// in that browser tab, signs in to the account (the second one, later the
// original one again) and approves «Nextbrowser Desktop». The app polls the
// request every 2 s and signs in on its own; the sidebar footer then shows
// the account's email. An expired or rejected request offers «Start again»,
// which this scenario presses, and the person signs in on the new page.
const SIGN_IN_WAIT_MS = 600_000;

const isEmail = (text) => /@/.test(text);

async function snapshot(page) {
  return {
    email: await accountLabel(page),
    workspaces: (await workspaceNames(page)).sort(),
    workspace: await activeWorkspace(page),
    profiles: (await profileNames(page)).sort(),
    projects: (await projectNames(page)).sort(),
  };
}

async function signOut(page) {
  await sidebar(page).getByRole("button", { name: "Sign out of Nextbrowser" }).click();
  // Sign-out first saves this account's state to the cloud.
  await waitFor(async () => {
    const error = sidebar(page).locator(".sidebar-account-error");
    if (await error.isVisible()) throw new Error(`Sign-out failed: ${(await error.innerText()).trim()}`);
    return sidebar(page).getByRole("button", { name: "Sign in", exact: true }).isVisible();
  }, "the app to sign out", 120_000, 1_000);
}

/** Starts the browser sign-in and waits for a person to finish it in that account. */
async function signInByHand(s, who, accepts) {
  await sidebar(s.page).getByRole("button", { name: "Sign in", exact: true }).click();
  const dialog = s.page.getByRole("dialog", { name: "Sign in to Nextbrowser" });
  console.log(`  account: sign in to ${who} in the browser page Nextbrowser just opened (up to ${SIGN_IN_WAIT_MS / 60_000} min)`);
  s.note(`A person signed in to ${who} in the browser; the suite waited up to ${SIGN_IN_WAIT_MS / 60_000} min`);
  let label = "";
  await waitFor(async () => {
    const again = dialog.getByRole("button", { name: "Start again" });
    if (await again.isVisible().catch(() => false)) await again.click();
    label = await accountLabel(s.page);
    return isEmail(label) && accepts(label);
  }, `a person to sign in to ${who}`, SIGN_IN_WAIT_MS, 3_000);
  // The account's workspaces load after the footer changes.
  await waitFor(async () => (await activeWorkspace(s.page)) !== "Create workspace", "the account's workspaces to load", 120_000, 1_000);
  await sleep(5_000);
  return label;
}

export default {
  id: "account",
  title: "Account",
  checklist: [
    "Logout",
    "Login to another account. Check that profiles, workspaces and projects are not the same as from the previous account",
  ],
  async run(s) {
    const second = s.run.env.secondAccount;
    const home = await activeWorkspace(s.page);
    const workspace = s.name("account");
    const project = s.name("account project");
    let first;
    let created = false;
    s.cleanup(async () => {
      const label = await accountLabel(s.page);
      if (first && label !== first.email) {
        s.note(`The sidebar shows «${label}» at the end, not ${first.email}: sign in to ${first.email} by hand and delete workspace «${workspace}»`);
        return;
      }
      if (!created) return;
      await switchWorkspace(s.page, workspace).catch(() => {});
      if ((await activeWorkspace(s.page)) === workspace) await deleteCurrentWorkspace(s.page);
      await switchWorkspace(s.page, home);
    });

    // A workspace and project made now cannot exist in another account, so
    // seeing them there means the accounts' data mixed.
    await s.step("Mark the first account with a new workspace and project", async () => {
      if (!second) blocked("E2E_SECOND_ACCOUNT is not set: a second account and a person to finish its browser sign-in are needed");
      await switchWorkspace(s.page, home);
      const homeState = { profiles: (await profileNames(s.page)).sort(), projects: (await projectNames(s.page)).sort() };
      await createWorkspace(s.page, workspace);
      created = true;
      await createProject(s.page, project);
      first = { ...(await snapshot(s.page)), home: homeState };
      if (!isEmail(first.email)) blocked(`The first account's email is not shown (${first.email})`);
      s.note(`First account: ${JSON.stringify(first)}`);
    });

    await s.step("Logout", async () => {
      await signOut(s.page);
      const label = await accountLabel(s.page);
      if (isEmail(label)) throw new Error(`The sidebar still shows ${label} after signing out`);
      const left = { workspaces: await workspaceNames(s.page), profiles: await profileNames(s.page), projects: await projectNames(s.page) };
      if (left.workspaces.length || left.profiles.length || left.projects.length) {
        throw new Error(`The signed-out window still lists ${JSON.stringify(left)}`);
      }
    });

    let other;
    await s.step("Login to another account (a person completes the browser sign-in)", async () => {
      const email = await signInByHand(s, /@/.test(second) ? second : "the second account", (label) => label !== first.email);
      if (/@/.test(second) && email.toLowerCase() !== second.toLowerCase()) throw new Error(`Signed in as ${email}, expected ${second}`);
      other = await snapshot(s.page);
      s.note(`Second account: ${JSON.stringify(other)}`);
      await s.shot("second account");
    });

    await s.step("The other account has its own workspaces and projects", async () => {
      if (!other) blocked("The second account did not sign in");
      if (other.workspaces.includes(workspace)) throw new Error(`The first account's workspace «${workspace}» is listed in ${other.email}`);
      if (other.projects.includes(project)) throw new Error(`The first account's project «${project}» is listed in ${other.email}`);
    });

    await s.step("The other account has none of the first account's profiles", async () => {
      if (!other) blocked("The second account did not sign in");
      const shared = other.profiles.filter((name) => first.home.profiles.includes(name));
      if (shared.length) throw new Error(`Profiles of the first account in ${other.email}: ${shared.join(", ")}`);
    }, { soft: true });

    await s.step("Sign out and back in to the first account: its setup is back", async () => {
      if (!other) blocked("The second account did not sign in");
      await signOut(s.page);
      await signInByHand(s, first.email, (label) => label.toLowerCase() === first.email.toLowerCase());
      const back = await snapshot(s.page);
      s.note(`First account again: ${JSON.stringify(back)}`);
      const missing = first.workspaces.filter((name) => !back.workspaces.includes(name));
      if (missing.length) throw new Error(`Workspaces missing after signing back in: ${missing.join(", ")}`);
      await switchWorkspace(s.page, home);
      const profiles = (await profileNames(s.page)).sort();
      if (profiles.join("|") !== first.home.profiles.join("|")) throw new Error(`«${home}» had ${first.home.profiles.join(", ")}, now ${profiles.join(", ")}`);
    });
  },
};
