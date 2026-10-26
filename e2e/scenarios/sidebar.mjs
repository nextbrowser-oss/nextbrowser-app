import { blocked } from "../lib/blocked.mjs";
import { profileNames, sectionCount, sidebar, waitFor } from "../lib/ui.mjs";
import { goBack, openSection, openSidebarPage, sectionToggle, setOpenSection, setSidebarCollapsed, sidebarCollapsed, sidebarLayout, sidebarProblems, windowSizer } from "../lib/ui-settings.mjs";

// The window's minimum size (BrowserWindow minWidth/minHeight in
// electron/main.cjs) and the largest size checked.
const SMALL = { width: 960, height: 640 };
const LARGE_MAX = { width: 1920, height: 1200 };
// A list row (.workspace-chat-row, .profile-row) is about 30 px high.
const ROW_PX = 28;

const sidebarWidth = async (page) => Math.round((await sidebar(page).boundingBox()).width);

export default {
  id: "sidebar",
  title: "Sidebar",
  checklist: [
    "Toggle side bar. Check if it works",
    "Change size of your screen. Check if you can read Profiles and Projects. If you toggle projects it should untangle profiles and the other way also.",
  ],
  async run(s) {
    const original = await s.step("Remember the sidebar as it is", async () => {
      const collapsed = await sidebarCollapsed(s.page);
      if (collapsed) await setSidebarCollapsed(s.page, false);
      if (await sectionToggle(s.page, "projects").isDisabled()) blocked("The sidebar search has text, which keeps both lists open and their toggles disabled");
      return {
        collapsed,
        section: await openSection(s.page),
        width: await sidebarWidth(s.page),
        profiles: await sectionCount(s.page, "profiles"),
        projects: await sectionCount(s.page, "projects"),
      };
    });
    s.cleanup(async () => {
      if (!original) return;
      await setSidebarCollapsed(s.page, false);
      await setOpenSection(s.page, original.section);
      await setSidebarCollapsed(s.page, original.collapsed);
    });

    let listed = [];
    await s.step("Collapse the sidebar: it becomes a narrow rail", async () => {
      await setOpenSection(s.page, "profiles");
      listed = await profileNames(s.page);
      await setSidebarCollapsed(s.page, true);
      const width = await sidebarWidth(s.page);
      if (width > 80) throw new Error(`The collapsed sidebar is ${width} px wide, expected the 68 px rail`);
      if (await sidebar(s.page).getByRole("navigation", { name: "Sidebar pages" }).count()) throw new Error("The full sidebar is still shown");
      const summary = sidebar(s.page).getByRole("button", { name: /^\d+ profiles, \d+ running$/ });
      await summary.waitFor({ timeout: 5_000 });
      s.note(`The rail says «${await summary.getAttribute("aria-label")}»; the open sidebar listed ${listed.length} profiles.`);
      await s.shot("collapsed");
    });

    await s.step("The rail's buttons work: Guide opens from it", async () => {
      const guide = s.page.getByRole("heading", { name: "Get started" });
      const wasOpen = await guide.isVisible().catch(() => false);
      await openSidebarPage(s.page, "Guide");
      await guide.waitFor({ timeout: 10_000 });
      if (!wasOpen) await goBack(s.page);
    });

    await s.step("Expand the sidebar: its width, open list and profiles come back", async () => {
      await setSidebarCollapsed(s.page, false);
      await waitFor(async () => Math.abs((await sidebarWidth(s.page)) - original.width) <= 2, `the sidebar to return to ${original.width} px`, 5_000, 100);
      if ((await openSection(s.page)) !== "profiles") throw new Error("The sidebar forgot that Profiles was open");
      const names = await profileNames(s.page);
      if (names.join("|") !== listed.join("|")) throw new Error(`Profiles before collapsing: ${listed.join(", ")}; after expanding: ${names.join(", ")}`);
      await s.shot("expanded");
    });

    await s.step("Opening one list closes the other", async () => {
      await setOpenSection(s.page, "projects");
      if ((await sectionToggle(s.page, "profiles").getAttribute("aria-expanded")) !== "false") throw new Error("Profiles stayed open after opening Projects");
      await setOpenSection(s.page, "profiles");
      if ((await sectionToggle(s.page, "projects").getAttribute("aria-expanded")) !== "false") throw new Error("Projects stayed open after opening Profiles");
      await setOpenSection(s.page, null);
    });

    const sizer = await s.step("Take control of the window size", async () => {
      const sizer = await windowSizer(s.page);
      s.cleanup(() => sizer.restore());
      if (sizer.mode === "window") s.note(`The window was ${sizer.original.width}×${sizer.original.height} (${sizer.original.windowState}).`);
      else s.note("Electron does not offer Browser.getWindowForTarget over CDP, so the sizes below are an emulated viewport, not a resized window.");
      return sizer;
    });

    const large = {
      width: Math.min(LARGE_MAX.width, Math.max(1280, sizer?.screen.width ?? 0)),
      height: Math.min(LARGE_MAX.height, Math.max(800, sizer?.screen.height ?? 0)),
    };
    for (const [label, size] of [["smallest", SMALL], ["large", large]]) {
      await s.step(`At the ${label} size (${size.width}×${size.height}) both lists are readable`, async () => {
        const inner = await sizer.resize(size.width, size.height);
        const problems = [];
        for (const section of ["projects", "profiles"]) {
          await setOpenSection(s.page, section);
          const layout = await sidebarLayout(s.page);
          const other = section === "projects" ? "profiles" : "projects";
          const count = original[section];
          if (count > 0 && layout.lists[section] < ROW_PX) problems.push(`${section}: the open list gets ${layout.lists[section]} px, less than one row`);
          // A closed list keeps its 1-2 px border.
          if (layout.lists[other] > 4) problems.push(`${section}: the closed ${other} list still takes ${layout.lists[other]} px`);
          if (count > 0 && !layout.names.some((name) => `${name.kind}s` === section)) problems.push(`${section}: no name is visible although the counter says ${count}`);
          problems.push(...sidebarProblems(layout).map((problem) => `${section}: ${problem}`));
          const cut = layout.names.filter((name) => name.cut).length;
          s.note(`${label} ${inner.width}×${inner.height}, ${section} open: ${layout.names.length} names visible (${cut} end in an ellipsis), the list gets ${layout.lists[section]} px.`);
          await s.shot(`${label} ${section}`);
        }
        if (problems.length) throw new Error([...new Set(problems)].join("; "));
      }, { soft: true });
    }

    await s.step("Put the window back", () => sizer?.restore(), { soft: true });
  },
};
