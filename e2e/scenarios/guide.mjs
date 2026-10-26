import { blocked } from "../lib/blocked.mjs";
import { openMainView, setChatMode, sidebar } from "../lib/ui.mjs";
import { appears, closeSettings, goBack, openSection, openSidebarPage, pause, probeUrl, setOpenSection, setSidebarCollapsed, settingsDialog, sidebarCollapsed } from "../lib/ui-settings.mjs";

// The chat composer (ChatView.tsx) when an agent is connected.
const COMPOSER = /^Message .+ — Enter to queue$/;

// Where each Guide action lands (runAction in GuideView.tsx, openDemo in
// GuideUsageDemos.tsx), keyed by the label of the button that confirms it.
const LANDING = {
  "View usage": "usage",
  "Open Live Streaming": "live",
  "Open Live": "live",
  "Open Chat": "chat",
  "Open Skills": "skills",
  "Browse skills": "skills",
  "Open schedules": "scheduled",
  "Show profiles": "profiles",
  "Open profile actions": "profileActions",
  "Create profile": "profileCreator",
  "Choose agent": "settings",
  "Open agent settings": "settings",
  "Prepare in Chat": "draft",
};
// Confirming these would start a browser or ask for an account key, so the
// scenario checks their confirmation and cancels.
const NOT_CONFIRMED = { "Start profile": "it would start a browser profile", "Connect account": "it asks for an account key" };

const VIEWS = {
  usage: { what: "Proxy usage", locate: (page) => page.getByRole("heading", { name: "Proxy usage" }) },
  live: { what: "Live", locate: (page) => page.getByRole("combobox", { name: "Choose profile to stream" }) },
  chat: { what: "the project chat in Chat mode", locate: (page) => page.getByRole("group", { name: "Project chat mode" }).getByRole("button", { name: "Chat", exact: true, pressed: true }) },
  draft: { what: "a drafted chat message", locate: (page) => page.getByPlaceholder(COMPOSER) },
  skills: { what: "Skills", locate: (page) => sidebar(page).getByRole("navigation", { name: "Sidebar pages" }).getByRole("button", { name: /^Skills\b/ }).and(page.locator('[aria-current="page"]')) },
  scheduled: { what: "Scheduled runs", locate: (page) => page.getByRole("heading", { name: "Scheduled runs" }) },
  settings: { what: "agent settings", locate: (page) => settingsDialog(page).getByRole("button", { name: "Choose active agent" }) },
  profiles: { what: "the open Profiles list", locate: (page) => sidebar(page).getByRole("button", { name: "Collapse profiles", exact: true }) },
  profileActions: { what: "profile actions", locate: (page) => page.getByRole("dialog", { name: /^Profile actions for / }) },
  profileCreator: { what: "Create profile", locate: (page) => page.getByRole("dialog", { name: "Create profile" }) },
};

const guideHeading = (page) => page.getByRole("heading", { name: "Get started" });

async function backToGuide(page) {
  if (await guideHeading(page).isVisible().catch(() => false)) return;
  if (!(await goBack(page)) || !(await appears(guideHeading(page), 2_000))) await openSidebarPage(page, "Guide");
  await guideHeading(page).waitFor({ timeout: 10_000 });
}

/** Leaves whatever an action opened on top of the Guide. */
async function closeLanding(page, landing) {
  if (landing === "settings") await closeSettings(page);
  if (landing === "profileActions") await VIEWS.profileActions.locate(page).getByRole("button", { name: "Close", exact: true }).first().click().catch(() => {});
  if (landing === "profileCreator") await VIEWS.profileCreator.locate(page).getByRole("button", { name: "Close profile creation" }).click().catch(() => {});
}

