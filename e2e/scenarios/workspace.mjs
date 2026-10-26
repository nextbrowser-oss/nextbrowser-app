import { activeWorkspace, createWorkspace, deleteCurrentWorkspace, profileNames, sectionCount, sidebar, switchWorkspace, waitFor } from "../lib/ui.mjs";

export default {
  id: "workspace",
  title: "Workspace",
  checklist: [
    "Create one more Workspace (0 profiles and 0 projects inside, nothing shared between workspaces)",
    "Switch workspace (all profiles in workspaces should be consistent)",
    "Delete new workspace (should be deleted)",
  ],
  async run(s) {
    const original = await s.step("Remember the current workspace", async () => ({
      name: await activeWorkspace(s.page),
      profiles: await profileNames(s.page),
      projects: await sectionCount(s.page, "projects"),
    }));
    const name = s.name("workspace");
    let created = false;
    s.cleanup(async () => {
      if (!created) return;
      await switchWorkspace(s.page, name).catch(() => {});
      if ((await activeWorkspace(s.page)) === name) await deleteCurrentWorkspace(s.page);
      await switchWorkspace(s.page, original.name);
    });

    await s.step("Create a workspace", async () => {
      await createWorkspace(s.page, name);
      created = true;
    });
    await s.step("The new workspace has 0 profiles and 0 projects", async () => {
      const profiles = await profileNames(s.page);
      const projects = await sectionCount(s.page, "projects");
      if (profiles.length || projects) throw new Error(`Expected an empty workspace, found ${profiles.length} profiles (${profiles.join(", ")}) and ${projects} projects`);
    });
    await s.step("Switch back: the first workspace keeps its profiles and projects", async () => {
      await switchWorkspace(s.page, original.name);
      await waitFor(async () => (await profileNames(s.page)).length === original.profiles.length, "the profile list to load");
      const profiles = await profileNames(s.page);
      const projects = await sectionCount(s.page, "projects");
      if (profiles.join("|") !== original.profiles.join("|")) throw new Error(`Profiles changed: was ${original.profiles.join(", ")}, now ${profiles.join(", ")}`);
      if (projects !== original.projects) throw new Error(`Projects changed: was ${original.projects}, now ${projects}`);
    });
    await s.step("Switch to the new workspace again: still empty", async () => {
      await switchWorkspace(s.page, name);
      const profiles = await profileNames(s.page);
      if (profiles.length) throw new Error(`Profiles leaked into the new workspace: ${profiles.join(", ")}`);
    });
    await s.step("Delete the new workspace", async () => {
      await deleteCurrentWorkspace(s.page);
      created = false;
      const picker = sidebar(s.page).locator(".workspace-picker");
      await picker.click();
      const listed = await s.page.locator(".workspace-menu-list button", { hasText: name }).count();
      await picker.click();
      if (listed) throw new Error("The deleted workspace is still listed");
    });
    await s.step("The app is back in a remaining workspace", async () => {
      await switchWorkspace(s.page, original.name);
      const profiles = await profileNames(s.page);
      if (profiles.join("|") !== original.profiles.join("|")) throw new Error(`Profiles changed after deletion: ${profiles.join(", ")}`);
    });
  },
};