export default {
  id: "guide",
  title: "Guide",
  checklist: [
    "Check if all 'Get started' steps passed",
    "Check if all links work (Agent section, Tools, Browser, Examples)",
  ],
  async run(s) {
    const composer = () => s.page.getByPlaceholder(COMPOSER);
    const drafted = [];

    const start = await s.step("Open the Guide", async () => {
      // The chat stays mounted but hidden on other views (persistent-tab-panel in App.tsx).
      const chatMode = s.page.getByRole("group", { name: "Project chat mode", includeHidden: true }).getByRole("button", { name: "Terminal", exact: true, includeHidden: true });
      const state = {
        collapsed: await sidebarCollapsed(s.page),
        section: await setSidebarCollapsed(s.page, false).then(() => openSection(s.page)),
        terminal: (await chatMode.count()) ? (await chatMode.getAttribute("aria-pressed")) === "true" : undefined,
        draft: (await composer().count()) ? await composer().inputValue() : undefined,
        tab: "Guide",
      };
      if (!(await guideHeading(s.page).isVisible().catch(() => false))) {
        await openSidebarPage(s.page, "Guide");
        await guideHeading(s.page).waitFor({ timeout: 10_000 });
        const back = s.page.getByRole("button", { name: /^Back to / });
        if (await back.count()) state.tab = (await back.getAttribute("aria-label")).replace(/^Back to /, "");
      }
      await s.shot("guide");
      return state;
    });
    s.cleanup(async () => {
      if (!start) return;
      await closeLanding(s.page, "settings");
      // Examples put a draft in the chat composer and switch the project to
      // Chat mode (setTerminalChat in GuideView.tsx); put both back.
      if (drafted.length || start.terminal !== undefined) {
        await openMainView(s.page, "Project");
        if (drafted.length && (await composer().isVisible().catch(() => false))) await composer().fill(start.draft ?? "");
        if (start.terminal !== undefined) await setChatMode(s.page, start.terminal ? "Terminal" : "Chat");
      }
      await setSidebarCollapsed(s.page, false);
      await setOpenSection(s.page, start.section);
      await setSidebarCollapsed(s.page, start.collapsed);
      if (start.tab === "Chat") await openMainView(s.page, "Project");
      else if (["Live", "Automation"].includes(start.tab)) await openMainView(s.page, start.tab);
      else if (["Skills", "Connectors", "Scheduled", "Guide"].includes(start.tab)) await openSidebarPage(s.page, start.tab);
      else s.note(`The window was on ${start.tab}; it is left on the Guide.`);
    });

    await s.step("All «Get started» steps are complete", async () => {
      const region = s.page.getByRole("region", { name: "Get started" });
      const steps = [];
      for (const step of await region.getByRole("button").all()) {
        steps.push({ label: await step.getAttribute("aria-label"), state: await step.getAttribute("data-step-state") });
      }
      s.note(`Get started: ${steps.map((step) => `${step.label} (${step.state})`).join("; ")}`);
      if (steps.length !== 4) throw new Error(`Expected 4 steps, found ${steps.length}`);
      const open = steps.filter((step) => step.state !== "complete");
      if (open.length) throw new Error(`Not complete: ${open.map((step) => `«${step.label}» is ${step.state}`).join("; ")}`);
    }, { soft: true });

    /**
     * Clicks a Guide control, checks the confirmation it asks for, confirms
     * and checks where the app lands.
     */
    const follow = async (trigger) => {
      await backToGuide(s.page);
      // Start from the Projects list, so an action that should open Profiles has to.
      await setOpenSection(s.page, "projects").catch(() => {});
      await trigger().click();
      const dialog = s.page.getByRole("dialog").filter({ has: s.page.getByRole("button", { name: "Cancel", exact: true }) }).last();
      await dialog.waitFor({ timeout: 5_000 });
      const confirm = dialog.getByRole("button").filter({ hasNotText: /^Cancel$/ }).first();
      const label = (await confirm.innerText()).trim();
      if (NOT_CONFIRMED[label]) {
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
        s.note(`«${label}» asked for confirmation and was cancelled: ${NOT_CONFIRMED[label]}`);
        return;
      }
      const landing = LANDING[label];
      if (!landing) throw new Error(`The Guide offers «${label}», which this scenario does not know`);
      const before = landing === "draft" && (await composer().count()) ? await composer().inputValue() : "";
      await confirm.click();
      await dialog.waitFor({ state: "detached", timeout: 5_000 });
      try {
        if (landing === "profileActions" && !(await appears(VIEWS.profileActions.locate(s.page)))) {
          // Without a named profile to act on, the action only opens the list (openActions in Sidebar.tsx).
          await VIEWS.profiles.locate(s.page).waitFor({ timeout: 5_000 });
          s.note(`«${label}» opened the Profiles list: no named profile to show actions for`);
          return;
        }
        await VIEWS[landing].locate(s.page).waitFor({ timeout: 10_000 });
        if (landing === "draft") {
          const text = (await composer().inputValue()).trim();
          if (!text || text === before.trim()) throw new Error("The chat composer did not receive the example's draft");
          drafted.push(text);
          s.note(`Draft: «${text.slice(0, 90)}…»`);
        }
        await s.shot(label);
      } finally {
        await closeLanding(s.page, landing);
        await pause(200);
      }
    };

    const quickSteps = await s.step("List the «Get started» steps", async () => {
      const labels = [];
      for (const step of await s.page.getByRole("region", { name: "Get started" }).getByRole("button").all()) {
        labels.push({ label: await step.getAttribute("aria-label"), locked: await step.isDisabled() });
      }
      return labels;
    }) ?? [];
    for (const [index, step] of quickSteps.entries()) {
      await s.step(`Get started ${index + 1}: «${step.label}»`, async () => {
        if (step.locked) blocked("The step is locked until an earlier one is done");
        await follow(() => s.page.getByRole("region", { name: "Get started" }).getByRole("button").nth(index));
      }, { soft: true });
    }

    for (const group of ["Browser", "Agent", "Tools"]) {
      const cards = await s.step(`List the «${group}» cards`, async () => {
        const labels = [];
        await backToGuide(s.page);
        for (const card of await s.page.getByRole("region", { name: group, exact: true }).getByRole("button").all()) labels.push(await card.getAttribute("aria-label"));
        if (!labels.length) throw new Error(`The Guide has no «${group}» section`);
        return labels;
      }, { soft: true }) ?? [];
      for (const card of cards) {
        await s.step(`${group}: «${card}»`, () => follow(() => s.page.getByRole("region", { name: group, exact: true }).getByRole("button", { name: card, exact: true })), { soft: true });
      }
    }

    // The Examples section has no landmark of its own (GuideUsageDemos.tsx).
    const examples = await s.step("List the «Examples» cards", async () => {
      await backToGuide(s.page);
      const labels = [];
      for (const card of await s.page.locator(".guide-usage").getByRole("button").all()) labels.push(await card.getAttribute("aria-label"));
      if (!labels.length) throw new Error("The Guide has no examples");
      return labels;
    }, { soft: true }) ?? [];
    for (const card of examples) {
      await s.step(`Examples: «${card}»`, () => follow(() => s.page.locator(".guide-usage").getByRole("button", { name: card, exact: true })), { soft: true });
    }

    await s.step("The web addresses the Guide gives answer", async () => {
      await backToGuide(s.page);
      // Read, not clicked: an <a> would open the OS browser (setWindowOpenHandler in electron/main.cjs).
      const hrefs = await s.page.locator(".guide-page a[href]").evaluateAll((links) => links.map((link) => link.href));
      const inDrafts = drafted.flatMap((text) => text.match(/\bhttps?:\/\/[^\s,)]+/g) ?? []);
      const urls = [...new Set([...hrefs, ...inDrafts].filter((url) => /^https?:/.test(url)))];
      s.note(`The Guide has ${hrefs.length} link(s) out of the app; its example drafts name ${inDrafts.length} web address(es).`);
      if (!urls.length) return;
      const broken = [];
      for (const url of urls) {
        const result = await probeUrl(url);
        s.note(`${url}: ${result.status || result.error} (${result.verdict})`);
        if (result.verdict === "broken") broken.push(`${url} → ${result.status}`);
      }
      if (broken.length) throw new Error(`Broken: ${broken.join("; ")}`);
    }, { soft: true });
  },
};
